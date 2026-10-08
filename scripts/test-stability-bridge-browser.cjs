const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist-electron');
const realOnnx = require(path.join(dist, 'ocr-onnx.js'));
const flush = async () => { for (let i = 0; i < 14; i++) await Promise.resolve(); };

class FakeProc extends EventEmitter {
  constructor() {
    super();
    this.stdin = new PassThrough(); this.stdout = new PassThrough(); this.stderr = new PassThrough();
    this.input = '';
    this.stdin.on('data', d => this.input += String(d));
  }
  kill() { this.killed = true; return true; } // exit is deliberately delayed
  say(line) { this.stdout.write(line + '\n'); }
  requests() { return this.input.trim().split('\n').filter(Boolean).map(x => ({ id: x.split('\t')[0], op: x.split('\t')[1] })); }
  answer(id, data) { this.say(id + '\t' + Buffer.from(JSON.stringify({ ok: true, data })).toString('base64')); }
}
async function fakeBridge(run, onnx = {}) {
  const spawned = [], timers = [];
  const oldLoad = Module._load, oldSet = global.setTimeout, oldClear = global.clearTimeout;
  const oldPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  global.setTimeout = (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; };
  global.clearTimeout = t => { if (t) t.cleared = true; };
  const file = path.join(dist, 'a11y-bridge.js');
  delete require.cache[file];
  Module._load = function (id, parent, main) {
    if (id === 'child_process') return { spawn: () => { const p = new FakeProc(); spawned.push(p); return p; } };
    if (id === 'electron') return { app: { isPackaged: false, getAppPath: () => root } };
    if (id === './ocr-onnx') return onnx;
    return oldLoad.call(this, id, parent, main);
  };
  let bridge;
  try { bridge = require(file); await run({ bridge, spawned, timers }); }
  finally {
    bridge?.shutdown();
    Module._load = oldLoad; global.setTimeout = oldSet; global.clearTimeout = oldClear;
    Object.defineProperty(process, 'platform', oldPlatform);
  }
}

test('delayed old worker exit cannot reject a healthy new request or corrupt its output', async () => {
  await fakeBridge(async ({ bridge, spawned, timers }) => {
    const old = bridge.clickAt(1, 1).then(() => null, e => e);
    await flush(); spawned[0].say('READY'); await flush();
    timers.find(t => t.ms === 60000 && !t.cleared).fn();
    assert.match((await old).message, /zaman aşımı/);
    const pending = bridge.clickAt(2, 2);
    await flush(); spawned[1].say('READY'); await flush();
    const id = spawned[1].requests()[0].id;
    const response = id + '\t' + Buffer.from(JSON.stringify({ ok: true, data: true })).toString('base64') + '\n';
    spawned[1].stdout.write(response.slice(0, 6));
    spawned[0].stdout.write('orphaned-partial-data');
    spawned[0].emit('exit', null);
    spawned[1].stdout.write(response.slice(6));
    await pending;
    const next = bridge.clickAt(3, 3); await flush();
    assert.equal(spawned.length, 2, 'old exit must not drop the new process');
    spawned[1].answer(spawned[1].requests()[1].id, true);
    await next;
  });
});

test('active worker exit still rejects its own pending request and allows restart', async () => {
  await fakeBridge(async ({ bridge, spawned }) => {
    const first = bridge.clickAt(1, 1).then(() => null, e => e);
    await flush(); spawned[0].say('READY'); await flush();
    spawned[0].emit('exit', null);
    assert.match((await first).message, /işçisi kapandı/);
    const second = bridge.clickAt(2, 2);
    await flush(); spawned[1].say('READY'); await flush();
    spawned[1].answer(spawned[1].requests()[0].id, true);
    await second;
  });
});

test('a short request queued behind a long request starts its timeout only when sent', async () => {
  await fakeBridge(async ({ bridge, spawned, timers }) => {
    const click = bridge.clickAt(1, 1); await flush();
    spawned[0].say('READY'); await flush();
    const foreground = bridge.foreground(); await flush();
    assert(!timers.some(t => t.ms === 10000 && !t.cleared), 'no foreground timer while queued');
    assert.equal(spawned[0].requests().length, 1);
    spawned[0].answer(spawned[0].requests()[0].id, true);
    await click; await flush();
    assert(timers.some(t => t.ms === 10000 && !t.cleared));
    spawned[0].answer(spawned[0].requests()[1].id, { title: 'Blender', pid: 7 });
    assert.deepEqual(await foreground, { title: 'Blender', pid: 7 });
    assert.equal(spawned.length, 1);
  });
});

test('ONNX fallback preserves a Windows status and adds the missing other label', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-ocr-test-'));
  const shot = path.join(dir, 'shot.raw'); fs.writeFileSync(shot, 'mock');
  try {
    await fakeBridge(async ({ bridge }) => {
      const result = await bridge.applyOnnx({
        area: { x: 0, y: 0, w: 100, h: 100 }, image: null, shot,
        items: [{ id: 1, text: '60/60', type: 'Text', src: 'ocr', x: 50, y: 50, w: 20, h: 10 }],
        ocrEngine: 'windows',
      });
      assert.deepEqual(result.items.map(x => x.text), ['60/60', 'Done']);
    }, {
      ...realOnnx,
      readRawShot: () => ({ bgra: Buffer.alloc(16), w: 2, h: 2 }),
      recognizeBgra: async () => [{ text: 'Done', conf: 0.99, x: 0, y: 0, w: 20, h: 10 }],
      recognizeSideways: async () => [],
      onnxError: () => null,
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function page(label, title) {
  return {
    isClosed: () => false, title: async () => title,
    evaluate: async source => source.includes('INTERACTIVE')
      ? { out: [{ text: label, type: 'Button', x: 10, y: 10, w: 100, h: 20 }], vw: 1920, vh: 1080 }
      : { sx: 0, sy: 0, dpr: 1, top: 80 },
  };
}
async function fakeBrowser(pages, run) {
  const old = Module._load; const file = path.join(dist, 'browser.js'); delete require.cache[file];
  Module._load = function (id, parent, main) {
    if (id === 'playwright-core') return { chromium: { connectOverCDP: async () => ({ isConnected: () => true, on: () => {}, contexts: () => [{ pages: () => pages }] }) } };
    return old.call(this, id, parent, main);
  };
  try { await run(require(file)); } finally { Module._load = old; }
}
test('nonmatching requested window gets no Chrome DOM candidates', async () => {
  await fakeBrowser([page('Save', 'Hunyuan'), page('Download', 'Hunyuan')], async browser => {
    assert.equal(await browser.userChromeItems('Blender'), null);
  });
});
test('matching Chrome title and unspecified window retain their supported paths', async () => {
  await fakeBrowser([page('Generate', 'Hunyuan')], async browser => {
    assert.deepEqual((await browser.userChromeItems('Hunyuan - Google Chrome')).items.map(x => x.text), ['Generate']);
    assert.deepEqual((await browser.userChromeItems()).items.map(x => x.text), ['Generate']);
  });
});

test('input identity, geometry, focus and crop options survive the real worker bridge', async () => {
  await fakeBridge(async ({ bridge, spawned }) => {
    const target = { hwnd: '100', pid: 10, title: 'Renamer', rect: { x: -1000, y: 0, w: 1000, h: 700 } };
    const guard = { window: target, at: { x: -500, y: 415 }, visual: true };
    async function checkRequest(call, expected) {
      const pending = call(); await flush();
      const proc = spawned[0]; if (!proc.requests().length) { proc.say('READY'); await flush(); }
      const line = proc.input.trim().split('\n').at(-1).split('\t');
      assert.equal(line[1], expected.op);
      const payload = JSON.parse(Buffer.from(line[2], 'base64').toString('utf8'));
      for (const [key, value] of Object.entries(expected.payload)) assert.deepEqual(payload[key], value, key);
      proc.answer(line[0], expected.result ?? true); await pending;
    }
    await checkRequest(() => bridge.inputTarget({ target, followOwnedDialog: true }), { op: 'inputTarget', payload: { target, followOwnedDialog: true, ownPid: process.pid }, result: target });
    await checkRequest(() => bridge.clickAt(-500, 415, 'left', target), { op: 'clickAt', payload: { target, x: -500, y: 415 } });
    await checkRequest(() => bridge.typeText('hello', false, true, guard.at, undefined, guard), { op: 'typeText', payload: { guard, x: -500, y: 415, pressEnter: false, clearFirst: true } });
    await checkRequest(() => bridge.assertInputTarget(target, '110'), { op: 'assertInputTarget', payload: { target, focusHwnd: '110' } });
    await checkRequest(() => bridge.sendKeys('{ENTER}', undefined, target, '110'), { op: 'keys', payload: { target, focusHwnd: '110', keys: '{ENTER}' } });
    await checkRequest(() => bridge.crop(target.rect, 1008, true, 28), { op: 'crop', payload: { ...target.rect, maxW: 1008, fit: true, snap: 28 }, result: { area: target.rect, image: { data: 'mock', w: 1008, h: 700 } } });
  });
});

test('public input bridge selects explicit keyboard/direct-key paths and carries self PID',async()=>{
 await fakeBridge(async ({bridge,spawned})=>{
  const write=bridge.typeText('hello',false,true,{x:662,y:462});await flush();spawned[0].say('READY');await flush();
  let parts=spawned[0].input.trim().split('\n').at(-1).split('\t');let p=JSON.parse(Buffer.from(parts[2],'base64').toString());
  assert.equal(p.keyboard,true);assert.equal(p.clearFirst,true);assert.equal(p.ownPid,process.pid);
  spawned[0].answer(parts[0],{writeSent:true,value:null});await write;
  const key=bridge.sendKeys('win+r');await flush();parts=spawned[0].input.trim().split('\n').at(-1).split('\t');p=JSON.parse(Buffer.from(parts[2],'base64').toString());
  assert.equal(p.direct,true);assert.equal(p.keys,'win+r');assert.equal(p.ownPid,process.pid);spawned[0].answer(parts[0],true);await key;
  const hotkey=bridge.hotkey(['ctrl','a']);await flush();parts=spawned[0].input.trim().split('\n').at(-1).split('\t');p=JSON.parse(Buffer.from(parts[2],'base64').toString());
  assert.equal(p.ownPid,process.pid);assert.deepEqual(p.keys,['ctrl','a']);spawned[0].answer(parts[0],true);await hotkey;
  const click=bridge.clickAt(20,30,'double');await flush();parts=spawned[0].input.trim().split('\n').at(-1).split('\t');p=JSON.parse(Buffer.from(parts[2],'base64').toString());
  assert.equal(p.ownPid,process.pid);assert.equal(p.button,'double');assert.equal(p.target,undefined);spawned[0].answer(parts[0],true);await click;
 });
});

test('all OCR scan preferences fuse conflicting readers on the captured frame without another worker capture', async () => {
  for (const preference of [undefined, 'windows', 'onnx', 'combined']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-combined-test-'));
    const shot = path.join(dir, 'xpas-onnx-fixture.raw'); fs.writeFileSync(shot, 'frame');
    let normal = 0, sideways = 0;
    try {
      await fakeBridge(async ({ bridge, spawned }) => {
        bridge.setOcrEngine(preference);
        const pending = bridge.scan({ image: 'none', tilt: true, readOnly: true, ocrEngine: preference });
        await flush(); spawned[0].say('READY'); await flush();
        const req = spawned[0].requests()[0];
        spawned[0].answer(req.id, { area: { x: -1920, y: 30, w: 1920, h: 1080 }, items: [{ id: 1, text: 'Finlshed', type: 'Text', src: 'ocr', x: -1900, y: 50, w: 100, h: 20 }], image: null, shot, ocr: true, ocrCount: 1, uiaCount: 0 });
        const result = await pending;
        assert.equal(spawned[0].requests().length, 1);
        assert.deepEqual(result.items.map(i => i.text), ['Finlshed', 'Finished']);
        assert.deepEqual(result.items.map(i => i.ocrSources), [['windows'], ['onnx']]);
        assert.equal(result.ocrEngine, 'combined'); assert.equal(result.shot, undefined);
      }, { ...realOnnx, readRawShot: () => ({ bgra: Buffer.alloc(16), w: 2, h: 2 }),
        recognizeBgra: async (bgra, w, h, x, y) => { normal++; assert.equal(x, -1920); assert.equal(y, 30); return [{ text: 'Finished', conf: .99, x: -1900, y: 50, w: 100, h: 20 }]; },
        recognizeSideways: async (_b, _w, _h, _x, _y, _items, mode) => { sideways++; assert.equal(mode, 'combined'); return []; }, onnxError: () => null });
      assert.equal(normal, 1); assert.equal(sideways, 1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});
test('a failed ONNX reader preserves the Windows words, preview and same-frame fallback', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-combined-fail-'));
  const shot = path.join(dir, 'xpas-onnx-fixture.raw'); fs.writeFileSync(shot, 'frame');
  try {
    await fakeBridge(async ({ bridge, spawned }) => {
      const pending = bridge.scan({ image: 'plain', readOnly: true });
      await flush(); spawned[0].say('READY'); await flush();
      const words = [{ t: 'Done', x: 10, y: 10, w: 40, h: 20 }];
      spawned[0].answer(spawned[0].requests()[0].id, { area: { x: 0, y: 0, w: 100, h: 100 }, items: [{ id: 1, text: 'Done', type: 'Text', src: 'ocr', x: 10, y: 10, w: 40, h: 20, words }], image: { data: 'PREVIEW', w: 100, h: 100 }, shot, ocr: true, ocrCount: 1, uiaCount: 0 });
      const r = await pending; assert.deepEqual(r.items[0].words, words); assert.equal(r.items[0].text, 'Done');
      assert.equal(r.image.data, 'PREVIEW'); assert.equal(r.onnx, false); assert.equal(r.shot, undefined);
    }, { ...realOnnx, readRawShot: () => ({ bgra: Buffer.alloc(16), w: 2, h: 2 }), recognizeBgra: async () => { throw new Error('unavailable'); } });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
