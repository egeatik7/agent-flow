const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const dist = path.resolve(__dirname, '../dist-electron');
const { createNode } = require(path.join(dist, 'graph-types.js'));
const { StoppedError } = require(path.join(dist, 'runner.js'));
const platform = Object.getOwnPropertyDescriptor(process, 'platform');
Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
test.after(() => Object.defineProperty(process, 'platform', platform));

function agent(overrides = {}, settings = {}) {
  const calls = [], logs = [];
  let cursor={x:0,y:0};
  let stop = false;
  const scan = { area: { x: 0, y: 0, w: 1920, h: 1080 }, items: [], image: null, window: 'Blender', ocr: true, uiaCount: 0, ocrCount: 0 };
  const bridge = {
    isLocked: async () => false,
    locate: async () => { calls.push(['locate']); return { x: 10, y: 20, w: 80, h: 20, name: 'OLD', enabled: true }; },
    scan: async (opts) => { calls.push(['scan', opts]); return scan; },
    applyOnnx: async res => res,
    discardShot: () => {},
    clickAt: async (...args) => calls.push(['click', ...args]),
    moveMouse: async (x,y) => {cursor={x,y};calls.push(['move',x,y]);return {hwnd:1};},
    cursorPos: async () => cursor,
    clickCurrentAt: async (x,y,hwnd) => {calls.push(['click',x,y,'left']);calls.push(['currentClick',x,y,hwnd]);},
    typeText: async (...args) => { calls.push(['write', ...args]); return { value: 'hello', writeSent: true }; },
    inputTarget: async () => ({ hwnd: '1', pid: 10, title: 'Blender', rect: { x: 0, y: 0, w: 1920, h: 1080 } }),
    assertInputTarget: async () => {},
    focusedValue: async () => null,
    inputState: async () => ({ type: 'Edit', window: 'Blender' }),
    foreground: async () => ({ title: 'Blender', pid: 10, hwnd: '1', proc: 'blender' }),
    windowRect: async () => ({ x: 0, y: 0, w: 1920, h: 1080 }),
    sendKeys: async (...args) => calls.push(['keys', ...args]),
    ...overrides,
  };
  const models = { isTarsModel: () => false, ...overrides.models };
  for (const [name, exports] of Object.entries({
    'a11y-bridge': bridge, browser: { userChromeItems: async () => null },
    shots: { rememberShot: () => {} }, openrouter: models,
  })) {
    const file = path.join(dist, name + '.js');
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  }
  const file = path.join(dist, 'agent.js');
  delete require.cache[file];
  const oldLoad = Module._load;
  Module._load = function (id, parent, main) {
    if (id === 'electron') return { screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }) } };
    return oldLoad.call(this, id, parent, main);
  };
  let instance;
  try {
    instance = require(file).createAgent({
      log: (level, message) => logs.push({ level, message }),
      send: () => {}, shouldStop: () => stop,
      settings: () => ({ apiKey: '', model: '', findOrder: ['uia'], findOff: [], ...settings }),
    });
  } finally { Module._load = oldLoad; }
  return { calls, logs, bridge, scan, ex: instance.executor, beginRun: instance.beginRun, stop: () => stop = true };
}
function node(kind, extra = {}) { return { ...createNode(kind, 0, 0), ...extra }; }
const loc = { name: 'OLD', controlType: 'Button', windowTitle: 'Blender', automationId: 'button' };
const nextCondition = { next: node('condition') };

test('edited condition cannot succeed from its old locator', async () => {
  const a = agent();
  assert.equal(await a.ex.exists('BİTTİ', node('condition', { locator: loc, text: '“BİTTİ”' })), false);
  assert(!a.calls.some(x => x[0] === 'locate'));
  assert(a.calls.some(x => x[0] === 'scan'));
});

test('edited condition still succeeds when the new text is actually visible', async () => {
  const a = agent();
  a.scan.items = [{ id: 1, text: 'BİTTİ', type: 'Text', src: 'ocr', x: 20, y: 20, w: 50, h: 20 }];
  assert.equal(await a.ex.exists('BİTTİ', node('condition', { locator: loc, text: '“BİTTİ”' })), true);
});

test('picked condition text requires current combined OCR evidence, not a saved UIA target', async () => {
  const a = agent();
  assert.equal(await a.ex.exists('', node('condition', { locator: loc })), false);
  a.scan.items = [{ id: 1, text: 'OLD', type: 'Text', src: 'ocr', x: 20, y: 20, w: 50, h: 20 }];
  assert.equal(await a.ex.exists('', node('condition', { locator: loc })), true);
  assert(!a.calls.some(x => x[0] === 'locate'));
  const options = a.calls.filter(x => x[0] === 'scan').map(x => x[1]);
  assert(options.every(o => o.readOnly && o.uia === false && o.image === 'none' && o.ocrEngine === 'combined'));
});

test('icon-only conditions cannot succeed from an image match or send input', async () => {
  const a = agent();
  a.bridge.findImage = async () => { a.calls.push(['findImage']); return { score: 0.99, x: 10, y: 10 }; };
  assert.equal(await a.ex.exists('', node('condition', { locator: { controlType: 'Point', icon: 'saved-image' } })), false);
  assert(!a.calls.some(x => ['findImage', 'locate', 'click', 'move', 'keys', 'write'].includes(x[0])));
});

test('disabled saved UIA target is not clicked', async () => {
  const a = agent({ locate: async () => ({ x: 10, y: 20, w: 80, h: 20, name: 'OLD', enabled: false }) });
  await assert.rejects(a.ex.click(node('click', { prompt: '“OLD”', locator: loc }), 1, nextCondition));
  assert(!a.calls.some(x => x[0] === 'click'));
});

test('edited quoted click target does not use its old locator', async () => {
  const a = agent();
  await assert.rejects(a.ex.click(node('click', { prompt: '“NEW”', locator: loc }), 1, nextCondition));
  assert(!a.calls.some(x => x[0] === 'click' || x[0] === 'locate'));
});

test('stop during locator lookup prevents the later click', async () => {
  const a = agent();
  a.bridge.locate = async () => { a.stop(); return { x: 10, y: 20, w: 80, h: 20, name: 'OLD' }; };
  await assert.rejects(a.ex.click(node('click', { locator: loc }), 1, nextCondition), StoppedError);
  assert(!a.calls.some(x => x[0] === 'click'));
});

test('stop during typing prevents the final Enter', async () => {
  const a = agent();
  a.bridge.typeText = async (...args) => { a.calls.push(['write', ...args]); a.stop(); return { value: 'hello', writeSent: true }; };
  await assert.rejects(a.ex.type(node('type', { text: 'hello', pressEnter: true }), 1, nextCondition), StoppedError);
  assert.equal(a.calls.filter(x => x[0] === 'write').length, 1);
  assert(!a.calls.some(x => x[0] === 'keys'));
});

test('user Stop before key dispatch prevents sending the key', async () => {
  const a = agent();
  await a.ex.click(node('click', { locator: loc }), 1, nextCondition);
  a.stop();
  await assert.rejects(a.ex.key(node('key', { keys: 'win+r' }), nextCondition), StoppedError);
  assert(!a.calls.some(x => x[0] === 'keys'));
});

test('stop during the post-click focus wait prevents typing', async () => {
  const a = agent();
  a.bridge.clickAt = async (...args) => { a.calls.push(['click', ...args]); a.stop(); };
  await assert.rejects(a.ex.type(node('type', { locator: loc, text: 'hello' }), 1, nextCondition), StoppedError);
  assert.equal(a.calls.filter(x => x[0] === 'click').length, 1);
  assert(!a.calls.some(x => x[0] === 'write'));
});

test('real unsent append never clears or blindly appends again', async () => {
  const a = agent({ typeText: async (...args) => { a.calls.push(['write', ...args]); return { writeSent: false, value: null }; } });
  await assert.rejects(a.ex.type(node('type', { text: 'hello', clearFirst: false, pressEnter: true }), 1, nextCondition), /INPUT_NOT_SENT/);
  const writes = a.calls.filter(x => x[0] === 'write');
  assert.equal(writes.length, 1);
  assert.equal(writes[0][3], false);
  assert(!a.calls.some(x => x[0] === 'keys'));
});

test('append and replacement are sent once; normal Enter occurs once', async () => {
  const a = agent({ typeText: async (...args) => { a.calls.push(['write', ...args]); return { writeSent: true, value: null }; } });
  await a.ex.type(node('type', { text: 'hello', clearFirst: false }), 1);
  assert.equal(a.calls.filter(x => x[0] === 'write').length, 1);
  const b = agent(); let writes = 0;
  b.bridge.typeText = async (...args) => { b.calls.push(['write', ...args]); writes++;return { writeSent: true, value: null }; };
  await b.ex.type(node('type', { text: 'hello', pressEnter: true }), 1, nextCondition);
  assert.deepEqual(b.calls.filter(x => x[0] === 'write').map(x => x[3]), [true]);
  assert.equal(b.calls.filter(x => x[0] === 'keys' && x[1] === '{ENTER}').length, 1);
});

test('late initiative model answer after stop never acts or announces completion', async () => {
  const a = agent({ models: { nextAction: async () => { a.stop(); return { action: 'key', keys: 'win+r', id: null, reason: '' }; } } }, { apiKey: 'test', model: 'model' });
  await assert.rejects(a.ex.initiative(node('ai', { prompt: 'Open Run', engine: 'list' }), 1), StoppedError);
  assert(!a.calls.some(x => x[0] === 'keys'));
  assert(!a.logs.some(x => x.level === 'success' && /hedefe ulaştı/.test(x.message)));
});

test('late visual finished answer after stop cannot be announced as success', async () => {
  const a = agent({ models: { guiStep: async () => { a.stop(); return { kind: 'finished', thought: '', text: '' }; } } }, { apiKey: 'test', agentModel: 'model' });
  a.scan.image = { data: 'mock', w: 1288, h: 728 };
  await assert.rejects(a.ex.initiative(node('ai', { prompt: 'Open Blender', engine: 'screen' }), 1), StoppedError);
  assert(!a.logs.some(x => x.level === 'success' && /hedefe ulaştı/.test(x.message)));
});

test('visual initiative accepts finished without a second model judging or restarting the task', async () => {
  let turns=0, checks=0;
  const a=agent({models:{guiStep:async()=>{turns++;return {kind:'finished',thought:'Selected profile is open',text:'',raw:'finished()'};},visionCheck:async()=>{checks++;return {answer:false,reason:'Profile picker is no longer visible'};}}},{apiKey:'test',agentModel:'model',visionModel:'model'});
  a.scan.image={data:'mock',w:1288,h:728};
  assert.equal(await a.ex.initiative(node('ai',{prompt:'Select the first profile and finish',engine:'screen',maxActions:8}),1),true);
  assert.equal(turns,1); assert.equal(checks,0);
  assert.equal(a.calls.filter(c=>c[0]==='scan').length,1);
  assert(!a.calls.some(c=>c[0]==='click'));
  assert(!a.logs.some(l=>/kontrol onaylamadı/.test(l.message)));
});
test('profile click followed by finished does not open profile menus after a hypothetical verifier rejection', async () => {
  let turns=0,checks=0;
  const a=agent({patchAt:async()=>null,models:{guiStep:async()=>++turns===1?{kind:'click',x:.326,y:.563,thought:'First profile',raw:'click()'}:turns===2?{kind:'clickCurrent',thought:'Pointer is on existing first profile',raw:'click_current()'}:{kind:'finished',thought:'Chrome is open',text:'',raw:'finished()'},visionCheck:async()=>{checks++;return {answer:false,reason:'Profile picker is gone'};}}},{apiKey:'test',agentModel:'model',visionModel:'model'});
  a.scan.image={data:'mock',w:1288,h:728};
  assert.equal(await a.ex.initiative(node('ai',{prompt:'Select first Chrome profile',engine:'screen',maxActions:8}),1),true);
  assert.equal(turns,3);assert.equal(checks,0);assert.equal(a.calls.filter(c=>c[0]==='click').length,1,JSON.stringify(a.logs));
});
test('a completed recorded initiative path returns without a second completion check', async () => {
  let turns=0,checks=0;
  const a=agent({models:{guiStep:async()=>{turns++;throw new Error('Should not resume a completed path');},visionCheck:async()=>{checks++;return {answer:false,reason:'Picker is gone'};}}},{apiKey:'test',agentModel:'model',visionModel:'model'});
  a.scan.image={data:'mock',w:1288,h:728};
  assert.equal(await a.ex.initiative(node('ai',{prompt:'Select profile',engine:'screen',path:[{action:'wait',sig:''}]}),1),true);
  assert.equal(turns,0);assert.equal(checks,0);
});

const hover = require(path.join(dist, 'hover.js'));

test('new run clears a hover left by the preceding run', () => {
  const a=agent(); hover.recordHover({x:100,y:200},42);
  a.beginRun(); assert.equal(hover.hoverOf(),undefined);
});

test('list initiative move executes movement without clicking, and records the window', async () => {
  let turns=0;
  const a=agent({moveMouse:async(...args)=>{a.calls.push(['move',...args]);return {hwnd:42};}, models:{nextAction:async()=>++turns===1?{action:'move',id:7,reason:''}:{action:'done',id:null,reason:''}}}, {apiKey:'test',model:'model'});
  a.scan.items=[{id:7,text:'Chrome',type:'Text',src:'ocr',x:100,y:200,w:50,h:20}];
  assert.equal(await a.ex.initiative(node('ai',{prompt:'Hover Chrome',engine:'list',maxActions:3}),1),true);
  assert(a.calls.some(x=>x[0]==='move'));
  assert(!a.calls.some(x=>x[0]==='click')); assert.equal(hover.hoverOf()?.hwnd,42);
});

test('move node followed by screen click_current uses shared fresh hover and requests a marked frame', async () => {
  let turns=0;
  const a=agent({moveMouse:async()=>({hwnd:42}),cursorPos:async()=>({x:50,y:30}),clickCurrentAt:async(...args)=>a.calls.push(['currentClick',...args]),models:{guiStep:async()=>++turns===1?{kind:'clickCurrent',thought:'',raw:'click_current()'}:{kind:'finished',thought:'',raw:'finished()'}}},{apiKey:'test',agentModel:'model'});
  a.scan.image={data:'fake',w:100,h:100};
  a.bridge.scan=async(opts)=>{a.calls.push(['scan',opts]);return a.scan};
  await a.ex.click(node('click',{locator:loc,clickMode:'move'}),1);
  assert.equal(await a.ex.initiative(node('ai',{prompt:'Click hovered target',engine:'screen',maxActions:3}),1),true);
  assert(a.calls.some(x=>x[0]==='click'&&x[1]===50&&x[2]===30&&x[3]==='left'));
  assert(a.calls.some(x=>x[0]==='scan'&&x[1]?.cursorMarker===true));
  assert.equal(hover.hoverOf(),undefined);
});

test('stop while cursor is being read cannot send a click_current', async () => {
  const a=agent({cursorPos:async()=>{a.stop();return {x:100,y:200}},clickCurrentAt:async()=>a.calls.push(['currentClick']),models:{guiStep:async()=>({kind:'clickCurrent',thought:'',raw:'click_current()'})}},{apiKey:'test',agentModel:'model'});
  a.scan.image={data:'fake',w:100,h:100};hover.recordHover({x:100,y:200},42);
  await assert.rejects(a.ex.initiative(node('ai',{prompt:'Click hovered target',engine:'screen',maxActions:2}),1),StoppedError);
  assert(!a.calls.some(x=>x[0]==='currentClick'));
});


test('click_current uses actual pointer without a hover-window gate', async () => {
 let turns=0;
 const a=agent({cursorPos:async()=>({x:100,y:200}),clickCurrentAt:async()=>a.calls.push(['currentClick']),models:{guiStep:async()=>++turns===1?{kind:'clickCurrent',thought:'',raw:'click_current()'}:{kind:'finished',thought:'',raw:'finished()'}}},{apiKey:'test',agentModel:'model'});
 a.scan.image={data:'fake',w:100,h:100};hover.recordHover({x:100,y:200});
 await a.ex.initiative(node('ai',{prompt:'Click hovered target',engine:'screen',maxActions:3}),1);
 assert(a.calls.some(x=>x[0]==='click'&&x[1]===100&&x[2]===200));assert.equal(hover.hoverOf(),undefined);
});
