const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')

const dist = path.resolve(__dirname, '../dist-electron')
const logs = [], calls = []
let writeResults = [], readValue = 'hello', typeSelection = null
function stub(name, exports) {
  const filename = path.join(dist, name + '.js')
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
const bridge = {
  isLocked: async () => false,
  typeText: async (...args) => {
    calls.push(['typeText', ...args])
    return writeResults.shift() ?? { focusType: 'Edit', cleared: true, value: readValue, writeSent: true }
  },
  inputTarget: async () => ({ hwnd: '100', pid: 10, title: 'Test app', rect: { x: 0, y: 0, w: 1920, h: 1080 } }),
  assertInputTarget: async () => {},
  focusedValue: async () => readValue,
  sendKeys: async keys => calls.push(['key', keys]),
  foreground: async () => ({ title: 'Test app', pid: 10, hwnd: '100' }),
  inputState: async () => ({ type: 'Edit', writable: true, name: 'Input', window: 'Test app' }),
  scan: async () => {
    calls.push(['scan'])
    return { area: { x: 0, y: 0, w: 1920, h: 1080 }, items: [
      { id: 1, text: 'Kaynak klasör', type: 'Text', src: 'uia', x: 20, y: 20, w: 100, h: 20 },
      { id: 2, text: 'Hedef klasör', type: 'Text', src: 'uia', x: 20, y: 70, w: 100, h: 20 },
    ], uiaCount: 2, ocrCount: 0, window: 'Test app', image: null }
  },
  discardShot: () => {},
  clickAt: async (...args) => calls.push(['click', ...args]),
}
stub('a11y-bridge', bridge)
stub('browser', { userChromeItems: async () => null })
stub('shots', { rememberShot: () => {} })
stub('openrouter', {
  chooseTypeField: async () => typeSelection,
  isTarsModel: () => false,
})
const load = Module._load
Module._load = function (id, parent, main) {
  if (id === 'electron') return { screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }) } }
  return load.call(this, id, parent, main)
}
const { createAgent } = require(path.join(dist, 'agent.js'))
Module._load = load
const { judgeScreen } = require(path.join(dist, 'confirm.js'))
const nativePlatform = Object.getOwnPropertyDescriptor(process, 'platform')
Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
test.after(() => Object.defineProperty(process, 'platform', nativePlatform))
function agent() {
  logs.length = calls.length = 0
  writeResults = []; readValue = 'hello'; typeSelection = null
  return createAgent({
    log: (level, message) => logs.push({ level, message }), send: () => {}, shouldStop: () => false,
    settings: () => ({ apiKey: 'test', model: 'test', findOrder: ['windows'] }),
  }).executor
}
const node = extra => ({ id: 'type', kind: 'type', title: 'Yaz', text: 'hello', clearFirst: true, ...extra })


test('one explicit write sends worker input once and one final Enter',async()=>{
 const ex=agent();await ex.type(node({pressEnter:true}),1);
 const writes=calls.filter(c=>c[0]==='typeText');assert.equal(writes.length,1);assert.equal(writes[0][2],false);
 assert.equal(calls.filter(c=>c[0]==='key'&&c[1]==='{ENTER}').length,1);
});
test('writing neither scans nor reads field contents',async()=>{
 const ex=agent();bridge.focusedValue=async()=>{throw new Error('Unexpected readback');};
 await ex.type(node(),1);assert.equal(calls.filter(c=>c[0]==='scan').length,0);
 assert(!logs.some(l=>/Alan doğrulandı/.test(l.message)));
});
test('unsent write cannot be hidden or submit Enter',async()=>{
 const ex=agent();writeResults=[{skippedClear:true,writeSent:false,focusType:'Pane'}];
 await assert.rejects(ex.type(node({pressEnter:true}),1),/INPUT_NOT_SENT/);
 assert.equal(calls.filter(c=>c[0]==='key').length,0);assert.equal(calls.filter(c=>c[0]==='typeText').length,1);
});
test('label click followed by typing passes its point to the typing worker', async () => {
  const ex = agent()
  await ex.click({ id: 'click', kind: 'click', title: 'Kaynak', prompt: '“Kaynak klasör”' }, 1, { next: node() })
  await ex.type(node(), 2)
  assert.deepEqual(calls.find(c => c[0] === 'typeText')[4], { x: 70, y: 30 })
  assert(!logs.some(l => l.level === 'success' && /Hedef klasör.*ekranda/.test(l.message)))
})

test('existing next label and unrelated text change do not prove an action', () => {
  assert.notEqual(judgeScreen(['Hedef klasör', 'old'], ['Hedef klasör', 'new'], 'Hedef klasör').kind, 'ready')
  assert.notEqual(judgeScreen(['Aç'], ['Aç', 'notification'], '').kind, 'ready')
  assert.equal(judgeScreen(['Aç'], ['Aç', 'Dosyaları grupla'], 'Dosyaları grupla').kind, 'ready')
})


test('unreadable/stale contents do not trigger a second write',async()=>{
 const ex=agent();readValue='old-prefix hello';await ex.type(node(),1);
 assert.equal(calls.filter(c=>c[0]==='typeText').length,1);assert(!logs.some(l=>/Alan doğrulandı/.test(l.message)));
});
test('append and numeric text preserve the exact requested mode',async()=>{
 let ex=agent();await ex.type(node({clearFirst:false}),1);assert.equal(calls.find(c=>c[0]==='typeText')[3],false);
 ex=agent();await ex.type(node({text:'1.5'}),1);assert.equal(calls.find(c=>c[0]==='typeText')[1],'1.5');
});
