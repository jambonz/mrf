const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');
const { parseSdp, translatePlayUrl } = require('./utils');

// mediajam normalized wire events -> legacy ESL event names the
// feature-server registers via addCustomEventListener

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
    this._channelVars = {};
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
    const files = Array.isArray(file) ? file : [file];
    const urls = files.map(translatePlayUrl);
    /* the client supplies the playId so _pendingPlays is populated BEFORE
     * anything hits the wire — the server's play.start event can arrive in
     * the same tcp chunk as the command response, which processes ahead of
     * the awaiter's microtask; a lookup keyed on the response's playId
     * misses that window (seen live: playback-start without file). */
    const playId = randomUUID();
    const data = { urls, playId };
    if (seekOffset > 0) data.seekOffset = parseInt(seekOffset, 10);
    const result = new Promise((resolve, reject) => {
      // file (the caller's original, untranslated path) rides on the
      // playback-start/stop events: FS parity — the say/play tasks match
      // events to plays by evt.file when there is no tts playback id
      this._pendingPlays.set(playId, { resolve, reject, file: files[0] });
    });
    try {
      await this._request('play.start', data);
    } catch (err) {
      this._pendingPlays.delete(playId);
      throw err;
    }
    return result;
  }

  /** fsmrf api() passthrough: translate the FS api commands in use. */
  async api(command, args) {
    const arr = Array.isArray(args) ? args : (args ? String(args).split(' ') : []);
    /* uuid_<vendor>_noise_isolation / uuid_<vendor>_turn_taking: the
     * noise-isolation and turn-taking task interfaces (space-delimited:
     * '<uuid> start <direction> [level] [model]' / '<uuid> start
     * [threshold] [model]'). */
    const ni = /^uuid_([a-z0-9]+)_noise_isolation$/.exec(command);
    if (ni) {
      try {
        if (arr[1] === 'start') {
          await this._request('noise.start', {
            vendor: ni[1],
            ...(arr[2] && {direction: arr[2]}),
            ...(arr[3] && {level: parseInt(arr[3], 10)}),
            ...(arr[4] && {model: arr[4]})
          });
        } else {
          await this._request('noise.stop', {});
        }
        return { body: '+OK' };
      } catch (err) {
        return { body: `-ERR ${err.message}` };
      }
    }
    const tt2 = /^uuid_([a-z0-9]+)_turn_taking$/.exec(command);
    if (tt2) {
      try {
        if (arr[1] === 'start') {
          /* 'interrupt[=<threshold>]' may appear anywhere after 'start':
           * it enables the vendor's interruption-prediction model
           * (mediajam extension; the FS modules predate it) */
          const positional = [];
          let interrupt, interruptThreshold;
          for (const tok of arr.slice(2)) {
            const m = /^interrupt(?:=([\d.]+))?$/.exec(tok);
            if (m) {
              interrupt = true;
              if (m[1]) interruptThreshold = parseFloat(m[1]);
            } else {
              positional.push(tok);
            }
          }
          await this._request('tt.start', {
            vendor: tt2[1],
            ...(positional[0] && {threshold: parseFloat(positional[0])}),
            ...(positional[1] && {model: positional[1]}),
            ...(interrupt && {interrupt}),
            ...(interruptThreshold && {interruptThreshold})
          });
        } else {
          await this._request('tt.stop', {});
        }
        return { body: '+OK' };
      } catch (err) {
        return { body: `-ERR ${err.message}` };
      }
    }
    /* uuid_<vendor>_s2s: the llm task interface. args arrive
     * '^^|<uuid>|<command>[|...]'; map to s2s.* commands. ultravox passes
     * only host/path (a pre-authenticated joinUrl — no authType/apiKey);
     * elevenlabs prefixes in/out sample rates before host/path (the agent
     * speaks fixed-rate pcm independent of the endpoint codec); assemblyai
     * passes host/path/apiKey with no authType slot; google passes apiKey
     * first then optional host/path (key rides a ?key= query param). */
    const s2 = /^uuid_(openai|voice_agent|ultravox|elevenlabs|assemblyai|google)_s2s$/.exec(command);
    if (s2) {
      const vendor = s2[1];
      const raw = Array.isArray(args) ? args.join('|') : String(args || '');
      const parts = raw.replace(/^\^\^\|/, '').split('|');
      const cmd = parts[1];
      try {
        switch (cmd) {
          case 'session.create':
            if (vendor === 'elevenlabs') {
              /* args: inRate, outRate, host, path[, 'no_initial_config'] */
              await this._request('s2s.start', {
                vendor,
                inRate: parseInt(parts[2], 10) || 0,
                outRate: parseInt(parts[3], 10) || 0,
                host: parts[4], path: parts[5]
              });
            } else if (vendor === 'assemblyai') {
              /* args: host, path, apiKey (no authType slot) */
              await this._request('s2s.start', {
                vendor, host: parts[2], path: parts[3], apiKey: parts[4]
              });
            } else if (vendor === 'google') {
              /* args: apiKey[, host[, path]] — key first, host/path optional */
              await this._request('s2s.start', {
                vendor, apiKey: parts[2], host: parts[3], path: parts[4]
              });
            } else {
              await this._request('s2s.start', {
                vendor, host: parts[2], path: parts[3], authType: parts[4], apiKey: parts[5]
              });
            }
            return { body: '+OK' };
          case 'client.event': {
            const event = JSON.parse(parts.slice(2).join('|'));
            await this._request('s2s.clientEvent', { event });
            return { body: '+OK' };
          }
          case 'session.delete':
            await this._request('s2s.stop', {});
            return { body: '+OK' };
          default:
            return { body: `-ERR unknown s2s command ${cmd}` };
        }
      } catch (err) {
        return { body: `-ERR ${err.message}` };
      }
    }
    /* uuid_<vendor>_tts_streaming: the TtsStreamingBuffer token interface.
     * args arrive '^^|<uuid>|<command>[|<text>]' (FS multi-char delimiter
     * convention); map to the mediajam tts.* command set. */
    const tt = /^uuid_([a-z0-9]+)_tts_streaming$/.exec(command);
    if (tt) {
      const vendor = tt[1];
      const raw = Array.isArray(args) ? args.join('|') : String(args || '');
      const parts = raw.replace(/^\^\^\|/, '').split('|').map((p) => p.trim());
      const cmd = parts[1];
      const text = parts.slice(2).join('|');
      try {
        switch (cmd) {
          case 'connect':
            await this._request('tts.start', { vendor, options: { ...this._channelVars } });
            return { body: '+OK' };
          case 'send':
            await this._request('tts.send', { text });
            return { body: '+OK' };
          case 'flush':
            await this._request('tts.flush', {});
            return { body: '+OK' };
          case 'clear':
            await this._request('tts.clear', {});
            return { body: '+OK' };
          case 'stop':
          case 'close':
            await this._request('tts.stop', {});
            return { body: '+OK' };
          default:
            return { body: `-ERR unknown tts_streaming command ${cmd}` };
        }
      } catch (err) {
        return { body: `-ERR ${err.message}` };
      }
    }
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
    for (const [k, v] of Object.entries(obj)) {
      if (v === '' || v === null || v === undefined) delete this._channelVars[k];
      else this._channelVars[k] = String(v);
    }
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
  /** Begin transcription; mirrors fsmrf's signature. Vendor tuning rides
   * in previously-set channel vars (DEEPGRAM_*, GOOGLE_*, ...), which are
   * forwarded as stt.start options. */
  async startTranscription(opts = {}) {
    let vendor = opts.vendor;
    if (vendor === 'microsoft') vendor = 'azure';
    if (vendor === 'polly') vendor = 'aws';
    const bugname = opts.bugname ||
      (opts.vendor?.startsWith('custom:') ? `${opts.vendor}_transcribe` : `${vendor}_transcribe`);
    await this._request('stt.start', {
      vendor,
      language: opts.locale || 'en-US',
      interim: opts.interim === true,
      channels: opts.channels === 2 ? 2 : 1,
      bugname,
      options: {...this._channelVars}
    });
  }

  async stopTranscription(opts = {}) {
    let vendor = opts.vendor;
    if (vendor === 'microsoft') vendor = 'azure';
    if (vendor === 'polly') vendor = 'aws';
    const data = {};
    if (opts.bugname) data.bugname = opts.bugname;
    else if (vendor) data.vendor = vendor;
    await this._request('stt.stop', data).catch((err) => {
      // stopping an already-ended session is not an error worth surfacing
      if (err.code !== 'conflict') throw err;
    });
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
    /* HTTP Basic auth for the websocket upgrade. The feature-server sets it
     * as MOD_AUDIO_BASIC_AUTH_* channel vars (ep.set) before forkAudioStart,
     * exactly as mod_audio_fork consumed them; forward as wsAuth so mediajam
     * adds the Authorization header. The recording server requires this. */
    const username = opts.wsAuth?.username ?? this._channelVars.MOD_AUDIO_BASIC_AUTH_USERNAME;
    const password = opts.wsAuth?.password ?? this._channelVars.MOD_AUDIO_BASIC_AUTH_PASSWORD;
    if (username) data.wsAuth = {username, password: password || ''};
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
  /* fsmrf-compatible VAD detection. Note on option mapping: fsmrf passed
   * its options to mod_vad_silero POSITIONALLY and in the wrong order
   * (module reads silence-ms, speech-pad-ms, min-speech-ms; fsmrf sent
   * silenceMs, voiceMs, speechPadMs) — here voiceMs maps to minSpeechMs
   * by MEANING, matching the option names' documented intent rather than
   * the FS accident. */
  async startVadDetection(opts) {
    opts = opts || {};
    /* mediajam has one VAD implementation (silero); requests for the FS
     * 'native' energy vad get silero too — its mode knob has no analog
     * and is ignored. Callers listen via media-events' vadDetectionEvent
     * selector, so both vendors' events arrive the same way. */
    await this._request('vad.start', {
      vendor: 'silero',
      strategy: opts.strategy || 'continuous',
      ...(typeof opts.threshold === 'number' && {threshold: opts.threshold}),
      ...(typeof opts.silenceMs === 'number' && {silenceMs: opts.silenceMs}),
      ...(typeof opts.voiceMs === 'number' && {minSpeechMs: opts.voiceMs}),
      ...(typeof opts.speechPadMs === 'number' && {speechPadMs: opts.speechPadMs}),
      ...(opts.bugname && {bugname: opts.bugname})
    });
    return this;
  }
  async stopVadDetection(opts) {
    opts = opts || {};
    await this._request('vad.stop', {
      vendor: 'silero',
      ...(opts.bugname && {bugname: opts.bugname})
    });
    return this;
  }
  /* dub (mod_dub): fsmrf passes {action, track, play, loop, gain, say}.
   * Map each action onto the mediajam dub.* command family. gain is in
   * dB (the dub verb's gain), carried as gainDb. */
  async dub(opts = {}) {
    const {action, track} = opts;
    switch (action) {
      case 'addTrack':
        await this._request('dub.addTrack', {track});
        break;
      case 'removeTrack':
        await this._request('dub.removeTrack', {track});
        break;
      case 'silenceTrack':
        await this._request('dub.silenceTrack', {track});
        break;
      case 'playOnTrack':
        await this._request('dub.playOnTrack', {
          track,
          url: opts.play,
          ...(opts.loop && {loop: true}),
          ...(typeof opts.gain === 'number' && opts.gain !== 0 && {gainDb: opts.gain})
        });
        break;
      case 'sayOnTrack':
        await this._request('dub.sayOnTrack', {
          track,
          say: opts.say,
          ...(typeof opts.gain === 'number' && opts.gain !== 0 && {gainDb: opts.gain})
        });
        break;
      default:
        throw new Error(`mediajam: unknown dub action '${action}'`);
    }
    return this;
  }
  /* mod_dub setGain — scales the channel audio; maps to endpoint.set gainDb */
  async setGain(gain) {
    await this._request('endpoint.set', {gainDb: typeof gain === 'number' ? gain : parseInt(gain, 10) || 0});
    return this;
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
      case 'play.start': {
        const file = this._pendingPlays.get(data.playId)?.file;
        this.emit('playback-start',
          { playId: data.playId, ...(file && {file}), ...ttsVars(data.tts) });
        break;
      }
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
        this.emit('playback-stop',
          { playId: data.playId, reason: data.reason, ...(p?.file && {file: p.file}),
            ...ttsVars(data.tts) });
        break;
      }
      default: {
        // normalized media-server events (fork.*, stt.*, tts.*, s2s.*) are
        // delivered under their wire names. Handlers get the fsmrf custom-
        // event contract: (parsedBodyOrText, eventObj) where eventObj
        // supports getHeader (media-bugname et al.) for bug filtering.
        let payload = data;
        if (data && typeof data.json === 'string') {
          try {
            payload = JSON.parse(data.json);
          } catch {
            payload = data.json;
          }
        } else if (data && data.body !== undefined) {
          payload = data.body;
        }
        const eventObj = {
          getHeader: (name) => {
            switch (name) {
              case 'media-bugname': return data?.bugname;
              case 'transcription-vendor': return data?.vendor;
              case 'transcription-session-finished': return data?.finished;
              default: return data?.[name];
            }
          }
        };
        const handlers = this._customEventListeners.get(evt);
        if (handlers) for (const h of handlers) h(payload, eventObj);
        this.emit(evt, payload, eventObj);
      }
    }
  }
}


/**
 * say:-url (TTS) plays carry synthesis metadata on play events; surface it
 * with the legacy variable_tts_* names the feature-server expects on
 * playback-start / playback-stop.
 */
function ttsVars(tts) {
  if (!tts) return {};
  const out = {
    ...(tts.playbackId && {variable_tts_playback_id: tts.playbackId}),
    ...(tts.ttfbMs !== undefined && {variable_tts_time_to_first_byte_ms: String(tts.ttfbMs)}),
    ...(tts.cacheFilename && {variable_tts_cache_filename: tts.cacheFilename}),
    ...(tts.error && {variable_tts_error: tts.error}),
    ...(tts.responseCode !== undefined && {variable_tts_response_code: String(tts.responseCode)}),
  };
  /* vendor dial/response metadata (request id, connect timings, voice):
   * FS modules exposed these as tts_<vendor>_<field> channel variables
   * and the feature-server turns every variable_tts_* into an otel span
   * attribute */
  if (tts.vendor && tts.info) {
    for (const [k, v] of Object.entries(tts.info)) {
      out[`variable_tts_${tts.vendor}_${k}`] = String(v);
    }
  }
  return out;
}

module.exports = Endpoint;
