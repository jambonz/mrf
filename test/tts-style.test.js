// Endpoint.api('uuid_<vendor>_tts_streaming', '...|style|<json>') -> tts.style

const { test } = require('node:test');
const assert = require('node:assert');
const Endpoint = require('../lib/endpoint');

function makeEp(fail) {
  const calls = [];
  const ms = {
    _connection: {
      request: async (cmd, uuid, data) => {
        calls.push({ cmd, uuid, data });
        if (fail) throw new Error(fail);
        return {};
      }
    },
    conn: {}
  };
  return { ep: new Endpoint(ms, 'ep-1', null, null), calls };
}

test('style sends tts.style with the parsed style', async () => {
  const { ep, calls } = makeEp();
  const res = await ep.api('uuid_cartesia_tts_streaming', '^^|ep-1|style|{"emotion":"sad","speed":"slow"}');
  assert.strictEqual(res.body, '+OK');
  assert.deepStrictEqual(calls[0],
    { cmd: 'tts.style', uuid: 'ep-1', data: { style: { emotion: 'sad', speed: 'slow' } } });
});

test('style: malformed json and a media server refusal answer -ERR', async () => {
  const bad = makeEp();
  assert.match((await bad.ep.api('uuid_cartesia_tts_streaming', '^^|ep-1|style|{oops')).body, /^-ERR/);
  assert.strictEqual(bad.calls.length, 0);
  const refused = makeEp('tts.style not supported by dialect');
  assert.match((await refused.ep.api('uuid_deepgram_tts_streaming', '^^|ep-1|style|{}')).body,
    /^-ERR tts.style not supported/);
});
