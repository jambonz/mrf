// Unit tests for the conference (room.*) shim in the Endpoint + MediaServer
// adapters: join flags, the `conference …` api string/array forms, the
// non_moderator no-op, and the room.* -> conference::maintenance event reshape
// the feature-server conference verb consumes. Transport is mocked.

const { test } = require('node:test');
const assert = require('node:assert');
const Endpoint = require('../lib/endpoint');
const MediaServer = require('../lib/mediaserver');

function makeEp(handler) {
  const calls = [];
  const ms = {
    _connection: {
      request: async (cmd, uuid, data) => {
        calls.push({ cmd, uuid, data });
        return handler ? handler(cmd, data) : {};
      }
    },
    conn: {}
  };
  return { ep: new Endpoint(ms, 'ep-1', null, null), calls };
}

test('join sends room.join with mapped flags and returns fsmrf shape', async () => {
  const { ep, calls } = makeEp((cmd) => {
    if (cmd === 'room.join') return { roomUuid: 'u-1', memberId: 7 };
    return {};
  });
  const res = await ep.join('myconf', { flags: { moderator: true, endconf: true, mute: true } });

  const join = calls.find((c) => c.cmd === 'room.join');
  assert.deepStrictEqual(join.data, { room: 'myconf', moderator: true, endConf: true, startMuted: true });
  assert.deepStrictEqual(res, { memberId: '7', confUuid: 'u-1' });
});

test('api conference get count returns the count as a body string', async () => {
  const { ep } = makeEp((cmd) => (cmd === 'room.query' ? { found: true, count: 3 } : {}));
  const res = await ep.api('conference', ['myconf', 'get', 'count']);
  assert.deepStrictEqual(res, { body: '3' });
});

test('api conference get count returns 0 when the room is gone', async () => {
  const { ep } = makeEp((cmd) => (cmd === 'room.query' ? { found: false } : {}));
  const res = await ep.api('conference', ['myconf', 'get', 'count']);
  assert.deepStrictEqual(res, { body: '0' });
});

test('api conference mute/kick (string form) target a numeric member', async () => {
  const { ep, calls } = makeEp();
  await ep.api('conference myconf mute 5');
  await ep.api('conference myconf undeaf 5');
  await ep.api('conference myconf kick 9');

  assert.deepStrictEqual(calls.map((c) => [c.cmd, c.data]), [
    ['room.member.mute', { room: 'myconf', member: 5 }],
    ['room.member.undeaf', { room: 'myconf', member: 5 }],
    ['room.member.kick', { room: 'myconf', member: 9 }]
  ]);
});

test('api conference mute non_moderator is a graceful no-op (Phase 2)', async () => {
  const { ep, calls } = makeEp();
  const res = await ep.api('conference myconf mute non_moderator');
  assert.deepStrictEqual(res, { body: '+OK' });
  assert.strictEqual(calls.length, 0, 'no room.member.* request for the non_moderator selector');
});

test('api conference set max_members maps to room.setMaxMembers', async () => {
  const { ep, calls } = makeEp();
  await ep.api('conference', 'myconf set max_members 5');
  const c = calls.find((x) => x.cmd === 'room.setMaxMembers');
  assert.deepStrictEqual(c.data, { room: 'myconf', max: 5 });
});

test('api conference set endconference_grace_time is accepted (no-op)', async () => {
  const { ep, calls } = makeEp();
  const res = await ep.api('conference', 'myconf set endconference_grace_time 30');
  assert.deepStrictEqual(res, { body: '+OK' });
  assert.strictEqual(calls.length, 0);
});

test('conference play issues room.play (bong->beep, urls pass through); record no-ops', async () => {
  const { ep, calls } = makeEp();
  assert.deepStrictEqual(await ep.api('conference myconf record /tmp/x'), { body: '+OK' });
  assert.deepStrictEqual(await ep.api('conference myconf play tone_stream://v=-7;%(100,0,941)'), { body: '+OK' });
  assert.deepStrictEqual(await ep.api('conference myconf play https://x/a.wav'), { body: '+OK' });
  assert.deepStrictEqual(calls.map((c) => [c.cmd, c.data]), [
    ['room.play', { room: 'myconf', url: 'tone://?freq=440&duration=250&gainDb=-4' }],
    ['room.play', { room: 'myconf', url: 'https://x/a.wav' }]
  ]);
});

test('coach/whisper: tag, relate, and getNonMatchingConfParticipants translate to room.*', async () => {
  const { ep, calls } = makeEp((cmd) =>
    cmd === 'room.getTagMembers' ? { memberIds: [5, 9] } : {});

  await ep.api('conference', ['myconf', 'tag', 7, 'agent']);
  await ep.api('conference', ['myconf', 'tag', 7]);                  // omitted tag clears it
  await ep.api('conference', ['myconf', 'relate', 3, '5,9', 'nospeak']);
  await ep.api('conference', ['myconf', 'relate', 3, '5', 'clear']);
  const nonMatching = await ep.getNonMatchingConfParticipants('myconf', 'agent');

  assert.deepStrictEqual(calls.map((c) => [c.cmd, c.data]), [
    ['room.member.setTag', { room: 'myconf', member: 7, tag: 'agent' }],
    ['room.member.setTag', { room: 'myconf', member: 7, tag: '' }],
    ['room.relate', { room: 'myconf', member: 3, targets: [5, 9], mode: 'nospeak' }],
    ['room.relate', { room: 'myconf', member: 3, targets: [5], mode: 'clear' }],
    ['room.getTagMembers', { room: 'myconf', tag: 'agent', nomatch: true }]
  ]);
  assert.deepStrictEqual(nonMatching, [5, 9]);
});

test('room.tagChanged reshapes into a "tag" action carrying the Tag header', async () => {
  const { ep } = makeEp();
  let evt;
  ep.conn.on('esl::event::CUSTOM::*', (e) => { evt = e; });
  ep._onEvent('room.tagChanged', { memberId: 7, tag: 'agent', count: 2, roomUuid: 'u-1' });
  assert.strictEqual(evt.getHeader('Action'), 'tag');
  assert.strictEqual(evt.getHeader('Member-ID'), '7');
  assert.strictEqual(evt.getHeader('Tag'), 'agent');
});

test('room.* events reshape into a conference::maintenance CUSTOM event', async () => {
  const { ep } = makeEp();
  const seen = [];
  // exactly what conference.js / task.js register
  ep.conn.on('esl::event::CUSTOM::*', (evt) => seen.push(evt));

  ep._onEvent('room.memberDel', { memberId: 3, count: 2, roomUuid: 'u-1', kind: 'normal' });

  assert.strictEqual(seen.length, 1, 'one CUSTOM event emitted on ep.conn');
  const evt = seen[0];
  assert.strictEqual(evt.getHeader('Event-Subclass'), 'conference::maintenance');
  assert.strictEqual(evt.getHeader('Action'), 'del-member');
  assert.strictEqual(evt.getHeader('Member-ID'), '3');
  assert.strictEqual(evt.getHeader('Conference-Size'), '2');
  assert.strictEqual(evt.getHeader('Conference-Unique-ID'), 'u-1');
  assert.strictEqual(evt.getHeader('Member-Type'), 'normal');
  assert.ok(/^\d+$/.test(evt.getHeader('Event-Date-Timestamp')), 'timestamp is microseconds');
});

test('room talk events map to start-talking / stop-talking actions', async () => {
  const { ep } = makeEp();
  const actions = [];
  ep.conn.on('esl::event::CUSTOM::*', (evt) => actions.push(evt.getHeader('Action')));
  ep._onEvent('room.startTalking', { memberId: 1, count: 2, roomUuid: 'u' });
  ep._onEvent('room.stopTalking', { memberId: 1, count: 2, roomUuid: 'u' });
  ep._onEvent('room.memberAdd', { memberId: 1, count: 2, roomUuid: 'u' });
  assert.deepStrictEqual(actions, ['start-talking', 'stop-talking', 'add-member']);
});

test('each endpoint has its OWN conn (no cross-room event bleed)', async () => {
  const { ep: epA } = makeEp();
  const { ep: epB } = makeEp();
  assert.notStrictEqual(epA.conn, epB.conn, 'distinct per-endpoint conns');
  let aFired = 0;
  let bFired = 0;
  epA.conn.on('esl::event::CUSTOM::*', () => aFired++);
  epB.conn.on('esl::event::CUSTOM::*', () => bFired++);
  epA._onEvent('room.memberDel', { memberId: 1, count: 0, roomUuid: 'ua' });
  assert.strictEqual(aFired, 1);
  assert.strictEqual(bFired, 0, 'endpoint B must not see endpoint A room events');
});

test('forkAdopt/Release into conference translate to room.fork.adopt/release', async () => {
  const { ep, calls } = makeEp((cmd) =>
    cmd === 'room.fork.adopt' ? { botMemberId: 7, botId: 'conf_bot:c:7' } : {});
  const res = await ep.forkAdoptIntoConference('conf:acct:room', 'audio_fork');
  await ep.forkReleaseFromConference('audio_fork');
  assert.deepStrictEqual(calls.map((c) => [c.cmd, c.data]), [
    ['room.fork.adopt', { room: 'conf:acct:room', bugname: 'audio_fork' }],
    ['room.fork.release', { bugname: 'audio_fork' }]
  ]);
  assert.deepStrictEqual(res, { botMemberId: 7, botId: 'conf_bot:c:7' });
});

test('MediaServer.api conference list count returns a raw string body', async () => {
  let found = true;
  const mockConn = {
    on() {},
    request: async (cmd, ep, data) => {
      assert.strictEqual(cmd, 'room.query');
      assert.deepStrictEqual(data, { room: 'myconf' });
      return found ? { found: true, count: 4 } : { found: false };
    }
  };
  const ms = new MediaServer(mockConn, null, { address: '127.0.0.1', port: 9000 });

  assert.strictEqual(await ms.api('conference myconf list count'), '4');
  found = false;
  const miss = await ms.api('conference myconf list count');
  assert.ok(/Conference myconf not found/.test(miss), `confNoMatch should match: ${miss}`);
});
