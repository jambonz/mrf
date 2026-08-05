// Unit tests for the dialogflow (ES/CX/CES) surface of the mrf adapter:
//   - lib/utils.tokenizeQuoted, the pure arg-tokenizer
//   - Endpoint.api('dialogflow[_cx|_ces]_start|stop|writesdone', argString) ->
//     this._request('dialogflow.start|stop|writesDone', data)
//   - mediajam 'dialogflow.<variant>.<suffix>' wire events surfaced via
//     EVENT_NAME_ALIASES to ep.addCustomEventListener('dialogflow[_cx|_ces]::...')
// Transport (this._request / ep._onEvent) is mocked/driven directly, mirroring
// test/conference.test.js's makeEp() harness.

const { test } = require('node:test');
const assert = require('node:assert');
const Endpoint = require('../lib/endpoint');
const { tokenizeQuoted } = require('../lib/utils');

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

// ---------------------------------------------------------------------------
// A) tokenizeQuoted — pure helper, equivalence classes
// ---------------------------------------------------------------------------

test('tokenizeQuoted: space-splits, keeps quoted spans whole (quotes stripped), ' +
     'collapses runs of spaces, handles unterminated quotes and empties', () => {
  const cases = [
    // [input, expected tokens]
    ['uuid proj en-US', ['uuid', 'proj', 'en-US']],
    ['uuid proj en-US welcome \'{"a":"b c"}\'', ['uuid', 'proj', 'en-US', 'welcome', '{"a":"b c"}']],
    ['  uuid   proj   en-US  ', ['uuid', 'proj', 'en-US']], // leading/trailing/multi spaces -> no empty tokens
    ['a \'b c', ['a', 'b c']], // unterminated quote takes the rest of the string
    ['single', ['single']],
    ['', []],
    [undefined, []],
  ];
  for (const [input, expected] of cases) {
    assert.deepStrictEqual(tokenizeQuoted(input), expected, `input: ${JSON.stringify(input)}`);
  }
});

// ---------------------------------------------------------------------------
// B) api() command translation
// ---------------------------------------------------------------------------

test('dialogflow_start (ES): drops leading uuid, sets variant/project/language, omits event/text', async () => {
  const { ep, calls } = makeEp();
  const res = await ep.api('dialogflow_start', 'uuid proj-x en-US');
  const req = calls.find((c) => c.cmd === 'dialogflow.start');
  assert.ok(req, 'a dialogflow.start request was sent');
  assert.strictEqual(req.data.variant, 'es');
  assert.strictEqual(req.data.project, 'proj-x');
  assert.strictEqual(req.data.language, 'en-US');
  assert.ok(!('event' in req.data), 'no event key when not supplied');
  assert.ok(!('text' in req.data), 'no text key when not supplied');
  assert.deepStrictEqual(res, { body: '+OK' });
});

test('dialogflow_start (ES): quoted json text rides through as event+text', async () => {
  const { ep, calls } = makeEp();
  await ep.api('dialogflow_start', 'uuid proj-x en-US welcome \'{"foo":"bar"}\'');
  const req = calls.find((c) => c.cmd === 'dialogflow.start');
  assert.strictEqual(req.data.variant, 'es');
  assert.strictEqual(req.data.project, 'proj-x');
  assert.strictEqual(req.data.language, 'en-US');
  assert.strictEqual(req.data.event, 'welcome');
  assert.strictEqual(req.data.text, '{"foo":"bar"}');
});

test('dialogflow_start (ES): literal "none" event token omits the event key but keeps quoted text', async () => {
  const { ep, calls } = makeEp();
  await ep.api('dialogflow_start', "uuid proj-x en-US none 'hello world'");
  const req = calls.find((c) => c.cmd === 'dialogflow.start');
  assert.strictEqual(req.data.text, 'hello world');
  assert.ok(!('event' in req.data), 'event "none" is omitted, not passed through literally');
});

test('dialogflow_cx_start: full field set including environment/event/text/singleUtterance=true', async () => {
  const { ep, calls } = makeEp();
  await ep.api('dialogflow_cx_start', "uuid proj loc-1 agentA envP en-US evt1 'some text' 1");
  const req = calls.find((c) => c.cmd === 'dialogflow.start');
  assert.strictEqual(req.data.variant, 'cx');
  assert.strictEqual(req.data.project, 'proj');
  assert.strictEqual(req.data.location, 'loc-1');
  assert.strictEqual(req.data.agent, 'agentA');
  assert.strictEqual(req.data.environment, 'envP');
  assert.strictEqual(req.data.language, 'en-US');
  assert.strictEqual(req.data.event, 'evt1');
  assert.strictEqual(req.data.text, 'some text');
  assert.strictEqual(req.data.singleUtterance, true);
});

test('dialogflow_cx_start: "none" tokens omit environment/event/text; literal 0 -> singleUtterance false', async () => {
  const { ep, calls } = makeEp();
  await ep.api('dialogflow_cx_start', 'uuid proj loc-1 agentA none en-US none none 0');
  const req = calls.find((c) => c.cmd === 'dialogflow.start');
  assert.strictEqual(req.data.variant, 'cx');
  assert.strictEqual(req.data.project, 'proj');
  assert.strictEqual(req.data.location, 'loc-1');
  assert.strictEqual(req.data.agent, 'agentA');
  assert.strictEqual(req.data.language, 'en-US');
  assert.strictEqual(req.data.singleUtterance, false);
  assert.ok(!('environment' in req.data), 'environment "none" omitted');
  assert.ok(!('event' in req.data), 'event "none" omitted');
  assert.ok(!('text' in req.data), 'text "none" omitted');
});

test('dialogflow_ces_start: agent/deployment/singleUtterance=true, no event/text', async () => {
  const { ep, calls } = makeEp();
  await ep.api('dialogflow_ces_start', 'uuid proj loc-1 appX depl1 en-US none none 1');
  const req = calls.find((c) => c.cmd === 'dialogflow.start');
  assert.strictEqual(req.data.variant, 'ces');
  assert.strictEqual(req.data.project, 'proj');
  assert.strictEqual(req.data.location, 'loc-1');
  assert.strictEqual(req.data.agent, 'appX');
  assert.strictEqual(req.data.deployment, 'depl1');
  assert.strictEqual(req.data.language, 'en-US');
  assert.strictEqual(req.data.singleUtterance, true);
  assert.ok(!('event' in req.data));
  assert.ok(!('text' in req.data));
});

test('dialogflow_ces_start: deployment "none" drops the key; singleUtterance defaults true', async () => {
  const { ep, calls } = makeEp();
  await ep.api('dialogflow_ces_start', 'uuid proj loc-1 appX none en-US');
  const req = calls.find((c) => c.cmd === 'dialogflow.start');
  assert.strictEqual(req.data.variant, 'ces');
  assert.strictEqual(req.data.agent, 'appX');
  assert.strictEqual(req.data.language, 'en-US');
  assert.strictEqual(req.data.singleUtterance, true);
  assert.ok(!('deployment' in req.data), 'deployment "none" omitted');
});

test('GOOGLE_APPLICATION_CREDENTIALS set via ep.set() is forwarded under data.options on start', async () => {
  const { ep, calls } = makeEp();
  await ep.set('GOOGLE_APPLICATION_CREDENTIALS', '{"type":"service_account"}');
  await ep.api('dialogflow_start', 'uuid p en-US');
  const req = calls.find((c) => c.cmd === 'dialogflow.start');
  assert.strictEqual(req.data.options.GOOGLE_APPLICATION_CREDENTIALS, '{"type":"service_account"}');
});

test('dialogflow_stop / dialogflow_cx_stop / dialogflow_ces_stop all map to dialogflow.stop', async () => {
  const { ep, calls } = makeEp();
  await ep.api('dialogflow_stop', 'uuid');
  await ep.api('dialogflow_cx_stop', 'uuid');
  await ep.api('dialogflow_ces_stop', 'uuid');
  const stops = calls.filter((c) => c.cmd === 'dialogflow.stop');
  assert.strictEqual(stops.length, 3);
});

test('dialogflow_cx_writesdone / dialogflow_ces_writesdone map to dialogflow.writesDone', async () => {
  const { ep, calls } = makeEp();
  await ep.api('dialogflow_cx_writesdone', 'uuid');
  await ep.api('dialogflow_ces_writesdone', 'uuid');
  const wd = calls.filter((c) => c.cmd === 'dialogflow.writesDone');
  assert.strictEqual(wd.length, 2);
});

test('start/stop/writesDone resolve with the fsmrf +OK success shape', async () => {
  const { ep } = makeEp();
  assert.deepStrictEqual(await ep.api('dialogflow_start', 'uuid p en-US'), { body: '+OK' });
  assert.deepStrictEqual(await ep.api('dialogflow_stop', 'uuid'), { body: '+OK' });
  assert.deepStrictEqual(await ep.api('dialogflow_cx_writesdone', 'uuid'), { body: '+OK' });
});

test('an unknown api command still throws "not supported" (regression guard)', async () => {
  const { ep } = makeEp();
  await assert.rejects(() => ep.api('bogus_command', 'x'), /not supported/);
});

// ---------------------------------------------------------------------------
// C) Event aliasing: mediajam dialogflow.<variant>.<suffix> -> legacy FS
//    custom-event names via ep.addCustomEventListener, parsed JSON payload
// ---------------------------------------------------------------------------

test('dialogflow.es.audio_provided aliases to dialogflow::audio_provided with the parsed JSON payload', () => {
  const { ep } = makeEp();
  let received;
  ep.addCustomEventListener('dialogflow::audio_provided', (payload) => { received = payload; });
  ep._onEvent('dialogflow.es.audio_provided',
    { vendor: 'dialogflow', variant: 'es', json: '{"path":"/tmp/x_1.wav"}' });
  assert.strictEqual(received.path, '/tmp/x_1.wav');
});

test('dialogflow.cx.intent aliases to dialogflow_cx::intent with the parsed JSON payload', () => {
  const { ep } = makeEp();
  let received;
  ep.addCustomEventListener('dialogflow_cx::intent', (payload) => { received = payload; });
  ep._onEvent('dialogflow.cx.intent', { vendor: 'dialogflow', variant: 'cx', json: '{"intentName":"welcome"}' });
  assert.strictEqual(received.intentName, 'welcome');
});

test('dialogflow.ces.session_output aliases to dialogflow_ces::session_output with the parsed JSON payload', () => {
  const { ep } = makeEp();
  let received;
  ep.addCustomEventListener('dialogflow_ces::session_output', (payload) => { received = payload; });
  ep._onEvent('dialogflow.ces.session_output',
    { vendor: 'dialogflow', variant: 'ces', json: '{"text":"hi","turn_completed":true}' });
  assert.strictEqual(received.text, 'hi');
  assert.strictEqual(received.turn_completed, true);
});

// ---------------------------------------------------------------------------
// D) Tool-call round trip: dialogflow_cx_tool_result command + cx tool_calls alias
// ---------------------------------------------------------------------------

test('dialogflow_cx_tool_result: positional args + quoted JSON -> dialogflow.start with toolResult', async () => {
  const { ep, calls } = makeEp();
  const json = '{"tool":"projects/p/locations/l/agents/a/tools/t1","action":"getGeolocation",' +
    '"outputParameters":{"city":"New York"}}';
  const res = await ep.api('dialogflow_cx_tool_result', `uuid proj loc-1 agentA none en-US '${json}'`);
  const req = calls.find((c) => c.cmd === 'dialogflow.start');
  assert.ok(req, 'a dialogflow.start request was sent');
  assert.strictEqual(req.data.variant, 'cx');
  assert.strictEqual(req.data.project, 'proj');
  assert.strictEqual(req.data.location, 'loc-1');
  assert.strictEqual(req.data.agent, 'agentA');
  assert.strictEqual(req.data.language, 'en-US');
  assert.ok(!('environment' in req.data), 'environment "none" omitted');
  assert.strictEqual(req.data.toolResult.action, 'getGeolocation');
  assert.strictEqual(req.data.toolResult.outputParameters.city, 'New York');
  assert.deepStrictEqual(res, { body: '+OK' });
});

test('dialogflow_cx_tool_result: invalid JSON -> -ERR, no request sent', async () => {
  const { ep, calls } = makeEp();
  const res = await ep.api('dialogflow_cx_tool_result', "uuid proj loc-1 agentA none en-US 'not-json'");
  assert.ok(res.body.startsWith('-ERR'), `got ${res.body}`);
  assert.strictEqual(calls.filter((c) => c.cmd === 'dialogflow.start').length, 0);
});

// ---------------------------------------------------------------------------
// D2) CES tool-call round trip: dialogflow_ces_tool_result must send the result
// MID-STREAM (dialogflow.toolResult), never restart the session via
// dialogflow.start — a restart would abandon the turn awaiting the result.
// ---------------------------------------------------------------------------

const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');

test('dialogflow_ces_tool_result: base64 payload -> dialogflow.toolResult, mid-stream', async () => {
  const { ep, calls } = makeEp();
  const responses = [
    { id: 'call-1', tool: 'projects/p/locations/l/apps/a/tools/t1', output: { city: 'New York' } }
  ];
  const res = await ep.api('dialogflow_ces_tool_result', `uuid ${b64(responses)}`);

  const req = calls.find((c) => c.cmd === 'dialogflow.toolResult');
  assert.ok(req, 'a dialogflow.toolResult request was sent');
  assert.strictEqual(calls.filter((c) => c.cmd === 'dialogflow.start').length, 0,
    'CES must NOT restart the stream to deliver a tool result');
  assert.strictEqual(req.data.toolResponses.length, 1);
  assert.strictEqual(req.data.toolResponses[0].id, 'call-1');
  assert.strictEqual(req.data.toolResponses[0].output.city, 'New York');
  assert.deepStrictEqual(res, { body: '+OK' });
});

test('dialogflow_ces_tool_result: answers every call in one send', async () => {
  const { ep, calls } = makeEp();
  const responses = [
    { id: 'call-1', tool: 't1', output: { ok: 1 } },
    { id: 'call-2', tool: 't2', error: 'backend unreachable' }
  ];
  await ep.api('dialogflow_ces_tool_result', `uuid ${b64(responses)}`);

  const req = calls.find((c) => c.cmd === 'dialogflow.toolResult');
  assert.strictEqual(req.data.toolResponses.length, 2, 'both calls answered');
  assert.strictEqual(req.data.toolResponses[1].error, 'backend unreachable');
});

test('dialogflow_ces_tool_result: apostrophes in output survive the arg string', async () => {
  const { ep, calls } = makeEp();
  // A bare "'" would terminate a quoted arg span early; base64 keeps it intact.
  const responses = [{ id: 'call-1', tool: 't1', error: "Can't reach the CRM" }];
  await ep.api('dialogflow_ces_tool_result', `uuid ${b64(responses)}`);

  const req = calls.find((c) => c.cmd === 'dialogflow.toolResult');
  assert.strictEqual(req.data.toolResponses[0].error, "Can't reach the CRM");
});

test('dialogflow_ces_tool_result: invalid payload -> -ERR, no request sent', async () => {
  const { ep, calls } = makeEp();
  const res = await ep.api('dialogflow_ces_tool_result', 'uuid bm90LWpzb24=');
  assert.ok(res.body.startsWith('-ERR'), `got ${res.body}`);
  assert.strictEqual(calls.filter((c) => c.cmd === 'dialogflow.toolResult').length, 0);
  assert.strictEqual(calls.filter((c) => c.cmd === 'dialogflow.start').length, 0);
});

test('dialogflow.ces.tool_calls aliases to dialogflow_ces::tool_calls with the parsed JSON payload', () => {
  const { ep } = makeEp();
  let received;
  ep.addCustomEventListener('dialogflow_ces::tool_calls', (payload) => { received = payload; });
  ep._onEvent('dialogflow.ces.tool_calls',
    { vendor: 'dialogflow', variant: 'ces',
      json: '{"tool_calls":[{"id":"call-1","display_name":"getGeolocation","tool":"t1","args":{}}]}' });
  assert.strictEqual(received.tool_calls[0].id, 'call-1');
  assert.strictEqual(received.tool_calls[0].display_name, 'getGeolocation');
});

test('dialogflow.cx.tool_calls aliases to dialogflow_cx::tool_calls with the parsed JSON payload', () => {
  const { ep } = makeEp();
  let received;
  ep.addCustomEventListener('dialogflow_cx::tool_calls', (payload) => { received = payload; });
  ep._onEvent('dialogflow.cx.tool_calls',
    { vendor: 'dialogflow', variant: 'cx',
      json: '{"tool_calls":[{"tool":"t1","action":"getGeolocation","input_parameters":{}}]}' });
  assert.strictEqual(received.tool_calls[0].action, 'getGeolocation');
});
