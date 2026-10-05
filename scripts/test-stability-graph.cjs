// Regression tests use current source/compiled modules, never real desktop input.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist-electron');
const types = require(path.join(dist, 'graph-types.js'));
const { judgeScreen } = require(path.join(dist, 'confirm.js'));
const { mergeOnnxLines } = require(path.join(dist, 'ocr-onnx.js'));
const { runGraph } = require(path.join(dist, 'runner.js'));
const { guiStep, parseTars, setStopCheck } = require(path.join(dist, 'openrouter.js'));

function loadGraphOps() {
  const file = path.join(root, 'src/lib/graph-ops.ts');
  const m = new Module(file, module);
  m.filename = file;
  m.paths = module.paths;
  // Resolve the TS-only imports to the same freshly compiled main sources.
  m.require = function (name) {
    if (name === '../../electron/groups') return require(path.join(dist, 'groups.js'));
    if (name === '../../electron/graph-types' || name === '../types') return types;
    return Module.prototype.require.call(this, name);
  };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, file);
  return m.exports;
}
const ops = loadGraphOps();
const n = kind => types.createNode(kind, 0, 0);
let seq = 0;
const e = (a, b, port = 'next') => ({ id: 'edge' + ++seq, from: a.id, to: b.id, fromPort: port });
function allIDs(graph) {
  return graph.nodes.flatMap(node => [node.id, ...(node.inner ? allIDs(node.inner) : [])]);
}

test('duplicating nested packages gives independent IDs, members, edges and exits', () => {
  const pkg = n('package'), nested = n('package'), loop = n('loop'), click = n('click');
  loop.members = [click.id];
  nested.inner = { nodes: [loop, click], edges: [e(loop, click, 'done')] };
  nested.packageExit = { from: click.id, fromPort: 'next' };
  pkg.inner = { nodes: [nested], edges: [] };
  pkg.packageExit = { from: nested.id, fromPort: 'next' };
  const original = { nodes: [pkg], edges: [] };
  const before = structuredClone(original);
  const duplicate = ops.duplicateNode(original, pkg.id);
  assert.deepEqual(original, before, 'source graph must not be mutated');
  const ids = allIDs(duplicate.graph);
  assert.equal(new Set(ids).size, ids.length);
  const copy = duplicate.graph.nodes.find(x => x.id === duplicate.id);
  const child = copy.inner.nodes[0];
  const copiedLoop = child.inner.nodes.find(x => x.kind === 'loop');
  const copiedClick = child.inner.nodes.find(x => x.kind === 'click');
  assert.equal(copy.packageExit.from, child.id);
  assert.equal(child.packageExit.from, copiedClick.id);
  assert.deepEqual(copiedLoop.members, [copiedClick.id]);
  assert.equal(child.inner.edges[0].from, copiedLoop.id);
  assert.equal(child.inner.edges[0].to, copiedClick.id);
  const changed = ops.mapNodes(duplicate.graph, x => x.id === copiedClick.id ? { ...x, prompt: 'new' } : x);
  assert.notEqual(changed.nodes[0].inner.nodes[0].inner.nodes.find(x => x.id === click.id).prompt, 'new');
  assert.equal(changed.nodes[1].inner.nodes[0].inner.nodes.find(x => x.id === copiedClick.id).prompt, 'new');
});

test('ordinary node/loop duplication retains the established placement and empty loop membership', () => {
  const click = n('click'); click.prompt = '“Kaydet”'; click.x = 25; click.y = 40;
  const copy = ops.duplicateNode({ nodes: [click], edges: [] }, click.id).graph.nodes[1];
  assert.equal(copy.prompt, click.prompt);
  assert.deepEqual([copy.x, copy.y], [55, 70]);
  assert.notEqual(copy.id, click.id);
  const loop = n('loop'); loop.count = 3; loop.members = [click.id];
  const d = ops.duplicateNode({ nodes: [loop, click], edges: [] }, loop.id);
  assert.deepEqual(d.graph.nodes.find(x => x.id === d.id).members, []);
  assert.equal(ops.duplicateNode({ nodes: [n('start')], edges: [] }, 'missing'), null);
});

test('copy/paste/unpack keeps the original external continuation', () => {
  const start = n('start'), first = n('click'), next = n('click');
  const original = { nodes: [start, first, next], edges: [e(start, first), e(first, next)] };
  const packed = ops.packageSelection(original, [first.id]);
  const pkg = packed.graph.nodes.find(x => x.id === packed.id);
  const pasted = ops.pasteNodes({ nodes: [next], edges: [] }, ops.copyNodes(packed.graph, [pkg.id]));
  const copy = pasted.graph.nodes.find(x => x.kind === 'package');
  assert(copy.inner.nodes.some(x => x.id === copy.packageExit.from));
  pasted.graph.edges.push(e(copy, next));
  const unpacked = ops.unpackPackage(pasted.graph, copy.id);
  const restoredClick = unpacked.nodes.find(x => x.id === copy.packageExit.from);
  assert(restoredClick);
  assert(unpacked.edges.some(x => x.from === restoredClick.id && x.to === next.id && x.fromPort === 'next'));
});

test('packaging rejects multiple external branches without altering the graph', () => {
  const start = n('start'), condition = n('condition'), yes = n('click'), no = n('click');
  const graph = { nodes: [start, condition, yes, no], edges: [e(start, condition), e(condition, yes, 'true'), e(condition, no, 'false')] };
  const before = structuredClone(graph);
  assert.equal(ops.packageSelection(graph, [condition.id]), null);
  assert.deepEqual(graph, before);
  assert(ops.packageSelection(graph, [condition.id, yes.id, no.id]), 'whole branching flow remains packable');
});

test('packaging rejects different external entry nodes, and valid single-entry round trip works', () => {
  const start = n('start'), a = n('click'), b = n('click'), outside = n('condition');
  const ambiguous = { nodes: [start, outside, a, b], edges: [e(start, outside), e(outside, a, 'true'), e(outside, b, 'false')] };
  assert.equal(ops.packageSelection(ambiguous, [a.id, b.id]), null);
  const graph = { nodes: [start, a, b], edges: [e(start, a), e(a, b)] };
  const packed = ops.packageSelection(graph, [a.id]);
  const unpacked = ops.unpackPackage(packed.graph, packed.id);
  assert(unpacked.edges.some(x => x.from === a.id && x.to === b.id));
  assert(unpacked.edges.some(x => x.from === start.id && x.to === a.id));
});

test('unknown node kinds fail before becoming clicks; valid legacy data stays compatible', () => {
  for (const kind of ['futureNode', 'constructor', 'toString']) {
    assert.throws(() => types.normalizeGraph({ nodes: [{ id: 'x', kind, prompt: 'DELETE' }], edges: [] }), /Desteklenmeyen node/);
  }
  const keys = ['^s', '%{F4}', '+a', '#r', 'win+r'];
  const graph = types.normalizeGraph({ nodes: [
    ...keys.map((keys, i) => ({ id: 'key' + i, kind: 'key', keys })),
    { id: 'legacy', kind: 'waitFor', text: 'BİTTİ' },
    { id: 'untyped', prompt: '“Kaydet”' },
  ], edges: [] });
  assert.deepEqual(graph.nodes.filter(x => x.kind === 'key').map(x => x.keys), keys);
  assert.equal(graph.nodes.find(x => x.id === 'legacy').kind, 'condition');
  assert.equal(graph.nodes.find(x => x.id === 'untyped').kind, 'click');
});

test('unrelated text changes never prove completion; loading and actual new target still work', () => {
  assert.notEqual(judgeScreen(['Hedef', 'old'], ['Hedef', 'new'], 'Hedef').kind, 'ready');
  assert.notEqual(judgeScreen(['Aç'], ['Aç', 'notification'], '').kind, 'ready');
  assert.equal(judgeScreen(['Aç'], ['Aç', 'İşlemi başlat'], 'İşlemi başlat').kind, 'ready');
  assert.equal(judgeScreen(['Aç'], ['Loading'], '').kind, 'loading');
  assert.equal(judgeScreen(['Hedef'], ['Hedef'], 'Hedef').kind, 'missed');
});

test('ONNX accepts clean high-confidence numeric statuses without accepting arbitrary symbols', () => {
  const line = (text, conf = 0.99) => ({ text, conf, x: 0, y: 0, w: 50, h: 20 });
  for (const text of ['60/60', '20', '0', '100%', '1,5', '-3']) {
    assert.equal(mergeOnnxLines([], [line(text)]).items[0]?.text, text);
  }
  for (const text of ['60/60', '20', '0']) assert.equal(mergeOnnxLines([], [line(text, 0.8)]).added, 0);
  assert.equal(mergeOnnxLines([], [line('---')]).added, 0);
  const windows = [{ id: 1, text: '60/60', type: 'Text', src: 'ocr', x: 100, y: 100, w: 50, h: 20 }];
  const mixed = mergeOnnxLines(windows, [line('Done')], 'windows');
  assert.deepEqual(mixed.items.map(x => x.text), ['60/60', 'Done']);
  assert.deepEqual(mergeOnnxLines(windows, [line('Done')], 'onnx').items.map(x => x.text), ['Done'], 'explicit ONNX-only option is unchanged');
});

test('invalid generic GUI coordinates use the next model instead of producing a center click', async () => {
  const oldFetch = global.fetch;
  try {
    for (const invalid of [
      { action: 'click' }, { action: 'click', x: 0.5 }, { action: 'drag', x: 0.5, y: 0.5 },
      { action: 'right', x: -1, y: 0.4 }, { action: 'click', x: 1001, y: 1 },
      { action: 'click', x: 'nonsense', y: 0.5 }, { action: 'click', x: '', y: 0.5 },
    ]) {
      const asked = [];
      global.fetch = async (_url, init) => {
        const model = JSON.parse(init.body).model; asked.push(model);
        const content = model === 'invalid' ? invalid : { action: 'click', x: '500', y: 250 };
        return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }) };
      };
      const result = await guiStep({ apiKey: 'test', model: ['invalid', 'valid'], goal: 'click Save', history: [], screen: { data: 'mock', w: 1920, h: 1080 } });
      assert.deepEqual(asked, ['invalid', 'valid']);
      assert.deepEqual([result.kind, result.x, result.y], ['click', 0.5, 0.25]);
    }
  } finally { global.fetch = oldFetch; setStopCheck(() => false); }
});

test('valid GUI actions, normalized JSON and UI-TARS pixel coordinates stay supported', async () => {
  const oldFetch = global.fetch;
  try {
    for (const action of [
      { action: 'click', x: 0, y: 1 },
      { action: 'drag', x: 0.1, y: 0.2, x2: 0.8, y2: 0.9 },
      { action: 'type', text: '#' },
      { action: 'hotkey', keys: 'win+r' },
      { action: 'scroll', direction: 'down' },
      { action: 'done' }, { action: 'fail' }, { action: 'wait' },
    ]) {
      global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(action) } }] }) });
      const result = await guiStep({ apiKey: 'test', model: 'valid', goal: 'test', history: [], screen: { data: 'mock', w: 1288, h: 728 } });
      assert.equal(result.kind, action.action === 'done' ? 'finished' : action.action === 'fail' ? 'call_user' : action.action);
    }
    const tars = parseTars("Thought: click\nAction: click(start_box='(644,364)')", 1288, 728, true);
    assert.deepEqual([tars.x, tars.y], [0.5, 0.5]);
  } finally { global.fetch = oldFetch; setStopCheck(() => false); }
});

test('a wait lap reaching its step limit never starts the next item', async () => {
  const start = n('start'), loop = n('loop'), click = n('click'), condition = n('condition'), wait = n('wait');
  loop.items = ['A', 'B', 'C']; loop.members = [click.id, condition.id, wait.id];
  click.prompt = 'start {{öğe}}'; condition.text = 'BİTTİ'; wait.ms = 0;
  const actions = [];
  const ex = { log: () => {}, step: () => {}, shouldStop: () => false, click: async x => actions.push(x.prompt), type: async () => {}, key: async () => {}, exists: async () => false };
  const graph = { nodes: [start, loop, click, condition, wait], edges: [e(start, loop), e(click, condition), e(condition, wait, 'false'), e(wait, condition)] };
  await assert.rejects(runGraph(graph, ex, { maxSteps: 4, stepDelayMs: 0 }), /Bu tur 4 adımı geçti/);
  assert.deepEqual(actions, ['start A']);
  assert.equal(loop.startIndex, 0);
});

test('normal item-error policy and successful per-lap step budgets stay unchanged', async () => {
  const start = n('start'), loop = n('loop'), click = n('click');
  loop.items = ['A', 'B', 'C']; loop.members = [click.id]; click.prompt = '{{öğe}}';
  const actions = [];
  const ex = { log: () => {}, step: () => {}, shouldStop: () => false, click: async x => { actions.push(x.prompt); if (x.prompt === 'B') throw Error('item-specific error'); }, type: async () => {}, key: async () => {}, exists: async () => false };
  const summary = await runGraph({ nodes: [start, loop, click], edges: [e(start, loop)] }, ex, { maxSteps: 1, stepDelayMs: 0 });
  assert.deepEqual(actions, ['A', 'B', 'C']);
  assert.equal(summary.failed, 1);
});
