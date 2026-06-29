const { EventEmitter } = require('events');
const Endpoint = require('./endpoint');
const Connection = require('./connection');

const RECONNECT_DELAY_MS = 500;
const RECONNECT_DELAY_MAX_MS = 5000;

function clientInfo() {
  const { name, version } = require('../package.json');
  return `${name}/${version}`;
}

/**
 * MediaServer represents one connection to a mediajam server, exposing the
 * drachtio-fsmrf MediaServer surface the feature-server uses.
 *
 * Events: 'connect', 'ready', 'error', 'channel::open', 'channel::close'.
 * For fsmrf compatibility, `ms.conn` is an EventEmitter that emits
 * 'esl::ready' and 'esl::end'.
 */
class MediaServer extends EventEmitter {
  constructor(connection, logger, opts) {
    super();
    this._connection = connection;
    this.logger = logger;
    this.address = opts.address;
    this.port = opts.port;

    this.connected = false;
    this.maxSessions = 0;
    this.currentSessions = 0;
    this.cps = 0;
    this.cpuIdle = 100;

    this._endpoints = new Map();

    // fsmrf compatibility: feature-server listens on ms.conn for esl events
    this.conn = new EventEmitter();

    this._wireConnection(connection);
  }

  _wireConnection(connection) {
    this._connection = connection;
    connection.on('evt', (frame) => this._onEvent(frame));
    connection.on('stats', (data) => this._onStats(data));
    connection.on('close', () => this._onConnectionClose());
    connection.on('error', (err) => this.emit('error', err));
  }

  /* An unexpected loss of the media server ends its endpoints (the
   * server died with them) but NOT this MediaServer: mediajam restarts
   * (deploys) must not take the feature-server down with them, so we
   * quietly redial with backoff and re-emit esl::ready on recovery —
   * mirroring the ESL auto-reconnect of the freeswitch world. esl::end
   * is never emitted for a transient loss because the feature-server
   * treats it as fatal (it tears down drachtio when its last media
   * server is gone). A self-initiated destroy()/disconnect() tears down
   * quietly with no reconnect. */
  _onConnectionClose() {
    this.connected = false;
    if (this._selfDestroyed) {
      this._endpoints.clear();
      return;
    }
    for (const [, ep] of this._endpoints) {
      ep._onEvent('endpoint.destroyed', { reason: 'connectionLost' });
    }
    this._endpoints.clear();
    this.emit('disconnect');
    this._reconnect();
  }

  async _reconnect() {
    if (this._reconnecting) return;
    this._reconnecting = true;
    this.logger?.info(`mediajam at ${this.address}:${this.port} lost; reconnecting`);
    let delay = RECONNECT_DELAY_MS;
    let attempts = 0;
    while (!this._selfDestroyed) {
      // unref: a pending reconnect must not hold the process open
      await new Promise((r) => setTimeout(r, delay).unref());
      try {
        const connection = new Connection(this.logger);
        const helloData = await connection.connect(
          { address: this.address, port: this.port }, clientInfo());
        this._wireConnection(connection);
        this._reconnecting = false;
        this._onHello(helloData);
        this.logger?.info(`reconnected to mediajam at ${this.address}:${this.port}` +
          ` after ${attempts + 1} attempt(s)`);
        return;
      } catch (err) {
        attempts++;
        if (attempts % 10 === 0) {
          this.logger?.info(`still unable to reach mediajam at ${this.address}:${this.port}` +
            ` (${attempts} attempts): ${err.message}`);
        }
        delay = Math.min(delay * 2, RECONNECT_DELAY_MAX_MS);
      }
    }
    this._reconnecting = false;
  }

  _onHello(helloData) {
    this.connected = true;
    this.maxSessions = helloData.maxSessions || 0;
    this.serverVersion = helloData.server;
    // licensing capability: false on a nolicense mediajam build. Absent (older
    // server) => assume enabled. Lets us skip the per-call licensing.* round-trip.
    this.licensingEnabled = helloData.licensing !== false;
    this.conn.emit('esl::ready');
    this.emit('connect');
    this.emit('ready');
  }

  _onStats(data) {
    this.currentSessions = data.sessions ?? this.currentSessions;
    this.maxSessions = data.maxSessions ?? this.maxSessions;
    this.cps = data.cps ?? this.cps;
    this.cpuIdle = data.cpuIdle ?? this.cpuIdle;
  }

  _onEvent(frame) {
    const ep = this._endpoints.get(frame.ep);
    if (ep) ep._onEvent(frame.evt, frame.data || {});
  }

  _endpointGone(endpointId) {
    this._endpoints.delete(endpointId);
    this.emit('channel::close', { endpointId });
  }

  /**
   * Create an endpoint. Options follow fsmrf: {remoteSdp, codecs, ...} plus
   * jambonz drachtioFsmrfOptions (media_timeout, media_hold_timeout).
   */
  async createEndpoint(opts = {}) {
    const data = {};
    if (opts.remoteSdp) data.remoteSdp = opts.remoteSdp;
    if (opts.codecs) data.codecs = Array.isArray(opts.codecs) ? opts.codecs : [opts.codecs];
    if (opts.tags) data.tags = opts.tags;
    /* licensing conduit: {callId, token} on an inbound call (mediajam validates
     * the session token before allocating media), or {reason:'anchor-media'} to
     * skip the token check while still enforcing the session cap (re-anchors and
     * jambonz-originated outbound legs, which carry no inbound token). */
    if (opts.license) data.license = opts.license;
    const options = {};
    if (opts.media_timeout) options.mediaTimeoutMs = parseInt(opts.media_timeout, 10);
    if (opts.media_hold_timeout) options.holdTimeoutMs = parseInt(opts.media_hold_timeout, 10);
    if (Object.keys(options).length > 0) data.options = options;

    const res = await this._connection.request('endpoint.create', null, data);
    const ep = new Endpoint(this, res.endpointId, res.localSdp, opts.remoteSdp);
    this._endpoints.set(ep.uuid, ep);
    this.emit('channel::open', { endpointId: ep.uuid });
    return ep;
  }

  /**
   * fsmrf connectCaller: allocate an endpoint for an inbound call and answer
   * it. Works with drachtio req/res objects (duck-typed).
   */
  async connectCaller(req, res, opts = {}) {
    const endpoint = await this.createEndpoint({ ...opts, remoteSdp: req.body });
    const dialog = await res.send(200, { body: endpoint.local.sdp });
    return { endpoint, dialog };
  }

  /** Active endpoint count as seen by this client. */
  get endpointCount() {
    return this._endpoints.size;
  }

  /**
   * fsmrf MediaServer.api — server-scoped api calls. Today the only use is the
   * conference verb's `conference <name> list count` start-probe (and the
   * `get count` form). Returns a RAW string body (fsmrf MediaServer.api shape):
   * the count when the room exists, or a "not found" string the verb matches
   * with its confNoMatch() to decide the conference doesn't yet exist.
   */
  async api(command, args) {
    if (command === 'conference' || (typeof command === 'string' && command.startsWith('conference '))) {
      let tokens;
      if (command === 'conference') {
        tokens = Array.isArray(args) ? args.map(String) : String(args || '').trim().split(/\s+/);
      } else {
        tokens = command.trim().split(/\s+/).slice(1);
      }
      const [room, verb, ...rest] = tokens;
      if ((verb === 'list' || verb === 'get') && rest[rest.length - 1] === 'count') {
        const res = await this._connection.request('room.query', null, { room });
        return res.found ? String(res.count) : `Conference ${room} not found`;
      }
      return '+OK';
    }
    return '-ERR unsupported';
  }

  /* Start a nested-listen conf-bot (a fork born in a room) at the SERVER level,
   * addressed by room name with no member endpoint — for conference-wide
   * operations (e.g. transcription) that are not tied to any one participant.
   * The conf-bot is room-owned (survives any member and is reaped with the
   * room); its lifecycle events route to this media-server connection rather
   * than an endpoint conn. Mirrors Endpoint.startConferenceFork.
   * Returns {botMemberId, botId}. */
  async startConferenceFork(room, opts = {}) {
    const data = { room, wsUrl: opts.wsUrl };
    if (opts.sampleRate) data.sampleRate = opts.sampleRate;
    if (opts.metadata) data.metadata = opts.metadata;
    if (opts.bidirectionalAudio) {
      data.bidirectionalAudio = {
        enabled: !!opts.bidirectionalAudio.enabled,
        streaming: !!opts.bidirectionalAudio.streaming,
        sampleRate: opts.bidirectionalAudio.sampleRate || 0
      };
    }
    if (opts.wsAuth?.username) {
      data.wsAuth = { username: opts.wsAuth.username, password: opts.wsAuth.password || '' };
    }
    const res = await this._connection.request('room.fork.start', null, data);
    return { botMemberId: res?.botMemberId, botId: res?.botId };
  }

  /** Stop a server-level conf-bot fork by room name + member id. */
  async stopConferenceFork(room, member) {
    await this._connection.request('room.fork.stop', null, { room, member });
    return this;
  }

  /** Send a text frame to a server-level conf-bot's WebSocket. */
  async sendConferenceForkText(room, member, text) {
    await this._connection.request('room.fork.sendText', null, { room, member, text });
    return this;
  }

  /** Change (or query, with no arg) the server's log level at runtime. */
  async setLogLevel(level) {
    const data = level ? { level } : {};
    const res = await this._connection.request('system.logLevel', null, data);
    return res.level;
  }

  destroy() {
    this._selfDestroyed = true;
    this._connection.close();
  }

  disconnect() {
    this.destroy();
  }
}

module.exports = MediaServer;
