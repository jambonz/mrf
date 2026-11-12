// Endpoint.api('uuid_phonic_s2s', ...) -> this._request('s2s.*', data): the phonic
// session.create mapping and a client.event whose JSON carries a '|'.

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

test('uuid_phonic_s2s session.create: vendor phonic with host, path, auth and key', async () => {
  const { ep, calls } = makeEp();
  const res = await ep.api('uuid_phonic_s2s', '^^|ep-1|session.create|api.phonic.ai|v1/sts/ws|bearer|ph_test');
  assert.strictEqual(res.body, '+OK');
  assert.deepStrictEqual(calls[0], {
    cmd: 's2s.start', uuid: 'ep-1',
    data: { vendor: 'phonic', host: 'api.phonic.ai', path: 'v1/sts/ws', authType: 'bearer', apiKey: 'ph_test' }
  });
});

test('uuid_phonic_s2s client.event and session.delete', async () => {
  const { ep, calls } = makeEp();
  const evt = { type: 'config', system_prompt: 'say a|b', welcome_message: 'Hi' };
  await ep.api('uuid_phonic_s2s', `^^|ep-1|client.event|${JSON.stringify(evt)}`);
  await ep.api('uuid_phonic_s2s', '^^|ep-1|session.delete');
  assert.deepStrictEqual(calls[0], { cmd: 's2s.clientEvent', uuid: 'ep-1', data: { event: evt } });
  assert.strictEqual(calls[1].cmd, 's2s.stop');
});
