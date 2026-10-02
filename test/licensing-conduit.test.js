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

test('nolicense server (hello licensing:false): generate skips the control round-trip', async () => {
  const { ep, calls } = makeEp(() => { throw new Error('should not be called'); });
  ep.ms.licensingEnabled = false;
  const res = await ep.api('uuid_jambonz_licensing', 'generate-session-token ep-1 call-7');
  assert.strictEqual(res.body, '+OK'); // success, no token -> FS adds no header
  assert.strictEqual(ep._sessionToken1, '');
  assert.strictEqual(calls.length, 0); // no licensing.generate-token request issued
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

/* mediajam rejects a token-2 older than 40s; the feature-server sets the same
   token again on each later provisional and on the 200 OK. */
const expiringValidator = () => {
  let validated = 0;
  return (cmd) => {
    if (cmd === 'licensing.generate-token') return { token: 'TOK1' };
    if (cmd === 'licensing.validate-token-2') {
      if (validated++ > 0) throw new Error('session token 2 invalid');
      return { valid: true };
    }
    return {};
  };
};

test('the same token-2 is validated once: a re-set after a long ring does not tear down', async () => {
  const { ep, calls } = makeEp(expiringValidator());
  await ep.api('uuid_jambonz_licensing', 'generate-session-token ep-1 call-123');
  let destroyed = false;
  ep.on('destroy', () => { destroyed = true; });
  await ep.set('jambonz_session_token_2', 'TOK2');   // 180, fresh
  await ep.set('jambonz_session_token_2', 'TOK2');   // 183 at 45s, same token
  await ep.set('jambonz_session_token_2', 'TOK2');   // 200 OK, same token
  assert.strictEqual(calls.filter((c) => c.cmd === 'licensing.validate-token-2').length, 1);
  assert.strictEqual(destroyed, false);
  assert.strictEqual(ep.connected, true);
});

test('a different token-2 is still validated (and torn down if invalid)', async () => {
  const { ep, calls } = makeEp(expiringValidator());
  await ep.api('uuid_jambonz_licensing', 'generate-session-token ep-1 call-123');
  let destroyed = null;
  ep.on('destroy', (evt) => { destroyed = evt; });
  await ep.set('jambonz_session_token_2', 'TOK2');
  await ep.set('jambonz_session_token_2', 'OTHER');
  assert.strictEqual(calls.filter((c) => c.cmd === 'licensing.validate-token-2').length, 2);
  assert.strictEqual(ep.connected, false);
  assert.strictEqual(destroyed.reason, 'license-violation');
});

test('a token-2 that failed validation is not remembered as validated', async () => {
  const { ep, calls } = makeEp((cmd) => {
    if (cmd === 'licensing.generate-token') return { token: 'TOK1' };
    if (cmd === 'licensing.validate-token-2') throw new Error('session token 2 invalid');
    return {};
  });
  await ep.api('uuid_jambonz_licensing', 'generate-session-token ep-1 call-123');
  await ep.set('jambonz_session_token_2', 'BAD');
  assert.strictEqual(ep._validatedToken2 || '', '');
  assert.strictEqual(calls.filter((c) => c.cmd === 'licensing.validate-token-2').length, 1);
});

test('minting a new token-1 clears the remembered token-2', async () => {
  const { ep, calls } = makeEp((cmd) => (cmd === 'licensing.generate-token' ? { token: 'TOK1' } : { valid: true }));
  await ep.api('uuid_jambonz_licensing', 'generate-session-token ep-1 call-123');
  await ep.set('jambonz_session_token_2', 'TOK2');
  await ep.api('uuid_jambonz_licensing', 'generate-session-token ep-1 call-456');
  await ep.set('jambonz_session_token_2', 'TOK2');
  assert.strictEqual(calls.filter((c) => c.cmd === 'licensing.validate-token-2').length, 2);
});
