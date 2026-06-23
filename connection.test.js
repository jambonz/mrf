'use strict';

const test = require('node:test');
const assert = require('node:assert');
const Connection = require('./lib/connection');

const nullLogger = {debug() {}, info() {}, warn() {}, error() {}};

function pending(conn, id) {
  const timer = setTimeout(() => {}, 0);
  clearTimeout(timer);
  let resolved, rejected;
  conn.pending.set(id, {
    resolve: (v) => { resolved = v ?? true; },
    reject: (e) => { rejected = e; },
    timer,
  });
  return () => ({resolved, rejected});
}

test('unknown_endpoint command reply resolves instead of rejecting (teardown race)', () => {
  const conn = new Connection(nullLogger);
  const state = pending(conn, 'id1');
  conn._onFrame({t: 'res', id: 'id1', ok: false, err: {code: 'unknown_endpoint', msg: 'no endpoint X'}});
  const {resolved, rejected} = state();
  assert.ok(resolved, 'should resolve');
  assert.equal(rejected, undefined, 'should not reject');
  assert.equal(conn.pending.has('id1'), false, 'pending entry cleared');
});

test('unknown_session command reply also resolves', () => {
  const conn = new Connection(nullLogger);
  const state = pending(conn, 'id2');
  conn._onFrame({t: 'res', id: 'id2', ok: false, err: {code: 'unknown_session'}});
  assert.ok(state().resolved, 'should resolve');
});

test('other command errors still reject with their code', () => {
  const conn = new Connection(nullLogger);
  const state = pending(conn, 'id3');
  conn._onFrame({t: 'res', id: 'id3', ok: false, err: {code: 'bad_request', msg: 'nope'}});
  const {resolved, rejected} = state();
  assert.equal(resolved, undefined, 'should not resolve');
  assert.ok(rejected instanceof Error, 'should reject with an Error');
  assert.equal(rejected.code, 'bad_request');
});

test('ok command reply resolves with data', () => {
  const conn = new Connection(nullLogger);
  const state = pending(conn, 'id4');
  conn._onFrame({t: 'res', id: 'id4', ok: true, data: {foo: 1}});
  assert.deepEqual(state().resolved, {foo: 1});
});
