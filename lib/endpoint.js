const { EventEmitter } = require('events');
const { parseSdp, translatePlayUrl } = require('./utils');

// mediajam normalized wire events -> legacy ESL event names the
// feature-server registers via addCustomEventListener
const LEGACY_EVENT_NAMES = {
  'fork.connect': 'mod_audio_fork::connect',
  'fork.connect_failed': 'mod_audio_fork::connect_failed',
  'fork.disconnect': 'mod_audio_fork::disconnect',
  'fork.error': 'mod_audio_fork::error',
  'fork.buffer_overrun': 'mod_audio_fork::buffer_overrun',
  'fork.transcription': 'mod_audio_fork::transcription',
  'fork.play_audio': 'mod_audio_fork::play_audio',
  'fork.kill_audio': 'mod_audio_fork::kill_audio',
  'fork.json': 'mod_audio_fork::json'
};

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

  /** Play one or more files/urls; resolves when playback completes.
   * Accepts fsmrf's PlaybackOptions object form ({file, seekOffset}),
   * where seekOffset is in samples at the endpoint sample rate. */
  async play(file) {
    let seekOffset;
    if (!Array.isArray(file) && typeof file === 'object') {
      seekOffset = file.seekOffset;
      file = file.file;
    }
    const urls = (Array.isArray(file) ? file : [file]).map(translatePlayUrl);
    const data = { urls };
    if (seekOffset > 0) data.seekOffset = parseInt(seekOffset, 10);
    const { playId } = await this._request('play.start', data);
    return new Promise((resolve, reject) => {
      this._pendingPlays.set(playId, { resolve, reject });
    });
  }

  /** fsmrf api() passthrough: translate the FS api commands in use. */
  async api(command, args) {
    const arr = Array.isArray(args) ? args : (args ? String(args).split(' ') : []);
    switch (command) {
      case 'uuid_jambonz_licensing':
        // licensing subsystem is not present in mediajam; respond as FS
        // does for an unavailable module so callers degrade gracefully
        return { body: '-ERR licensing not available' };
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
    // fsmrf semantics: an app-initiated destroy() does not emit 'destroy' --
    // the event is reserved for unexpected teardown (media timeout, server
    // shutdown). The feature-server's media-timeout handlers depend on this.
    this._selfDestroyed = true;
    await this._request('endpoint.destroy', {}).catch(() => {});
  }

  /* fsmrf methods pending mediajam Phase 2 (vendor adapter framework).
   * Present so callers fail with a descriptive rejection rather than a
   * TypeError; each names the protocol family that will back it. */
  startTranscription() {
    return Promise.reject(new Error('mediajam: startTranscription pending Phase 2 (stt.*)'));
  }
  stopTranscription() {
    return Promise.reject(new Error('mediajam: stopTranscription pending Phase 2 (stt.*)'));
  }
  startTranscriptionTimers() {
    return Promise.reject(new Error('mediajam: startTranscriptionTimers pending Phase 2 (stt.*)'));
  }
  async forkAudioStart(opts = {}) {
    const sampleRate = typeof opts.sampling === 'string'
      ? parseInt(opts.sampling, 10) * (opts.sampling.endsWith('k') ? 1000 : 1)
      : opts.sampling;
    const data = {
      wsUrl: opts.wsUrl,
      mixType: opts.mixType,
      bugname: opts.bugname
    };
    if (sampleRate) data.sampleRate = sampleRate;
    if (opts.metadata) data.metadata = opts.metadata;
    if (opts.bidirectionalAudio) {
      data.bidirectionalAudio = {
        enabled: !!opts.bidirectionalAudio.enabled,
        streaming: !!opts.bidirectionalAudio.streaming,
        sampleRate: opts.bidirectionalAudio.sampleRate || 0
      };
    }
    await this._request('fork.start', data);
    return this;
  }

  async forkAudioStop(bugname, metadata) {
    const data = {};
    if (bugname) data.bugname = bugname;
    if (metadata) data.metadata = metadata;
    await this._request('fork.stop', data);
    return this;
  }

  async forkAudioPause(bugname) {
    await this._request('fork.pause', bugname ? {bugname} : {});
    return this;
  }

  async forkAudioResume(bugname) {
    await this._request('fork.resume', bugname ? {bugname} : {});
    return this;
  }

  async forkAudioSendText(bugname, metadata) {
    await this._request('fork.sendText', {bugname, metadata});
    return this;
  }
  startVadDetection() {
    return Promise.reject(new Error('mediajam: startVadDetection pending Phase 2 (vad.*)'));
  }
  stopVadDetection() {
    return Promise.reject(new Error('mediajam: stopVadDetection pending Phase 2 (vad.*)'));
  }
  dub() {
    return Promise.reject(new Error('mediajam: dub pending Phase 2 (dub.*)'));
  }
  setGain() {
    return Promise.reject(new Error('mediajam: setGain pending Phase 2 (dub.*)'));
  }
  join() {
    return Promise.reject(new Error('mediajam: conference join pending Phase 3 (room.*)'));
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
        for (const [, p] of this._pendingPlays) {
          p.resolve({reason: 'destroyed', playbackSeconds: 0, playbackMilliseconds: 0, playbackLastOffsetPos: 0});
        }
        this._pendingPlays.clear();
        this.ms._endpointGone(this.uuid);
        if (!this._selfDestroyed) this.emit('destroy', { reason: data?.reason });
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
          // FS reports playback_seconds/_ms from samples read (read-ahead
          // included); mediajam carries that in playbackMs. durationMs
          // (audio actually played) is the fallback for older servers.
          const ms = data.playbackMs ?? data.durationMs ?? 0;
          p.resolve({
            reason: data.reason,
            playbackSeconds: Math.floor(ms / 1000),
            playbackMilliseconds: ms,
            playbackLastOffsetPos: data.lastOffsetPos ?? 0
          });
        }
        this.emit('playback-stop', { playId: data.playId, reason: data.reason });
        break;
      }
      default: {
        // normalized vendor events: translate to the legacy ESL event names
        // the feature-server listens for, with the payload shape fsmrf
        // delivered (parsed JSON body, or text)
        const legacy = LEGACY_EVENT_NAMES[evt];
        let name = evt;
        let payload = data;
        if (legacy) {
          name = legacy;
          if (data && typeof data.json === 'string') {
            try {
              payload = JSON.parse(data.json);
            } catch (err) {
              payload = data.json;
            }
          } else if (data && data.body !== undefined) {
            payload = data.body;
          }
        }
        const handlers = this._customEventListeners.get(name);
        if (handlers) for (const h of handlers) h(payload);
        this.emit(name, payload);
      }
    }
  }
}

module.exports = Endpoint;
