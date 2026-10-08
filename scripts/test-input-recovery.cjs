// Real compiled executor; OS/model boundaries are recorded, no desktop input.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const dist = path.resolve(__dirname, '../dist-electron');
const policy = require(path.join(dist, 'input-policy.js'));
const runnerFile = path.join(dist, 'runner.js');
const realRunner = require(runnerFile);
const realModels = require(path.join(dist, 'openrouter.js'));
const win = { hwnd: '100', pid: 10, title: 'Renamer', rect: { x: 0, y: 0, w: 1000, h: 700 } };
const node = (kind, extra = {}) => ({ id: kind, kind, title: kind, ...extra });
const writing = extra => node('type', { text: 'hello', clearFirst: true, ...extra });
const missed = { cleared: false, pasted: false, skippedClear: true, writeSent: false, focusType: 'Pane', code: 'INPUT_FOCUS_UNRESOLVED', diagnostics: { type: 'Pane', native: 'TkChild', window: 'Renamer' } };
const action = (kind, extra = {}) => ({ kind, thought: 'field', raw: kind + '()', ...extra });
function stub(name, exports) { const f = path.join(dist, name + '.js'); require.cache[f] = { id: f, filename: f, loaded: true, exports }; }
function fixture(settings = {}) {
  let stopping = false;
  const calls = [], logs = [], queries = [], queue = [], traces = [];
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
  const models = { isTarsModel: () => false, guiStep: async q => { queries.push(structuredClone(q)); return action('click', { x: 0.65, y: 0.72 }); }, chooseVisualTarget: async q => { queries.push(structuredClone(q)); return {intent:'target',x:.65,y:.72,reason:'input'}; }, chooseTypeField: async () => ({ id: 99, reason: 'no such field' }) };
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
  try { instance = require(f).createAgent({ log: (level, message) => logs.push({ level, message }), send: () => {}, onTargetTrace: e => traces.push(e), shouldStop: () => stopping, settings: () => ({ apiKey: 'test', model: 'test', agentModel: 'gui', findOrder: ['windows'], hideWhileRunning: true, ...settings }) }); }
  finally { Module._load = oldLoad; }
  return { ex: instance.executor, previewTarget: instance.previewTarget, beginRun: instance.beginRun, bridge, models, calls, logs, queries, queue, scan, traces, stop: () => stopping = true, move: value => current = value };
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

// Popup recovery belongs only to the visual target finder, not the initiative loop.
function visualFixture(extra={}) {
 const f=fixture({findOrder:['tars'],screenCheck:'off',...extra});
 const frames=[];
 f.bridge.scan=async opts=>{frames.push(structuredClone(opts));return {...f.scan,image:{...f.scan.image,data:'FRAME_'+frames.length}};};
 f.frames=frames;
 return f;
}
const visualClick=extra=>node('click',{prompt:'Click the output folder input',...extra});
const visualReply=(intent,x=.8,y=.3)=>({intent,x,y,reason:intent});
test('popup dismissal stays in the same node; a new frame resolves the original field before writing',async()=>{
 const f=visualFixture();const replies=[visualReply('dismiss'),visualReply('target',.2,.6)];
 f.models.chooseVisualTarget=async q=>{f.queries.push(structuredClone(q));return replies.shift();};
 await f.ex.click(visualClick(),1,{next:writing()});await f.ex.type(writing(),2);
 assert.equal(f.queries.length,2);assert.equal(f.frames.length,2);
 assert.equal(f.queries[0].allowDismiss,true);assert.equal(f.queries[1].allowDismiss,false);
 assert.equal(f.queries[1].goal,f.queries[0].goal);assert.match(f.queries[1].dismissalRecord,/No click on the requested target/);
 assert.notEqual(f.queries[0].screen.data,f.queries[1].screen.data);assert.equal(f.frames[1].fresh,true);
 assert.deepEqual(callsOf(f,'click').map(c=>c.slice(1)),[[800,210,'left'],[200,420,'left']]);
 assert.deepEqual(f.calls.filter(c=>['click','write'].includes(c[0])).map(c=>c[0]),['click','click','write']);
 const targets=f.traces.filter(t=>t.kind==='resolved');assert.equal(targets.length,1);assert.equal(targets[0].target.x,200);
 assert.equal(f.traces.filter(t=>t.kind==='input'&&t.mode==='popup-dismiss').length,1);
});
test('unobstructed visual targeting remains one request and preserves single/double/right click modes',async()=>{
 for(const mode of ['left','double','right']) {
  const f=visualFixture();await f.ex.click(visualClick({clickMode:mode}),1);
  assert.equal(f.queries.length,1);assert.equal(f.frames.length,1);assert.equal(callsOf(f,'click').length,1);assert.equal(callsOf(f,'click')[0][3],mode);
 }
});
test('popup closes with a single left click while the real target retains its double/right mode',async()=>{
 for(const mode of ['double','right']) {
  const f=visualFixture();const replies=[visualReply('dismiss'),visualReply('target',.4,.5)];f.models.chooseVisualTarget=async()=>replies.shift();
  await f.ex.click(visualClick({clickMode:mode}),1);assert.deepEqual(callsOf(f,'click').map(c=>c[3]),['left',mode]);
 }
});
test('move-only node resolves the real target without sending a click',async()=>{
 const f=visualFixture();await f.ex.click(visualClick({clickMode:'move'}),1);
 assert.equal(f.queries[0].allowDismiss,false);assert.equal(callsOf(f,'click').length,0);assert.equal(callsOf(f,'move').length,1);
});
test('move-only node cannot turn a model dismissal proposal into a click',async()=>{
 const f=visualFixture();f.models.chooseVisualTarget=async()=>visualReply('dismiss');
 await assert.rejects(f.ex.click(visualClick({clickMode:'move'}),1),/salt okunur/);assert.equal(callsOf(f,'click').length,0);
});
test('read-only preview cannot dismiss a popup or move the mouse',async()=>{
 const f=visualFixture();f.models.chooseVisualTarget=async q=>{f.queries.push(q);return visualReply('dismiss');};
 await assert.rejects(f.previewTarget(visualClick()),/salt okunur/);
 assert.equal(f.queries[0].allowDismiss,false);assert.equal(f.frames[0].readOnly,true);
 assert.equal(callsOf(f,'click').length+callsOf(f,'move').length,0);
});
test('targeted type lookup cannot send an intermediate popup click',async()=>{
 const f=visualFixture();f.models.chooseVisualTarget=async q=>{f.queries.push(q);return visualReply('dismiss');};
 await assert.rejects(f.ex.type(writing({prompt:'Input'}),1),/salt okunur/);
 assert.equal(f.queries[0].allowDismiss,false);assert.equal(callsOf(f,'click').length+callsOf(f,'write').length,0);
});
test('a second dismissal is not sent and the generic retry does not repeat the first',async()=>{
 const f=visualFixture();f.models.chooseVisualTarget=async q=>{f.queries.push(q);return visualReply('dismiss');};
 await assert.rejects(f.ex.click(visualClick(),1).then(()=>f.ex.type(writing(),2)),/ikinci/);
 assert.equal(f.queries.length,2);assert.equal(callsOf(f,'click').length,1);assert.equal(callsOf(f,'write').length,0);
 assert.equal(f.traces.filter(t=>t.kind==='resolved').length,0);
});
test('missing target after dismissal fails without a close-point crop, extra retry or typing',async()=>{
 const f=visualFixture();const replies=[visualReply('dismiss'),{intent:'missing',reason:'Input absent'}];f.models.chooseVisualTarget=async q=>{f.queries.push(q);return replies.shift();};
 await assert.rejects(f.ex.click(visualClick(),1).then(()=>f.ex.type(writing(),2)),/asıl hedefi göstermedi/);
 assert.equal(f.queries.length,2);assert.equal(callsOf(f,'click').length,1);assert.equal(callsOf(f,'crop').length,0);assert.equal(callsOf(f,'write').length,0);
});
test('model failure after dismissal never retries the partially completed target lookup',async()=>{
 const f=visualFixture();let n=0;f.models.chooseVisualTarget=async()=>{if(++n===1)return visualReply('dismiss');throw new Error('API failed');};
 await assert.rejects(f.ex.click(visualClick(),1),/Popup girdisinden sonra/);assert.equal(n,2);assert.equal(callsOf(f,'click').length,1);
});
test('failed or partially dispatched popup input is never resent',async()=>{
 const f=visualFixture();f.models.chooseVisualTarget=async()=>visualReply('dismiss');let n=0;f.bridge.clickAt=async()=>{n++;throw new Error('native send failed');};
 await assert.rejects(f.ex.click(visualClick(),1),/tekrar gönderilmeyecek/);assert.equal(n,1);assert.equal(f.frames.length,1);
});
test('Stop after popup decision prevents its input dispatch',async()=>{
 const f=visualFixture();f.models.chooseVisualTarget=async()=>{f.stop();return visualReply('dismiss');};
 await assert.rejects(f.ex.click(visualClick(),1),realRunner.StoppedError);assert.equal(callsOf(f,'click').length,0);
});
test('Stop after popup input prevents rescan and final target click',async()=>{
 const f=visualFixture();f.models.chooseVisualTarget=async()=>visualReply('dismiss');f.bridge.clickAt=async(...args)=>{f.calls.push(['click',...args]);f.stop();};
 await assert.rejects(f.ex.click(visualClick(),1),realRunner.StoppedError);assert.equal(f.frames.length,1);assert.equal(callsOf(f,'click').length,1);
});
test('Stop during the refreshed target response prevents the final click',async()=>{
 const f=visualFixture();let n=0;f.models.chooseVisualTarget=async()=>{if(++n===1)return visualReply('dismiss');f.stop();return visualReply('target');};
 await assert.rejects(f.ex.click(visualClick(),1),realRunner.StoppedError);assert.equal(callsOf(f,'click').length,1);
});
test('target mapping uses the refreshed window bounds, including a negative initial desktop origin',async()=>{
 const f=visualFixture();let scans=0;f.bridge.scan=async()=>({...f.scan,area:++scans===1?{x:-1000,y:50,w:1000,h:700}:{x:300,y:200,w:600,h:400}});
 const replies=[visualReply('dismiss'),visualReply('target',.25,.5)];f.models.chooseVisualTarget=async()=>replies.shift();
 await f.ex.click(visualClick(),1);assert.deepEqual(callsOf(f,'click').map(c=>c.slice(1)),[[-200,260,'left'],[450,400,'left']]);
});
test('crop target mapping still works and a crop can never dismiss a popup',async()=>{
 const f=visualFixture();const replies=[{intent:'missing',reason:'Small target'},{intent:'target',x:.5,y:.5,reason:'Found in crop'}];
 f.models.chooseVisualTarget=async q=>{f.queries.push(q);return replies.shift();};
 await f.ex.click(visualClick({locator:{controlType:'Point',x:500,y:350}}),1);
 assert.equal(f.queries.length,2);assert.equal(f.queries[1].allowDismiss,false);assert.deepEqual(callsOf(f,'click')[0].slice(1),[500,350,'left']);
});

test('real HTTP reply parser + executor + runner keep dismissal before the requested field and type',async()=>{
 const f=visualFixture();f.models.chooseVisualTarget=realModels.chooseVisualTarget;
 const originalFetch=global.fetch;let requests=0;
 global.fetch=async()=>({ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(++requests===1?{intent:'dismiss',x:800,y:300,reason:'Close popup'}:{intent:'target',x:200,y:600,reason:'Requested field'})},finish_reason:'stop'}]})});
 try {
  const click=visualClick(),write=writing(),start=node('start'),end=node('end');
  const graph={nodes:[start,click,write,end],edges:[{id:'s',from:start.id,fromPort:'next',to:click.id},{id:'c',from:click.id,fromPort:'next',to:write.id},{id:'w',from:write.id,fromPort:'next',to:end.id}]};
  await realRunner.runGraph(graph,f.ex,{maxSteps:10,stepDelayMs:0});
  assert.equal(requests,2);assert.deepEqual(callsOf(f,'click').map(c=>c.slice(1)),[[800,210,'left'],[200,420,'left']]);
  assert.deepEqual(f.calls.filter(c=>['click','write'].includes(c[0])).map(c=>c[0]),['click','click','write']);
 } finally {global.fetch=originalFetch;}
});
test('real runner does not enter a connected Write node when the original target is missing after dismissal',async()=>{
 const f=visualFixture();const replies=[visualReply('dismiss'),{intent:'missing',reason:'Still blocked'}];f.models.chooseVisualTarget=async()=>replies.shift();
 const click=visualClick(),write=writing();const graph={nodes:[click,write],edges:[{id:'c',from:click.id,fromPort:'next',to:write.id}]};
 await assert.rejects(realRunner.runGraph(graph,f.ex,{maxSteps:10,stepDelayMs:0,startId:click.id}),/asıl hedefi göstermedi/);
 assert.equal(callsOf(f,'write').length,0);assert.equal(callsOf(f,'click').length,1);
});
