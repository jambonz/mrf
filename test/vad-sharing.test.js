// Unit tests for shared (ref-counted) VAD sessions in the Endpoint adapter.
// Consumers on one endpoint that request identical VAD params (e.g. agent
// turn-taking + the stt-latency calculator, both silero/continuous) share a
// single mediajam silero session instead of each spawning their own. The
// control transport is mocked so these run without a server binary.

const { test } = require('node:test');
const assert = require('node:assert');
const Endpoint = require('../lib/endpoint');

function makeEp(handler) {
  const calls = [];
  const ms = {
    _connection: {
      request: async (cmd, uuid, data) => {
        calls.push({ cmd, data });
        return handler ? handler(cmd, data) : {};
      }
    },
    conn: {}
  };
  return { ep: new Endpoint(ms, 'ep-1', null, null), calls };
}
const starts = (calls) => calls.filter((c) => c.cmd === 'vad.start');
const stops = (calls) => calls.filter((c) => c.cmd === 'vad.stop');

test('identical-param VAD requests share one silero session', async () => {
  const { ep, calls } = makeEp();
  // agent turn-taking VAD (no bugname -> mediajam defaults to vad_silero)
  await ep.startVadDetection({ vendor: 'silero', strategy: 'continuous' });
  // stt-latency calculator, same params
  await ep.startVadDetection({ vendor: 'silero', strategy: 'continuous', bugname: 'stt-latency-calculator-vad' });
  assert.strictEqual(starts(calls).length, 1, 'only one vad.start for identical params');

  // first stop: a consumer remains, so the session stays up
  await ep.stopVadDetection({ strategy: 'continuous', bugname: 'stt-latency-calculator-vad' });
  assert.strictEqual(stops(calls).length, 0, 'no vad.stop while a consumer remains');

  // last stop: session torn down
  await ep.stopVadDetection({ strategy: 'continuous' });
  assert.strictEqual(stops(calls).length, 1, 'one vad.stop after the last consumer releases');
});

test('different params get separate sessions', async () => {
  const { ep, calls } = makeEp();
  await ep.startVadDetection({ strategy: 'continuous' });
  await ep.startVadDetection({ strategy: 'one-shot' });             // distinct lifecycle
  await ep.startVadDetection({ strategy: 'continuous', threshold: 0.7 }); // distinct threshold
  assert.strictEqual(starts(calls).length, 3, 'distinct signatures -> distinct sessions');
});

test('refcount balances across interleaved start/stop', async () => {
  const { ep, calls } = makeEp();
  await ep.startVadDetection({ strategy: 'continuous' }); // count 1
  await ep.startVadDetection({ strategy: 'continuous' }); // count 2
  await ep.startVadDetection({ strategy: 'continuous' }); // count 3
  assert.strictEqual(starts(calls).length, 1);
  await ep.stopVadDetection({ strategy: 'continuous' }); // 2
  await ep.stopVadDetection({ strategy: 'continuous' }); // 1
  assert.strictEqual(stops(calls).length, 0);
  await ep.stopVadDetection({ strategy: 'continuous' }); // 0 -> stop
  assert.strictEqual(stops(calls).length, 1);
  // session fully released — a new start spawns a fresh session
  await ep.startVadDetection({ strategy: 'continuous' });
  assert.strictEqual(starts(calls).length, 2);
});

test('a failed vad.start releases the slot so a retry re-sends', async () => {
  let fail = true;
  const { ep, calls } = makeEp((cmd) => {
    if (cmd === 'vad.start' && fail) { fail = false; throw new Error('boom'); }
    return {};
  });
  await assert.rejects(ep.startVadDetection({ strategy: 'continuous' }));
  await ep.startVadDetection({ strategy: 'continuous' }); // retry
  assert.strictEqual(starts(calls).length, 2, 'retry sends a fresh vad.start after failure');
});
