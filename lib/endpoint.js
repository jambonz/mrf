const { EventEmitter } = require('events');
const { parseSdp, translatePlayUrl } = require('./utils');

/**
 * Endpoint exposes the drachtio-fsmrf Endpoint API surface (the subset the
 * jambonz feature-server uses) over the mediajam control protocol.
 *
 * Events: 'destroy', 'dtmf' ({dtmf, duration, source}), 'playback-start',
 * 'playback-stop', plus custom events registered via addCustomEventListener.
 */
class Endpoint extends EventEmitter {
  constructor(mediaserver, endpointId, localSdp, remoteSdp) {
    super();
    this.ms = mediaserver;
    this.mediaserver = mediaserver;
    this.uuid = endpointId;
    this.connected = true;
    this.muted = false;
    this.inbandDtmfEnabled = false;

    this.local = parseSdp(localSdp);
    this.remote = remoteSdp ? parseSdp(remoteSdp) : { sdp: null, mediaIp: null, mediaPort: null };

    this._customEventListeners = new Map();
    this._pendingPlays = new Map();
  }

  get conn() {
    return this.ms.conn;
  }

  _request(cmd, data) {
    return this.ms._connection.request(cmd, this.uuid, data);
  }

  /** Play one or more files/urls; resolves when playback completes. */
  async play(file) {
    const urls = (Array.isArray(file) ? file : [file]).map(translatePlayUrl);
    const { playId } = await this._request('play.start', { urls });
    return new Promise((resolve, reject) => {
      this._pendingPlays.set(playId, { resolve, reject });
    });
  }

  /** fsmrf api() passthrough: translate the FS api commands in use. */
  async api(command, args) {
    const arr = Array.isArray(args) ? args : (args ? String(args).split(' ') : []);
    switch (command) {
      case 'uuid_break':
        await this._request('play.stop', {});
        return { body: '+OK' };
      case 'send_dtmf': {
        const spec = arr.find((a) => a !== this.uuid) || '';
        await this._sendDtmf(spec);
        return { body: '+OK' };
      }
      default:
        throw new Error(`mediajam: api command not supported: ${command}`);
    }
  }

  /** fsmrf execute() passthrough for the FS apps in use. */
  async execute(app, arg) {
    switch (app) {
      case 'send_dtmf':
        await this._sendDtmf(arg);
        return {};
      case 'set_mute': {
        const muted = /true/.test(arg || '');
        await this._request(muted ? 'endpoint.mute' : 'endpoint.unmute', { direction: 'in' });
        this.muted = muted;
        return {};
      }
      case 'start_dtmf':
        // inband DTMF detection: pending server-side support
        this.inbandDtmfEnabled = true;
        return {};
      case 'hangup':
        await this.destroy();
        return {};
      default:
        throw new Error(`mediajam: execute app not supported: ${app}`);
    }
  }

  async _sendDtmf(spec) {
    const [digits, duration] = String(spec).split('@');
    const data = { digits };
    if (duration) data.durationMs = parseInt(duration, 10);
    await this._request('dtmf.send', data);
  }

  async set(param, value) {
    const obj = typeof param === 'object' ? param : { [param]: value };
    const options = {};
    for (const [k, v] of Object.entries(obj)) {
      switch (k) {
        case 'media_timeout':
          options.mediaTimeoutMs = parseInt(v, 10);
          break;
        case 'media_hold_timeout':
          options.holdTimeoutMs = parseInt(v, 10);
          break;
        default:
          // many FS channel variables have no mediajam equivalent; ignore
          break;
      }
    }
    if (Object.keys(options).length > 0) await this._request('endpoint.set', options);
    return this;
  }

  async export(param, value) {
    return this.set(param, value);
  }

  async modify(sdp) {
    const { localSdp } = await this._request('endpoint.modify', { remoteSdp: sdp });
    this.remote = parseSdp(sdp);
    if (localSdp) this.local = parseSdp(localSdp);
    return this;
  }

  async bridge(other) {
    const otherEndpointId = typeof other === 'string' ? other : other.uuid;
    await this._request('bridge.create', { otherEndpointId });
    return this;
  }

  async unbridge() {
    await this._request('bridge.destroy', {});
    return this;
  }

  async mute() {
    await this._request('endpoint.mute', { direction: 'in' });
    this.muted = true;
    return this;
  }

  async unmute() {
    await this._request('endpoint.unmute', { direction: 'in' });
    this.muted = false;
    return this;
  }

  async toggleMute() {
    return this.muted ? this.unmute() : this.mute();
  }

  async getChannelVariables() {
    return this._request('endpoint.info', {});
  }

  async destroy() {
    if (!this.connected) return;
    this.connected = false;
    await this._request('endpoint.destroy', {}).catch(() => {});
  }

  addCustomEventListener(event, handler) {
    let handlers = this._customEventListeners.get(event);
    if (!handlers) {
      handlers = new Set();
      this._customEventListeners.set(event, handlers);
    }
    handlers.add(handler);
  }

  removeCustomEventListener(event, handler) {
    const handlers = this._customEventListeners.get(event);
    if (!handlers) return;
    if (handler) handlers.delete(handler);
    else handlers.clear();
    if (handlers.size === 0) this._customEventListeners.delete(event);
  }

  /** Routes a protocol event frame to fsmrf-compatible emissions. */
  _onEvent(evt, data) {
    switch (evt) {
      case 'endpoint.destroyed':
        this.connected = false;
        for (const [, p] of this._pendingPlays) p.resolve({});
        this._pendingPlays.clear();
        this.ms._endpointGone(this.uuid);
        this.emit('destroy', { reason: data?.reason });
        break;
      case 'dtmf':
        this.emit('dtmf', { dtmf: data.digit, duration: data.durationMs, source: data.source });
        break;
      case 'play.start':
        this.emit('playback-start', { playId: data.playId });
        break;
      case 'play.done': {
        const p = this._pendingPlays.get(data.playId);
        if (p) {
          this._pendingPlays.delete(data.playId);
          p.resolve({
            reason: data.reason,
            playbackSeconds: Math.round((data.durationMs || 0) / 1000),
            playbackMilliseconds: data.durationMs || 0
          });
        }
        this.emit('playback-stop', { playId: data.playId, reason: data.reason });
        break;
      }
      default: {
        // normalized vendor events (Phase 2) and anything else: deliver to
        // custom event listeners and as a raw event
        const handlers = this._customEventListeners.get(evt);
        if (handlers) for (const h of handlers) h(data);
        this.emit(evt, data);
      }
    }
  }
}

module.exports = Endpoint;
