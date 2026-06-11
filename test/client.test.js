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
  assert.equal(result.playbackMilliseconds, 100);
  assert.deepEqual(events, ['start', 'stop']);
});

test('play url translation', async(t) => {
  const { ms, mock } = await setup(t);
  const ep = await ms.createEndpoint({});
  await ep.play(['silence_stream://500', 'tone_stream://%(250,0,440)', 'https://x.test/a.wav']);
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

test('destroy emits destroy event and removes endpoint', async(t) => {
  const { ms } = await setup(t);
  const ep = await ms.createEndpoint({});
  const destroyed = new Promise((resolve) => ep.once('destroy', resolve));
  await ep.destroy();
  await destroyed;
  assert.equal(ep.connected, false);
  assert.equal(ms.endpointCount, 0);
});

test('dtmf events surface in fsmrf shape', async(t) => {
  const { ms, mock } = await setup(t);
  const ep = await ms.createEndpoint({});
  const dtmf = new Promise((resolve) => ep.once('dtmf', resolve));
  mock.pushEvent(ep.uuid, 'dtmf', { digit: '5', durationMs: 120, source: 'rfc2833' });
  const evt = await dtmf;
  assert.deepEqual(evt, { dtmf: '5', duration: 120, source: 'rfc2833' });
});

test('custom event listeners receive unknown events', async(t) => {
  const { ms, mock } = await setup(t);
  const ep = await ms.createEndpoint({});
  const got = new Promise((resolve) => ep.addCustomEventListener('stt.transcription', resolve));
  mock.pushEvent(ep.uuid, 'stt.transcription', { vendor: 'deepgram', body: { text: 'hi' } });
  const data = await got;
  assert.equal(data.vendor, 'deepgram');
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

test('connection loss destroys endpoints with connectionLost', async() => {
  const mock = new MockMediajam();
  const port = await mock.listen();
  const mrf = new Mrf();
  const ms = await mrf.connect({ address: '127.0.0.1', port });
  const ep = await ms.createEndpoint({});
  const destroyed = new Promise((resolve) => ep.once('destroy', resolve));
  const ended = new Promise((resolve) => ms.conn.once('esl::end', resolve));
  mock.close();
  for (const socket of mock.sockets) socket.destroy();
  const evt = await destroyed;
  await ended;
  assert.equal(evt.reason, 'connectionLost');
});
