const { test } = require('node:test');
const assert = require('node:assert');
const { translatePlayUrl } = require('../lib/utils');
const patterns = require('../lib/tone-patterns');

const US_RING = 'tone_stream://%(2000,4000,440,480)';
const GB_RING = 'tone_stream://%(400,200,400,450);%(400,2000,400,450)';

test('tone_stream shorthand expands to the country pattern', () => {
  assert.equal(translatePlayUrl('tone_stream://us.ring'), US_RING);
  assert.equal(translatePlayUrl('tone_stream://gb.ring'), GB_RING);
});

test('vn (Vietnam, not in E.180) resolves to its ringback', () => {
  assert.equal(translatePlayUrl('tone_stream://vn.ring'), 'tone_stream://%(1000,4000,425)');
});

test('tone aliases ring/ringing/ringback are equivalent', () => {
  assert.equal(translatePlayUrl('tone_stream://gb.ringing'), GB_RING);
  assert.equal(translatePlayUrl('tone_stream://gb.ringback'), GB_RING);
});

test('shorthand is case-insensitive', () => {
  assert.equal(translatePlayUrl('tone_stream://US.RING'), US_RING);
  assert.equal(translatePlayUrl('tone_stream://Gb.RingBack'), GB_RING);
});

test('uk is accepted as an alias for gb', () => {
  assert.equal(translatePlayUrl('tone_stream://uk.ring'), GB_RING);
});

test('unknown country code throws', () => {
  assert.throws(() => translatePlayUrl('tone_stream://zz.ring'), /no tone_stream pattern/);
});

test('known country but unpopulated tone type throws', () => {
  assert.throws(() => translatePlayUrl('tone_stream://us.busy'), /no tone_stream pattern/);
});

test('a real TGML tone_stream url still passes through unchanged', () => {
  const tgml = 'tone_stream://%(2000,4000,440,480);loops=-1';
  assert.equal(translatePlayUrl(tgml), tgml);
});

test('silence_stream translation is unaffected', () => {
  assert.equal(translatePlayUrl('silence_stream://500'), 'silence://?duration=500');
});

test('every pattern is a single-period tone_stream url (no ;loops=)', () => {
  for (const [cc, tones] of Object.entries(patterns)) {
    for (const [tone, url] of Object.entries(tones)) {
      assert.match(url, /^tone_stream:\/\/%\(/, `${cc}.${tone} should start with a %() pattern`);
      assert.ok(!/;loops=/.test(url), `${cc}.${tone} should not carry a ;loops= suffix`);
    }
  }
});

test('end-to-end: ep.play expands the shorthand before play.start', async(t) => {
  const Mrf = require('..');
  const MockMediajam = require('./support/mock-server');
  const mock = new MockMediajam();
  const port = await mock.listen();
  const mrf = new Mrf();
  const ms = await mrf.connect({ address: '127.0.0.1', port });
  t.after(() => { ms.destroy(); mock.close(); });

  const ep = await ms.createEndpoint({});
  await ep.play('tone_stream://gb.ring');
  const playReq = mock.requests.find((r) => r.cmd === 'play.start');
  assert.deepEqual(playReq.data.urls, [GB_RING]);
});
