const { test } = require('node:test');
const assert = require('node:assert');
const Mrf = require('..');
const MockMediajam = require('./support/mock-server');

async function setup(t) {
  const mock = new MockMediajam();
  const port = await mock.listen();
  const mrf = new Mrf();
  const ms = await mrf.connect({ address: '127.0.0.1', port });
  t.after(() => {
    ms.destroy();
    mock.close();
  });
  return { mock, ms };
}

test('connects and exposes server hello', async(t) => {
  const { ms } = await setup(t);
  assert.equal(ms.connected, true);
  assert.equal(ms.maxSessions, 100);
});

test('createEndpoint returns fsmrf-shaped endpoint', async(t) => {
  const { ms, mock } = await setup(t);
  const ep = await ms.createEndpoint({ remoteSdp: 'v=0\r\nc=IN IP4 1.2.3.4\r\nm=audio 5004 RTP/AVP 0\r\n' });
  assert.ok(ep.uuid);
  assert.equal(ep.connected, true);
  assert.equal(ep.local.mediaIp, '127.0.0.1');
  assert.equal(ep.local.mediaPort, 41000);
  assert.equal(ep.remote.mediaIp, '1.2.3.4');
  assert.equal(ep.remote.mediaPort, 5004);
  const createReq = mock.requests.find((r) => r.cmd === 'endpoint.create');
  assert.ok(createReq.data.remoteSdp);
});

test('media_timeout option maps to mediaTimeoutMs', async(t) => {
  const { ms, mock } = await setup(t);
  await ms.createEndpoint({ media_timeout: '30000' });
  const createReq = mock.requests.find((r) => r.cmd === 'endpoint.create');
  assert.equal(createReq.data.options.mediaTimeoutMs, 30000);
});

test('play resolves on play.done with fsmrf-style result', async(t) => {
  const { ms } = await setup(t);
  const ep = await ms.createEndpoint({});
  const events = [];
  ep.on('playback-start', () => events.push('start'));
  ep.on('playback-stop', () => events.push('stop'));
  const result = await ep.play('silence_stream://1000');
  assert.equal(result.reason, 'completed');
  assert.equal(result.playbackSeconds, 0);
  assert.equal(result.playbackMilliseconds, 100);
  assert.equal(result.playbackLastOffsetPos, 800);
  assert.deepEqual(events, ['start', 'stop']);
});

test('play PlaybackOptions form passes seekOffset', async(t) => {
  const { ms, mock } = await setup(t);
  const ep = await ms.createEndpoint({});
  await ep.play({ file: '/tmp/foo.wav', seekOffset: 8000 });
  const playReq = mock.requests.find((r) => r.cmd === 'play.start');
  assert.deepEqual(playReq.data.urls, ['/tmp/foo.wav']);
  assert.equal(playReq.data.seekOffset, 8000);
});

test('play url translation', async(t) => {
  const { ms, mock } = await setup(t);
  const ep = await ms.createEndpoint({});
  await ep.play(['silence_stream://500', 'tone_stream://L=1;%(250, 0, 440)', 'https://x.test/a.wav']);
  const playReq = mock.requests.find((r) => r.cmd === 'play.start');
  assert.deepEqual(playReq.data.urls, [
    'silence://?duration=500',
    'tone://?freq=440&duration=250',
    'https://x.test/a.wav'
  ]);
});

test('api uuid_break maps to play.stop', async(t) => {
  const { ms, mock } = await setup(t);
  const ep = await ms.createEndpoint({});
  await ep.api('uuid_break', ep.uuid);
  assert.ok(mock.requests.find((r) => r.cmd === 'play.stop' && r.ep === ep.uuid));
});

test('execute send_dtmf maps digits and duration', async(t) => {
  const { ms, mock } = await setup(t);
  const ep = await ms.createEndpoint({});
  await ep.execute('send_dtmf', '1234#@150');
  const req = mock.requests.find((r) => r.cmd === 'dtmf.send');
  assert.equal(req.data.digits, '1234#');
  assert.equal(req.data.durationMs, 150);
});

test('bridge and unbridge', async(t) => {
  const { ms, mock } = await setup(t);
  const a = await ms.createEndpoint({});
  const b = await ms.createEndpoint({});
  await a.bridge(b);
  const req = mock.requests.find((r) => r.cmd === 'bridge.create');
  assert.equal(req.ep, a.uuid);
  assert.equal(req.data.otherEndpointId, b.uuid);
  await a.unbridge();
  assert.ok(mock.requests.find((r) => r.cmd === 'bridge.destroy'));
});

test('self-initiated destroy does NOT emit destroy (fsmrf parity)', async(t) => {
  const { ms } = await setup(t);
  const ep = await ms.createEndpoint({});
  let emitted = false;
  ep.once('destroy', () => emitted = true);
  await ep.destroy();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(emitted, false, 'destroy event must not fire for app-initiated destroy');
  assert.equal(ep.connected, false);
  assert.equal(ms.endpointCount, 0);
});

test('server-initiated destruction emits destroy', async(t) => {
  const { ms, mock } = await setup(t);
  const ep = await ms.createEndpoint({});
  const destroyed = new Promise((resolve) => ep.once('destroy', resolve));
  mock.pushEvent(ep.uuid, 'endpoint.destroyed', { reason: 'mediaTimeout' });
  const evt = await destroyed;
  assert.equal(evt.reason, 'mediaTimeout');
  assert.equal(ep.connected, false);
});

test('dtmf events surface in fsmrf shape', async(t) => {
  const { ms, mock } = await setup(t);
  const ep = await ms.createEndpoint({});
  const dtmf = new Promise((resolve) => ep.once('dtmf', resolve));
  mock.pushEvent(ep.uuid, 'dtmf', { digit: '5', durationMs: 120, source: 'rfc2833' });
  const evt = await dtmf;
  assert.deepEqual(evt, { dtmf: '5', duration: 120, source: 'rfc2833' });
});

test('custom event listeners receive normalized events with fsmrf contract', async(t) => {
  const { ms, mock } = await setup(t);
  const ep = await ms.createEndpoint({});
  const got = new Promise((resolve) => ep.addCustomEventListener('stt.transcription',
    (payload, evtObj) => resolve({payload, evtObj})));
  mock.pushEvent(ep.uuid, 'stt.transcription',
    { vendor: 'deepgram', bugname: 'default', json: '{"text":"hi"}' });
  const {payload, evtObj} = await got;
  assert.equal(payload.text, 'hi', 'json payload is parsed');
  assert.equal(evtObj.getHeader('media-bugname'), 'default');
});

test('fork.play_audio delivers parsed file payload', async(t) => {
  const { ms, mock } = await setup(t);
  const ep = await ms.createEndpoint({});
  const got = new Promise((resolve) => ep.addCustomEventListener('fork.play_audio',
    (payload, evtObj) => resolve({payload, evtObj})));
  mock.pushEvent(ep.uuid, 'fork.play_audio',
    { bugname: 'b1', json: '{"file":"/tmp/x.tmp.r16","audioContentType":"raw"}' });
  const {payload, evtObj} = await got;
  assert.equal(payload.file, '/tmp/x.tmp.r16');
  assert.equal(evtObj.getHeader('media-bugname'), 'b1');
});

test('stats update mediaserver gauges', async(t) => {
  const { ms, mock } = await setup(t);
  const updated = new Promise((resolve) => {
    const iv = setInterval(() => {
      if (ms.currentSessions === 42) {
        clearInterval(iv);
        resolve();
      }
    }, 5);
  });
  mock.pushStats({ sessions: 42, maxSessions: 100, cpuIdle: 88 });
  await updated;
  assert.equal(ms.cpuIdle, 88);
});

test('connection loss destroys endpoints and reconnects', async() => {
  const mock = new MockMediajam();
  const port = await mock.listen();
  const mrf = new Mrf();
  const ms = await mrf.connect({ address: '127.0.0.1', port });
  const ep = await ms.createEndpoint({});
  const destroyed = new Promise((resolve) => ep.once('destroy', resolve));
  const disconnected = new Promise((resolve) => ms.once('disconnect', resolve));
  const ready = new Promise((resolve) => ms.conn.once('esl::ready', resolve));
  mock.close();
  for (const socket of mock.sockets) socket.destroy();
  const evt = await destroyed;
  await disconnected;
  assert.equal(evt.reason, 'connectionLost');
  // esl::end must NOT fire on transient loss (it is fatal to the
  // feature-server); the wrapper redials and re-emits esl::ready
  ms.conn.once('esl::end', () => assert.fail('esl::end fired on transient loss'));
  await mock.listen(port);
  await ready;
  assert.equal(ms.connected, true);
  ms.destroy();
  mock.close();
});

test('setLogLevel changes and queries server log level', async(t) => {
  const { ms } = await setup(t);
  assert.equal(await ms.setLogLevel('debug'), 'debug');
  assert.equal(await ms.setLogLevel(), 'debug');
});

test('startTranscription forwards channel vars as options', async(t) => {
  const { ms, mock } = await setup(t);
  const ep = await ms.createEndpoint({});
  await ep.set({DEEPGRAM_API_KEY: 'k123', DEEPGRAM_SPEECH_MODEL: 'nova-2', UNRELATED: ''});
  await ep.startTranscription({vendor: 'deepgram', locale: 'en-US', interim: true});
  const req = mock.requests.find((r) => r.cmd === 'stt.start');
  assert.equal(req.data.vendor, 'deepgram');
  assert.equal(req.data.language, 'en-US');
  assert.equal(req.data.interim, true);
  assert.equal(req.data.bugname, 'deepgram_transcribe');
  assert.equal(req.data.options.DEEPGRAM_API_KEY, 'k123');
  assert.equal(req.data.options.DEEPGRAM_SPEECH_MODEL, 'nova-2');
  assert.ok(!('UNRELATED' in req.data.options), 'empty vars are cleared');
});

test('stt events deliver fsmrf header aliases', async(t) => {
  const { ms, mock } = await setup(t);
  const ep = await ms.createEndpoint({});
  const got = new Promise((resolve) => ep.addCustomEventListener('stt.transcription',
    (payload, evtObj) => resolve({payload, evtObj})));
  mock.pushEvent(ep.uuid, 'stt.transcription', {
    vendor: 'deepgram', bugname: 'deepgram_transcribe', finished: 'true',
    json: '{"is_final":true}'
  });
  const {payload, evtObj} = await got;
  assert.equal(payload.is_final, true);
  assert.equal(evtObj.getHeader('transcription-vendor'), 'deepgram');
  assert.equal(evtObj.getHeader('transcription-session-finished'), 'true');
});
