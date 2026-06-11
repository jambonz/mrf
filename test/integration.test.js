// Integration tests against a real mediajam server binary.
//
//   go build -o /tmp/mediajam ./cmd/mediajam   (in the mediajam repo)
//   MEDIAJAM_BIN=/tmp/mediajam npm test
//
// Skipped when MEDIAJAM_BIN is unset (e.g. in CI without the binary).

const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const dgram = require('node:dgram');
const net = require('node:net');
const Mrf = require('..');
const { buildRtp, parseRtp } = require('./support/rtp');

const BIN = process.env.MEDIAJAM_BIN;
const skip = BIN ? false : 'set MEDIAJAM_BIN to run integration tests';

const CONTROL_PORT = 19090 + (process.pid % 1000);

let serverProc;
let mrf;
let ms;

async function startServer() {
  serverProc = spawn(BIN, [
    '-addr', `127.0.0.1:${CONTROL_PORT}`,
    '-rtp-ip', '127.0.0.1',
    '-advertise-ip', '127.0.0.1',
    '-rtp-port-min', '46000',
    '-rtp-port-max', '46998',
    '-log-level', 'warn'
  ], { stdio: ['ignore', 'inherit', 'inherit'] });

  // wait for the control port to accept
  for (let i = 0; i < 50; i++) {
    const ok = await new Promise((resolve) => {
      const s = net.connect({ host: '127.0.0.1', port: CONTROL_PORT }, () => {
        s.destroy();
        resolve(true);
      });
      s.on('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('mediajam did not start');
}

function makeCaller() {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    sock.bind(0, '127.0.0.1', () => resolve(sock));
  });
}

function sdpFor(sock) {
  const { port } = sock.address();
  return 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=t\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\n' +
    `m=audio ${port} RTP/AVP 0 101\r\na=rtpmap:0 PCMU/8000\r\n` +
    'a=rtpmap:101 telephone-event/8000\r\na=fmtp:101 0-16\r\n';
}

/** stream caller RTP at 20ms cadence until stopped; returns stop fn */
function pumpRtp(sock, destPort, fillByte) {
  const payload = Buffer.alloc(160, fillByte);
  let seq = 1, ts = 0;
  const iv = setInterval(() => {
    sock.send(buildRtp({ pt: 0, seq: seq++, ts: ts += 160, ssrc: 0x1234, payload }), destPort, '127.0.0.1');
  }, 20);
  return () => clearInterval(iv);
}

/** collect RTP packets arriving at a caller socket until pred matches */
function waitForPacket(sock, pred, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sock.removeListener('message', onMsg);
      reject(new Error('timed out waiting for RTP'));
    }, timeoutMs);
    const onMsg = (msg) => {
      const pkt = parseRtp(msg);
      if (pkt && pred(pkt)) {
        clearTimeout(timer);
        sock.removeListener('message', onMsg);
        resolve(pkt);
      }
    };
    sock.on('message', onMsg);
  });
}

test('integration: connect', { skip }, async() => {
  await startServer();
  mrf = new Mrf();
  ms = await mrf.connect({ address: '127.0.0.1', port: CONTROL_PORT });
  assert.equal(ms.connected, true);
  assert.ok(ms.serverVersion.startsWith('mediajam/'));
});

test('integration: createEndpoint answer mode', { skip }, async(t) => {
  const caller = await makeCaller();
  t.after(() => caller.close());
  const ep = await ms.createEndpoint({ remoteSdp: sdpFor(caller) });
  assert.equal(ep.local.mediaIp, '127.0.0.1');
  assert.ok(ep.local.mediaPort >= 46000 && ep.local.mediaPort <= 46998);
  // server ticks silence toward the caller immediately
  await waitForPacket(caller, (p) => p.pt === 0 && p.payload.length === 160, 2000);
  await ep.destroy();
});

test('integration: play tone resolves with duration and renders audio', { skip }, async(t) => {
  const caller = await makeCaller();
  t.after(() => caller.close());
  const ep = await ms.createEndpoint({ remoteSdp: sdpFor(caller) });
  t.after(() => ep.destroy());

  const nonSilence = waitForPacket(caller,
    (p) => p.pt === 0 && p.payload.some((b) => b !== 0xff && b !== 0x7f), 2000);
  const result = await ep.play('tone://?freq=800&duration=200');
  assert.equal(result.reason, 'completed');
  assert.ok(result.playbackMilliseconds >= 160 && result.playbackMilliseconds <= 260,
    `playbackMilliseconds = ${result.playbackMilliseconds}`);
  await nonSilence;
});

test('integration: uuid_break stops playback', { skip }, async(t) => {
  const caller = await makeCaller();
  t.after(() => caller.close());
  const ep = await ms.createEndpoint({ remoteSdp: sdpFor(caller) });
  t.after(() => ep.destroy());

  const playDone = ep.play('silence://?duration=10000');
  await new Promise((r) => setTimeout(r, 100));
  await ep.api('uuid_break', ep.uuid);
  const result = await playDone;
  assert.equal(result.reason, 'stopped');
});

test('integration: bridge carries audio between endpoints', { skip }, async(t) => {
  const callerA = await makeCaller();
  const callerB = await makeCaller();
  t.after(() => {
    callerA.close();
    callerB.close();
  });
  const epA = await ms.createEndpoint({ remoteSdp: sdpFor(callerA) });
  const epB = await ms.createEndpoint({ remoteSdp: sdpFor(callerB) });
  t.after(async() => {
    await epA.destroy();
    await epB.destroy();
  });

  await epA.bridge(epB);
  const stopPump = pumpRtp(callerA, epA.local.mediaPort, 0x12);
  t.after(stopPump);

  // caller B hears caller A's pattern
  await waitForPacket(callerB,
    (p) => p.pt === 0 && p.payload[0] === 0x12 && p.payload[80] === 0x12, 3000);

  // unbridge reverts B to silence
  await epA.unbridge();
});

test('integration: outbound DTMF arrives as RFC2833', { skip }, async(t) => {
  const caller = await makeCaller();
  t.after(() => caller.close());
  const ep = await ms.createEndpoint({ remoteSdp: sdpFor(caller) });
  t.after(() => ep.destroy());

  const dtmfPkt = waitForPacket(caller, (p) => p.pt === 101, 3000);
  await ep.execute('send_dtmf', '7@120');
  const pkt = await dtmfPkt;
  assert.equal(pkt.payload[0], 7); // event code for digit 7
});

test('integration: inbound RFC2833 emits dtmf event', { skip }, async(t) => {
  const caller = await makeCaller();
  t.after(() => caller.close());
  const ep = await ms.createEndpoint({ remoteSdp: sdpFor(caller) });
  t.after(() => ep.destroy());

  const dtmf = new Promise((resolve) => ep.once('dtmf', resolve));
  // event 5, end bit set, duration 960 samples (120ms @8k)
  const payload = Buffer.from([5, 0x8a, 0x03, 0xc0]);
  for (let i = 0; i < 3; i++) {
    caller.send(buildRtp({ pt: 101, seq: 100 + i, ts: 5000, ssrc: 0x99, payload }),
      ep.local.mediaPort, '127.0.0.1');
  }
  const evt = await dtmf;
  assert.equal(evt.dtmf, '5');
  assert.equal(evt.duration, 120);
  assert.equal(evt.source, 'rfc2833');
});

test('integration: teardown', { skip }, async() => {
  ms.destroy();
  serverProc.kill('SIGTERM');
  await new Promise((r) => serverProc.once('exit', r));
});
