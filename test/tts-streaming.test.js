// Endpoint.api('uuid_<vendor>_tts_streaming', ...) -> this._request('tts.*', data): the
// text of a send reaches mediajam exactly as the TtsStreamingBuffer chunked it.

const { test } = require('node:test');
const assert = require('node:assert');
const Endpoint = require('../lib/endpoint');

function makeEp() {
  const calls = [];
  const ms = {
    _connection: {
      request: async (cmd, uuid, data) => {
        calls.push({ cmd, uuid, data });
        return {};
      }
    },
    conn: {}
  };
  return { ep: new Endpoint(ms, 'ep-1', null, null), calls };
}

test('uuid_<vendor>_tts_streaming send keeps the text\'s leading and trailing whitespace', async () => {
  const { ep, calls } = makeEp();
  for (const text of [' Gracias por su tiempo.', 'personalizada. ', ' a|b ', '\n \nHola']) {
    const res = await ep.api('uuid_deepgram_tts_streaming', `^^|ep-1|send|${text}`);
    assert.strictEqual(res.body, '+OK');
    assert.deepStrictEqual(calls.pop(), { cmd: 'tts.send', uuid: 'ep-1', data: { text } }, JSON.stringify(text));
  }
});

test('uuid_<vendor>_tts_streaming commands still map', async () => {
  const { ep, calls } = makeEp();
  await ep.api('uuid_deepgram_tts_streaming', '^^|ep-1|flush');
  await ep.api('uuid_deepgram_tts_streaming', '^^|ep-1|clear');
  await ep.api('uuid_deepgram_tts_streaming', '^^|ep-1|stop');
  assert.deepStrictEqual(calls.map((c) => c.cmd), ['tts.flush', 'tts.clear', 'tts.stop']);
});
