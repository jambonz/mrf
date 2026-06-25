const { test } = require('node:test');
const assert = require('node:assert');
const Connection = require('../lib/connection');

// Regression for the 0.2.8 teardown-race fix: a command reply with
// err.code unknown_endpoint/unknown_session must resolve as a benign no-op
// WITHOUT crashing — even when the injected logger has no .debug method (some
// callers, e.g. feature-server, pass an info/error-only logger). `logger?.debug`
// still throws "debug is not a function" when logger exists but the method does
// not, which previously took the whole process down via an uncaught exception.

function makePending(conn, id) {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  conn.pending.set(id, {
    resolve,
    reject: (e) => reject(e || new Error('rejected')),
    timer: setTimeout(() => {}, 1000),
  });
  return promise;
}

for (const code of ['unknown_endpoint', 'unknown_session']) {
  test(`${code} reply resolves as a no-op with a logger lacking .debug`, async() => {
    const conn = new Connection({ info() {}, error() {} }); // no .debug
    const p = makePending(conn, '1');
    assert.doesNotThrow(() =>
      conn._onFrame({ t: 'res', id: '1', ok: false, err: { code, msg: 'gone' } }));
    assert.deepEqual(await p, {}); // resolved, not rejected
  });
}

test('a genuine command failure still rejects', async() => {
  const conn = new Connection({ info() {}, error() {} });
  const p = makePending(conn, '2');
  conn._onFrame({ t: 'res', id: '2', ok: false, err: { code: 'bad_request', msg: 'nope' } });
  await assert.rejects(p, (e) => e.code === 'bad_request');
});

test('unknown_endpoint logs at debug when the logger supports it', async() => {
  let logged = false;
  const conn = new Connection({ info() {}, error() {}, debug() { logged = true; } });
  const p = makePending(conn, '3');
  conn._onFrame({ t: 'res', id: '3', ok: false, err: { code: 'unknown_endpoint' } });
  assert.deepEqual(await p, {});
  assert.equal(logged, true);
});
