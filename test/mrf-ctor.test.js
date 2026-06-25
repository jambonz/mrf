const { test } = require('node:test');
const assert = require('node:assert');
const Mrf = require('..');

const logger = () => ({ info() {}, error() {}, debug() {} });
// a drachtio Srf has .locals and an .info SIP-method handler, but no .debug
const fakeSrf = (extra = {}) => ({ locals: {}, info() {}, error() {}, ...extra });

test('a drachtio Srf is never mistaken for a logger', () => {
  const srf = fakeSrf();
  const m = new Mrf(srf);
  assert.equal(m.srf, srf, 'the Srf is retained as the srf');
  assert.notEqual(m.logger, srf, 'the Srf must not be used as the logger');
  assert.equal(typeof m.logger.debug, 'function', 'logger has .debug (noop fallback)');
});

test('new Mrf(srf, {logger}) uses the explicit logger', () => {
  const log = logger();
  const m = new Mrf(fakeSrf(), { logger: log });
  assert.equal(m.logger, log);
});

test('new Mrf(srf) picks up srf.locals.logger when present', () => {
  const log = logger();
  const m = new Mrf(fakeSrf({ locals: { logger: log } }));
  assert.equal(m.logger, log);
});

test('new Mrf(logger) — bare logger as first arg — still supported', () => {
  const log = logger();
  const m = new Mrf(log);
  assert.equal(m.logger, log);
  assert.equal(m.srf, null);
});

test('new Mrf({logger}) — options object as first arg — still supported', () => {
  const log = logger();
  const m = new Mrf({ logger: log });
  assert.equal(m.logger, log);
  assert.equal(m.srf, null);
});

test('new Mrf() falls back to a noop logger with all methods', () => {
  const m = new Mrf();
  assert.equal(typeof m.logger.debug, 'function');
  assert.equal(typeof m.logger.info, 'function');
  assert.equal(typeof m.logger.error, 'function');
});
