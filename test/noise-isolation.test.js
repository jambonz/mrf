// noise.start carries the channel vars, where cloud vendors find credentials.

const { test } = require('node:test');
const assert = require('node:assert');
const Endpoint = require('../lib/endpoint');

function makeEp() {
  const calls = [];
  const ms = {
    _connection: {
      request: async (cmd, uuid, data) => {
        calls.push({ cmd, data });
        return {};
      }
    },
    conn: {}
  };
  return { ep: new Endpoint(ms, 'ep-1', null, null), calls };
}

test('noise.start forwards args and channel vars', async () => {
  const { ep, calls } = makeEp();
  await ep.set({KUGELAUDIO_NOISE_API_KEY: 'k1'});
  const res = await ep.api('uuid_kugelaudio_noise_isolation', 'ep-1 start read 80 clarity-1');
  assert.strictEqual(res.body, '+OK');
  const start = calls.find((c) => c.cmd === 'noise.start');
  assert.deepStrictEqual(start.data, {
    vendor: 'kugelaudio',
    direction: 'read',
    level: 80,
    model: 'clarity-1',
    options: {KUGELAUDIO_NOISE_API_KEY: 'k1'}
  });
});
