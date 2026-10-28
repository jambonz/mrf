// Endpoint.api('uuid_rime_s2s', ...) -> this._request('s2s.*', data): the rime
// prism session.create mapping (host, path, authType, apiKey, requestId) and
// the shared client.event / session.delete commands.

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

test('uuid_rime_s2s session.create: vendor rime with host, path, auth, key and request id', async () => {
  const { ep, calls } = makeEp();
  const res = await ep.api('uuid_rime_s2s',
    '^^|ep-1|session.create|prism.api.rime.ai|v1/realtime|bearer|rk_test|call-sid-1');
  assert.strictEqual(res.body, '+OK');
  assert.deepStrictEqual(calls[0], {
    cmd: 's2s.start', uuid: 'ep-1',
    data: {
      vendor: 'rime', host: 'prism.api.rime.ai', path: 'v1/realtime',
      authType: 'bearer', apiKey: 'rk_test', requestId: 'call-sid-1'
    }
  });
});

test('uuid_rime_s2s session.create: the request id is optional', async () => {
  const { ep, calls } = makeEp();
  await ep.api('uuid_rime_s2s', '^^|ep-1|session.create|prism.api.rime.ai|v1/realtime|bearer|rk_test');
  assert.strictEqual(calls[0].data.requestId, undefined);
});

test('uuid_rime_s2s client.event and session.delete', async () => {
  const { ep, calls } = makeEp();
  const evt = { type: 'response.create', response: { metadata: { prism_cause: 'proactive' } } };
  await ep.api('uuid_rime_s2s', `^^|ep-1|client.event|${JSON.stringify(evt)}`);
  await ep.api('uuid_rime_s2s', '^^|ep-1|session.delete');
  assert.deepStrictEqual(calls[0], { cmd: 's2s.clientEvent', uuid: 'ep-1', data: { event: evt } });
  assert.strictEqual(calls[1].cmd, 's2s.stop');
});
