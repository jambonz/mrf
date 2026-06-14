// Unit tests for the licensing conduit translation in the Endpoint adapter:
// the FS uuid_jambonz_licensing api() and the jambonz_session_token_2 set()
// are routed to mediajam's licensing.* control commands. The control transport
// is mocked so these run without a server binary.

const { test } = require('node:test');
const assert = require('node:assert');
const Endpoint = require('../lib/endpoint');

// Build an Endpoint whose control requests are captured in `calls`. `handler`
// returns the response (or throws) per command.
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

test('generate-session-token mints token-1 (FS +OK shape) and stashes it', async () => {
  const { ep, calls } = makeEp((cmd) => (cmd === 'licensing.generate-token' ? { token: 'TOK1' } : {}));
  const res = await ep.api('uuid_jambonz_licensing', 'generate-session-token ep-1 call-123');
  assert.deepStrictEqual(calls[0], { cmd: 'licensing.generate-token', data: { callId: 'call-123' } });
  assert.strictEqual(res.body, '+OK TOK1');
  assert.strictEqual(ep._sessionToken1, 'TOK1');
});

test('unlicensed binary: generate returns -ERR (no token), feature-server then skips the header', async () => {
  const { ep } = makeEp(() => { throw new Error('not licensed'); });
  const res = await ep.api('uuid_jambonz_licensing', 'generate-session-token ep-1 call-9');
  assert.match(res.body, /^-ERR/);
  assert.ok(!ep._sessionToken1);
});

test('token-2 is validated against the stashed token-1', async () => {
  const { ep, calls } = makeEp((cmd) => (cmd === 'licensing.generate-token' ? { token: 'TOK1' } : { valid: true }));
  await ep.api('uuid_jambonz_licensing', 'generate-session-token ep-1 call-123');
  await ep.set('jambonz_session_token_2', 'TOK2');
  const v = calls.find((c) => c.cmd === 'licensing.validate-token-2');
  assert.deepStrictEqual(v.data, { token1: 'TOK1', token2: 'TOK2' });
  assert.strictEqual(ep.connected, true);
});

test('invalid token-2 tears the endpoint down (destroy)', async () => {
  const { ep } = makeEp((cmd) => {
    if (cmd === 'licensing.generate-token') return { token: 'TOK1' };
    if (cmd === 'licensing.validate-token-2') throw new Error('session token 2 invalid');
    return {};
  });
  await ep.api('uuid_jambonz_licensing', 'generate-session-token ep-1 call-123');
  let destroyed = null;
  ep.on('destroy', (evt) => { destroyed = evt; });
  await ep.set('jambonz_session_token_2', 'BAD');
  assert.strictEqual(ep.connected, false);
  assert.strictEqual(destroyed.reason, 'license-violation');
});

test('token-2 with no token-1 (unlicensed) is a no-op — no validate call, no teardown', async () => {
  const { ep, calls } = makeEp(() => { throw new Error('should not be called'); });
  let destroyed = false;
  ep.on('destroy', () => { destroyed = true; });
  await ep.set('jambonz_session_token_2', 'X');
  assert.ok(!calls.find((c) => c.cmd === 'licensing.validate-token-2'));
  assert.strictEqual(destroyed, false);
  assert.strictEqual(ep.connected, true);
});
