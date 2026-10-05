// Real compiled executor; OS/model boundaries are recorded, no desktop input.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const dist = path.resolve(__dirname, '../dist-electron');
const policy = require(path.join(dist, 'input-policy.js'));
const runnerFile = path.join(dist, 'runner.js');
const realRunner = require(runnerFile);
const win = { hwnd: '100', pid: 10, title: 'Renamer', rect: { x: 0, y: 0, w: 1000, h: 700 } };
const node = (kind, extra = {}) => ({ id: kind, kind, title: kind, ...extra });
const writing = extra => node('type', { text: 'hello', clearFirst: true, ...extra });
const missed = { cleared: false, pasted: false, skippedClear: true, writeSent: false, focusType: 'Pane', code: 'INPUT_FOCUS_UNRESOLVED', diagnostics: { type: 'Pane', native: 'TkChild', window: 'Renamer' } };
const action = (kind, extra = {}) => ({ kind, thought: 'field', raw: kind + '()', ...extra });
function stub(name, exports) { const f = path.join(dist, name + '.js'); require.cache[f] = { id: f, filename: f, loaded: true, exports }; }
function fixture(settings = {}) {
  let stopping = false;
  const calls = [], logs = [], queries = [], queue = [];
  let current = structuredClone(win);
  const scan = { area: { ...win.rect }, items: [{ id: 1, text: 'Kaynak klasör', type: 'Text', src: 'ocr', x: 200, y: 500, w: 200, h: 30 }], image: { data: 'mock', w: 1000, h: 700 }, sig: Buffer.alloc(576).toString('base64'), window: 'Renamer', uiaCount: 0, ocrCount: 1 };
  const bridge = {
    isLocked: async () => false, scan: async () => scan, discardShot: () => {},
    inputTarget: async opts => { calls.push(['target', structuredClone(opts)]); return structuredClone(current); },
    assertInputTarget: async (...args) => calls.push(['assert', ...args]),
    inputState: async () => ({ type: 'Pane', writable: false, window: 'Renamer' }),
    foreground: async () => ({ title: 'Renamer', pid: 10, hwnd: '100' }),
    clickAt: async (...args) => calls.push(['click', ...args]),
    typeText: async (...args) => { calls.push(['write', ...args]); return queue.length ? queue.shift() : { value: 'hello', writeSent: true, focusHwnd: '110' }; },
    focusedValue: async () => null,
    sendKeys: async (...args) => calls.push(['keys', ...args]),
    hotkey: async (...args) => calls.push(['hotkey', ...args]),
    patchAt: async () => null,
    crop: async (rect, ...opts) => { calls.push(['crop', rect, ...opts]); return { area: rect, image: scan.image }; },
  };
  const models = { isTarsModel: () => false, guiStep: async q => { queries.push(structuredClone(q)); return action('click', { x: 0.65, y: 0.72 }); }, chooseTypeField: async () => ({ id: 99, reason: 'no such field' }) };
  stub('a11y-bridge', bridge); stub('browser', { userChromeItems: async () => null });
  stub('shots', { rememberShot: () => {} }); stub('openrouter', models);
  require.cache[runnerFile] = { ...require.cache[runnerFile], exports: { ...realRunner, interruptibleSleep: async (ms, stopped) => { if (stopped()) throw new realRunner.StoppedError(); } } };
  const oldLoad = Module._load;
  Module._load = function (id, parent, main) {
    if (id === 'electron') return { screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1000, height: 700 }, scaleFactor: 1 }) } };
    return oldLoad.call(this, id, parent, main);
  };
  const f = path.join(dist, 'agent.js'); delete require.cache[f];
  let instance;
  try { instance = require(f).createAgent({ log: (level, message) => logs.push({ level, message }), send: () => {}, shouldStop: () => stopping, settings: () => ({ apiKey: 'test', model: 'test', agentModel: 'gui', findOrder: ['windows'], hideWhileRunning: true, ...settings }) }); }
  finally { Module._load = oldLoad; }
  return { ex: instance.executor, beginRun: instance.beginRun, bridge, models, calls, logs, queries, queue, scan, stop: () => stopping = true, move: value => current = value };
}
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
test.after(() => Object.defineProperty(process, 'platform', originalPlatform));
async function clickField(f) { await f.ex.click(node('click', { prompt: '“Kaynak klasör”' }), 1, { next: writing() }); }
const callsOf = (f, op) => f.calls.filter(c => c[0] === op);

test('normal targeted writing stays on the fast path, binds HWND/PID and guards final Enter', async () => {
  const f = fixture(); await clickField(f); await f.ex.type(writing({ pressEnter: true }), 2);
  const write = callsOf(f, 'write')[0];
  assert.equal(write[2], false); assert.equal(write[6].window.hwnd, '100'); assert.equal(write[6].window.pid, 10);
  assert.equal(f.queries.length, 0); assert.equal(callsOf(f, 'crop').length, 0);
  assert(callsOf(f, 'target').some(c => c[1].target?.hwnd === '100'));
  const key = callsOf(f, 'keys')[0]; assert.equal(key[1], '{ENTER}'); assert.equal(key[3].hwnd, '100'); assert.equal(key[4], '110');
});
test('inactive target activation failure sends neither click nor write', async () => {
  const f = fixture(); f.bridge.inputTarget = async () => { throw new Error('INPUT_WINDOW_NOT_ACTIVE'); };
  await assert.rejects(clickField(f), /INPUT_WINDOW_NOT_ACTIVE/);
  assert.equal(callsOf(f, 'click').length + callsOf(f, 'write').length, 0);
});
test('recovery crops only the target window, locates a field then delegates writing and Enter', async () => {
  const f = fixture(); await clickField(f); f.queue.push(missed, { value: 'hello', via: 'visual-caret', writeSent: true, focusHwnd: '110' });
  await f.ex.type(writing({ pressEnter: true }), 2);
  assert.equal(f.queries.length, 1); assert.match(f.queries[0].goal, /ONLY restore keyboard focus/); assert.match(f.queries[0].goal, /Kaynak klasör/);
  assert.deepEqual(callsOf(f, 'crop')[0][1], win.rect);
  const writes = callsOf(f, 'write'); assert.deepEqual(writes[1][4], { x: 650, y: 504 }); assert.equal(writes[1][6].visual, true);
  assert.equal(callsOf(f, 'keys').length, 1);
});
test('bounded recovery never sends a third focus click', async () => {
  const f = fixture(); await clickField(f); f.queue.push(missed, missed, missed);
  let turn = 0; f.models.guiStep = async q => { f.queries.push(q); return action('click', { x: 0.6 + ++turn / 10, y: 0.72 }); };
  await assert.rejects(f.ex.type(writing({ pressEnter: true }), 2), /alan kurtarılamadı/);
  assert.equal(f.queries.length, 2); assert.equal(callsOf(f, 'click').length, 3); assert.equal(callsOf(f, 'keys').length, 0);
});
test('same failed recovery point is not clicked twice', async () => {
  const f = fixture(); await clickField(f); f.queue.push(missed, missed);
  await assert.rejects(f.ex.type(writing(), 2), /alan kurtarılamadı/);
  assert.equal(f.queries.length, 2); assert.equal(callsOf(f, 'click').length, 2);
});
for (const kind of ['type', 'hotkey', 'double', 'right', 'drag', 'call_user']) {
  test('focus recovery rejects model action ' + kind, async () => {
    const f = fixture(); await clickField(f); f.queue.push(missed); f.models.guiStep = async () => action(kind, { x: 0.6, y: 0.7, text: 'BAD', keys: ['enter'] });
    await assert.rejects(f.ex.type(writing({ pressEnter: true }), 2), /alan kurtarılamadı/);
    assert.equal(callsOf(f, 'write').length, 1); assert.equal(callsOf(f, 'click').length, 1); assert.equal(callsOf(f, 'keys').length, 0);
  });
}
test('model finished claim does not bypass real focus verification', async () => {
  const f = fixture(); await clickField(f); f.queue.push(missed, missed, missed); f.models.guiStep = async () => action('finished');
  await assert.rejects(f.ex.type(writing({ pressEnter: true }), 2), /alan kurtarılamadı/);
  assert.equal(callsOf(f, 'click').length, 1); assert.equal(callsOf(f, 'keys').length, 0);
});
test('late recovery answer after user stop cannot click or type', async () => {
  const f = fixture(); await clickField(f); f.queue.push(missed); f.models.guiStep = async () => { f.stop(); return action('click', { x: .6, y: .7 }); };
  await assert.rejects(f.ex.type(writing(), 2), realRunner.StoppedError);
  assert.equal(callsOf(f, 'click').length, 1); assert.equal(callsOf(f, 'write').length, 1);
});
test('layout/focus loss after model call prevents its click', async () => {
  const f = fixture(); await clickField(f); f.queue.push(missed); f.bridge.assertInputTarget = async () => { throw new Error('INPUT_LAYOUT_CHANGED'); };
  await assert.rejects(f.ex.type(writing(), 2), /INPUT_LAYOUT_CHANGED/); assert.equal(callsOf(f, 'click').length, 1);
});
test('unknown custom readback never submits Enter', async () => {
  const f = fixture(); await clickField(f); f.queue.push(missed, { via: 'visual-caret', value: null, writeSent: true });
  await assert.rejects(f.ex.type(writing({ pressEnter: true }), 2), /INPUT_READBACK_UNAVAILABLE/);
  assert.equal(callsOf(f, 'keys').length, 0);
});
test('no model recovery is permitted after destructive input has already been sent', async () => {
  const f = fixture(); await clickField(f); f.queue.push({ value: 'wrong', writeSent: true }, missed);
  await assert.rejects(f.ex.type(writing(), 2), /alan kurtarılamadı/); assert.equal(f.queries.length, 0);
});
test('window translation rebases the old field point; exact target survives another active app', async () => {
  const f = fixture(); await clickField(f); f.move({ ...win, rect: { ...win.rect, x: -500, y: 100 } });
  await f.ex.type(writing(), 2);
  assert.deepEqual(callsOf(f, 'write')[0][4], { x: -200, y: 615 });
  assert.equal(callsOf(f, 'target').at(-1)[1].target.hwnd, '100');
});
for (const change of ['resize', 'owned dialog']) {
  test(change + ' discards stale field coordinates before any write', async () => {
    const f = fixture(); await clickField(f);
    f.move({ ...win, hwnd: change === 'owned dialog' ? '101' : '100', rect: { ...win.rect, w: 1200 } });
    await f.ex.type(writing(), 2);
    assert.equal(f.queries.length, 1); assert.equal(callsOf(f, 'write').length, 1);
    assert.notDeepEqual(callsOf(f, 'write')[0][4], { x: 300, y: 515 });
  });
}
test('no API key never grants a Pane typing permission', async () => {
  const f = fixture({ apiKey: '' }); await clickField(f); f.queue.push(missed);
  await assert.rejects(f.ex.type(writing(), 2), /alan kurtarılamadı/); assert.equal(f.queries.length, 0);
});
test('Enter focus loss is fatal, no key sent', async () => {
  const f = fixture(); await clickField(f); f.bridge.assertInputTarget = async () => { throw new Error('INPUT_FOCUS_CHANGED'); };
  await assert.rejects(f.ex.type(writing({ pressEnter: true }), 2), /INPUT_FOCUS_CHANGED/); assert.equal(callsOf(f, 'keys').length, 0);
});
test('initiative repeated click gets physical/normalized feedback and avoids a blind duplicate', async () => {
  const f = fixture(); let i = 0;
  f.models.guiStep = async q => { f.queries.push(structuredClone(q)); return ++i <= 2 ? action('click', { x: .3, y: .5 }) : action('click', { x: .7, y: .5 }); };
  await f.ex.initiative(node('ai', { prompt: 'Select profile', engine: 'screen', maxActions: 2 }), 1);
  assert.equal(callsOf(f, 'click').length, 2); assert.equal(f.queries.length, 3);
  assert.match(f.queries[1].history.at(-1).note, /@300,350/); assert.match(f.queries[1].history.at(-1).note, /başarısızlık kanıtı değildir/);
  assert.equal(callsOf(f, 'click')[1][1], 700);
});
test('initiative can intentionally double click after selection; there is no automatic double click', async () => {
  const f = fixture(); let i = 0; f.models.guiStep = async () => ++i === 1 ? action('click', { x: .3, y: .5 }) : action('double', { x: .3, y: .5 });
  await f.ex.initiative(node('ai', { prompt: 'Open profile', engine: 'screen', maxActions: 2 }), 1);
  assert.deepEqual(callsOf(f, 'click').map(c => c[3]), ['left', 'double']);
});
test('unchanged screen with a focused editable field is valid input focus, not a failed click', async () => {
  const f = fixture(); f.bridge.inputState = async () => ({ type: 'Edit', writable: true, rect: win.rect, window: 'Renamer' });
  f.models.guiStep = async q => { f.queries.push(structuredClone(q)); return action('click', { x: .3, y: .5 }); };
  await f.ex.initiative(node('ai', { prompt: 'Focus input', engine: 'screen', maxActions: 2 }), 1);
  assert.equal(f.queries.length, 2); assert.equal(callsOf(f, 'click').length, 2);
  assert.equal(f.queries[1].history.at(-1).note, undefined);
});
test('initiative text uses common guarded writer and readback, not direct unsafe typing', async () => {
  const f = fixture(); let i = 0; f.models.guiStep = async () => ++i === 1 ? action('click', { x: .3, y: .5 }) : action('type', { text: 'hello\n' });
  await f.ex.initiative(node('ai', { prompt: 'Fill field', engine: 'screen', maxActions: 2 }), 1);
  assert.equal(callsOf(f, 'write')[0][2], false); assert.equal(callsOf(f, 'write')[0][6].window.hwnd, '100');
  assert.equal(callsOf(f, 'keys').filter(c => c[1] === '{ENTER}').length, 1);
});
test('initiative Ctrl+A replacement retains input identity', async () => {
  const f = fixture(); const actions = [action('click', { x: .3, y: .5 }), action('hotkey', { keys: ['ctrl', 'a'] }), action('type', { text: 'hello' })];
  f.models.guiStep = async () => actions.shift();
  await f.ex.initiative(node('ai', { prompt: 'Replace field', engine: 'screen', maxActions: 3 }), 1);
  assert.equal(callsOf(f, 'write')[0][3], true); assert.equal(callsOf(f, 'write')[0][6].window.hwnd, '100');
});
test('coordinate policy rejects resized/invalid points, preserves negative monitor origin', () => {
  assert.equal(policy.inside(win.rect, { x: NaN, y: 0 }), false);
  assert.equal(policy.movedPoint(win.rect, { ...win.rect, w: 999 }, { x: 10, y: 10 }), undefined);
  const area = { x: -1000, y: 20, w: 1000, h: 700 };
  assert.equal(policy.repeatedClick(action('click', { x: .3, y: .5 }), area, { x: -700, y: 370, kind: 'click' }), true);
  assert.equal(policy.repeatedClick(action('double', { x: .3, y: .5 }), area, { x: -700, y: 370, kind: 'click' }), false);
});
