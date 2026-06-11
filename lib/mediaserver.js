const { EventEmitter } = require('events');
const Endpoint = require('./endpoint');

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

    connection.on('evt', (frame) => this._onEvent(frame));
    connection.on('stats', (data) => this._onStats(data));
    connection.on('close', () => {
      this.connected = false;
      for (const [, ep] of this._endpoints) {
        ep._onEvent('endpoint.destroyed', { reason: 'connectionLost' });
      }
      this._endpoints.clear();
      this.conn.emit('esl::end');
      this.emit('disconnect');
    });
    connection.on('error', (err) => this.emit('error', err));
  }

  _onHello(helloData) {
    this.connected = true;
    this.maxSessions = helloData.maxSessions || 0;
    this.serverVersion = helloData.server;
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

  /** Change (or query, with no arg) the server's log level at runtime. */
  async setLogLevel(level) {
    const data = level ? { level } : {};
    const res = await this._connection.request('system.logLevel', null, data);
    return res.level;
  }

  destroy() {
    this._connection.close();
  }

  disconnect() {
    this.destroy();
  }
}

module.exports = MediaServer;
