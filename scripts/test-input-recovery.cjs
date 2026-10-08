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
  let cursor = {x:0,y:0};
  const scan = { area: { ...win.rect }, items: [{ id: 1, text: 'Kaynak klasör', type: 'Text', src: 'ocr', x: 200, y: 500, w: 200, h: 30 }], image: { data: 'mock', w: 1000, h: 700 }, sig: Buffer.alloc(576).toString('base64'), window: 'Renamer', uiaCount: 0, ocrCount: 1 };
  const bridge = {
    isLocked: async () => false, scan: async () => scan, discardShot: () => {},
    inputTarget: async opts => { calls.push(['target', structuredClone(opts)]); return structuredClone(current); },
    assertInputTarget: async (...args) => calls.push(['assert', ...args]),
    inputState: async () => ({ type: 'Pane', writable: false, window: 'Renamer' }),
    foreground: async () => ({ title: 'Renamer', pid: 10, hwnd: '100' }),
    clickAt: async (...args) => calls.push(['click', ...args]),
    moveMouse: async (x,y) => {cursor={x,y};calls.push(['move',x,y]);return {hwnd:100};},
    cursorPos: async () => cursor,
    clickCurrentAt: async (x,y,hwnd) => {calls.push(['click',x,y,'left']);calls.push(['currentClick',x,y,hwnd]);},
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



test('explicit clicked typing uses one dispatch, no input binding/readback, one final Enter',async()=>{
 const f=fixture({screenCheck:'off'});f.bridge.inputTarget=async()=>{throw new Error('Unexpected UIA input binding');};
 await clickField(f);f.bridge.focusedValue=async()=>{throw new Error('Unexpected field readback');};
 f.queue.push({writeSent:true,value:null,via:'keyboard'});
 await f.ex.type(writing({pressEnter:true}),2);
 const w=callsOf(f,'write');assert.equal(w.length,1);assert.equal(w[0][3],true);assert.equal(w[0][6],undefined);
 assert.equal(callsOf(f,'keys').length,1);assert.equal(f.queries.length,0);
 assert(!f.logs.some(l=>/Alan doğrulandı|yine de yazıldı/.test(l.message)));
});
test('explicit append preserves clear=false, even with unreadable custom focus',async()=>{
 const f=fixture({screenCheck:'off'});await clickField(f);f.queue.push({writeSent:true,value:null});
 await f.ex.type(writing({clearFirst:false}),2);assert.equal(callsOf(f,'write')[0][3],false);
 assert.equal(callsOf(f,'write').length,1);assert.equal(f.queries.length,0);
});
test('typing without a prior click sends requested input, without guessing/selecting another field',async()=>{
 const f=fixture({screenCheck:'off'});f.bridge.inputTarget=async()=>{throw new Error('Unexpected UIA');};
 await f.ex.type(writing(),1);assert.equal(callsOf(f,'write').length,1);assert.equal(callsOf(f,'write')[0][6],undefined);
});
for (const failure of [missed,{writeSent:false},{needChoice:true,choices:[{id:1}]}]) {
 test('a real unsent worker result cannot submit Enter '+JSON.stringify(failure),async()=>{
  const f=fixture({screenCheck:'off'});f.queue.push(failure);
  await assert.rejects(f.ex.type(writing({pressEnter:true}),1),/INPUT_NOT_SENT/);
  assert.equal(callsOf(f,'write').length,1);assert.equal(callsOf(f,'keys').length,0);assert.equal(f.queries.length,0);
 });
}
test('dispatch exception is propagated without retyping or Enter',async()=>{
 const f=fixture({screenCheck:'off'});f.bridge.typeText=async()=>{throw new Error('KEY_SEND_FAILED');};
 await assert.rejects(f.ex.type(writing({pressEnter:true}),1),/KEY_SEND_FAILED/);assert.equal(callsOf(f,'keys').length,0);
});
test('late completion after Stop cannot submit Enter',async()=>{
 const f=fixture({screenCheck:'off'});f.bridge.typeText=async()=>{f.stop();return {writeSent:true,value:null};};
 await assert.rejects(f.ex.type(writing({pressEnter:true}),1),realRunner.StoppedError);assert.equal(callsOf(f,'keys').length,0);
});
for(const [kind,mode] of [['click','left'],['double','double'],['right','right']]) {
 test('position then model '+kind+' uses original coordinates/mode without HWND/UIA gate',async()=>{
  const f=fixture();f.bridge.inputTarget=async()=>{throw new Error('Unexpected input binding');};
  f.bridge.inputState=async()=>{throw new Error('Unexpected focus verdict');};f.bridge.cursorPos=async()=>{throw new Error('Unused pointer query');};
  const actions=[action('move',{x:.42,y:.58}),action(kind,{x:.43,y:.59}),action('finished')];f.models.guiStep=async()=>actions.shift();
  assert.equal(await f.ex.initiative(node('ai',{prompt:'Open target',engine:'screen',maxActions:4}),1),true);
  assert.equal(callsOf(f,'move').length,1);const clicks=callsOf(f,'click');assert.equal(clicks.length,1);
  assert.deepEqual(clicks[0].slice(1),[430,413,mode]);
 });
}
test('an unprepared double-click proposal moves only; next model turn sends its own double-click',async()=>{
 const f=fixture();const actions=[action('double',{x:.5,y:.5}),action('double',{x:.5,y:.5}),action('finished')];
 f.models.guiStep=async q=>{f.queries.push(structuredClone(q));return actions.shift();};
 assert.equal(await f.ex.initiative(node('ai',{prompt:'Open target',engine:'screen',maxActions:3}),1),true);
 assert.equal(callsOf(f,'move').length,1);assert.equal(callsOf(f,'click').length,1);assert.equal(callsOf(f,'click')[0][3],'double');
 assert.match(f.queries[1].history[0].note,/NOT sent/);assert.equal(f.queries[1].history[0].raw,'double()');
 assert.equal(f.queries[1].history[0].execution.status,'sent');assert.equal(f.queries[1].history[0].execution.action.kind,'move');
 assert.equal(f.queries[2].history[1].execution.action.kind,'double');
});
test('failed initiative dispatch is not reported as a successful history action',async()=>{
 const f=fixture();const actions=[action('move',{x:.5,y:.5}),action('click',{x:.5,y:.5}),action('call_user')];
 f.bridge.clickAt=async()=>{throw new Error('Native input failed');};
 f.models.guiStep=async q=>{f.queries.push(structuredClone(q));return actions.shift();};
 assert.equal(await f.ex.initiative(node('ai',{prompt:'Open target',engine:'screen',maxActions:3}),1),false);
 assert.equal(f.queries[2].history[1].execution.status,'unconfirmed');
 assert.match(f.queries[2].history[1].note,/Native input failed/);
});
test('repeated valid clicks and more than six unchanged actions are not vetoed',async()=>{
 const f=fixture({screenCheck:'off'});f.bridge.inputState=async()=>{throw new Error('Unexpected focus verdict');};
 const actions=[];for(let i=0;i<7;i++)actions.push(action('move',{x:.5,y:.5}),action('click',{x:.5,y:.5}));actions.push(action('finished'));
 f.models.guiStep=async()=>actions.shift();assert.equal(await f.ex.initiative(node('ai',{prompt:'Increment seven times',engine:'screen',maxActions:16}),1),true);
 assert.equal(callsOf(f,'click').length,7);
});
test('repeated waits consume only configured action budget, not hidden quiet-wait veto',async()=>{
 const f=fixture();f.models.guiStep=async q=>{f.queries.push(q);return action('wait');};
 assert.equal(await f.ex.initiative(node('ai',{prompt:'Wait for loading',engine:'screen',maxActions:8}),1),false);
 assert.equal(f.queries.length,8);assert(!f.logs.some(l=>/Bekleme ekranı açmadı|6 eylemdir/.test(l.message)));
});
test('model Ctrl+A and Delete are both sent, then typing appends into the cleared current field',async()=>{
 const f=fixture();const actions=[action('move',{x:.5,y:.5}),action('click',{x:.5,y:.5}),action('hotkey',{keys:['ctrl','a']}),action('hotkey',{keys:['delete']}),action('type',{text:'hello'}),action('finished')];
 f.models.guiStep=async()=>actions.shift();assert.equal(await f.ex.initiative(node('ai',{prompt:'Replace input',engine:'screen',maxActions:7}),1),true);
 assert.deepEqual(callsOf(f,'hotkey').map(c=>c[1]),[['ctrl','a'],['delete']]);assert.equal(callsOf(f,'write')[0][3],false);
 assert(!f.logs.some(l=>/engellendi/.test(l.message)));
});
test('equivalent control+a keeps replacement intent',async()=>{
 const f=fixture();const actions=[action('move',{x:.5,y:.5}),action('click',{x:.5,y:.5}),action('hotkey',{keys:['control','a']}),action('type',{text:'hello'}),action('finished')];
 f.models.guiStep=async()=>actions.shift();await f.ex.initiative(node('ai',{prompt:'Replace input',engine:'screen',maxActions:6}),1);
 assert.equal(callsOf(f,'write')[0][3],true);
});
test('list engine also positions first and sends selected click without binding',async()=>{
 const f=fixture();f.bridge.inputTarget=async()=>{throw new Error('Unexpected UIA binding');};
 const actions=[{action:'double',id:1,reason:'open'},{action:'double',id:1,reason:'open'},{action:'done',id:null,reason:'done'}];
 f.models.nextAction=async()=>actions.shift();assert.equal(await f.ex.initiative(node('ai',{prompt:'Open target',engine:'list',maxActions:4}),1),true);
 assert.equal(callsOf(f,'move').length,1);assert.equal(callsOf(f,'click')[0][3],'double');
});
test('Stop after model response prevents movement/click dispatch',async()=>{
 const f=fixture();f.models.guiStep=async()=>{f.stop();return action('click',{x:.5,y:.5});};
 await assert.rejects(f.ex.initiative(node('ai',{prompt:'Open target',engine:'screen',maxActions:3}),1),realRunner.StoppedError);
 assert.equal(callsOf(f,'move').length+callsOf(f,'click').length,0);
});
test('initiative routes to the configured decision model in one request, retaining TARS as fallback',async()=>{
 const f=fixture({agentModel:'bytedance/ui-tars-1.5-7b',agentBackups:['~openai/gpt-luna-latest','other-vision']});
 f.models.guiStep=async q=>{f.queries.push(structuredClone(q));return action('finished');};
 assert.equal(await f.ex.initiative(node('ai',{prompt:'Open existing target',engine:'screen'}),1),true);
 assert.equal(f.queries.length,1);assert.deepEqual(f.queries[0].model,['~openai/gpt-luna-latest','other-vision','bytedance/ui-tars-1.5-7b']);
 assert(f.logs.some(l=>/görsel model öne alındı/.test(l.message)));
 assert.equal(callsOf(f,'click').length,0);
});

test('empty text plus Enter sends only the requested Enter',async()=>{
 const f=fixture({screenCheck:'off'});await f.ex.type(writing({text:'',clearFirst:false,pressEnter:true}),1);
 assert.equal(callsOf(f,'write').length,0);assert.deepEqual(callsOf(f,'keys').map(c=>c[1]),['{ENTER}']);
});
