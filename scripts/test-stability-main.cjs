const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { normalizeGraph } = require('../dist-electron/graph-types.js');
const { StoppedError } = require('../dist-electron/runner.js');

// Extract the real run path; its dependencies are test doubles. We do not boot
// Electron, patch the desktop, or rewrite a second copy of the runner.
const filename = path.resolve(__dirname, '../electron/main.ts');
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
let callback;
(function walk(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'runFlow') callback = node;
  ts.forEachChild(node, walk);
})(source);
assert(callback, 'runFlow must exist');
const compiled = ts.transpileModule('const handler = ' + callback.getText(source) + '; handler;', {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness(overrides = {}) {
  const events = [];
  const context = {
    running: false, stopRequested: false, runLog: 'old', StoppedError,
    normalizeGraph, store: { set: () => events.push('saved') },
    getSettings: () => ({ hideWhileRunning: false, maxSteps: 2000, stepDelayMs: 0 }),
    ensureLogsDir: () => '', openRunLog: () => {},
    agent: { beginRun: () => {}, executor: {} },
    // The tool layer's own run record, fed from the same handler: it must be released too.
    beginRun: () => events.push('run-begin'),
    endRun: () => events.push('run-end'),
    globalShortcut: { register: () => events.push('registered'), unregister: () => events.push('unregistered') },
    STOP_HOTKEY: 'Ctrl+Shift+Q',
    powerSaveBlocker: { start: () => { events.push('awake'); return 0; }, isStarted: () => true, stop: () => events.push('awake-stopped') },
    log: () => {}, hideSelf: async () => false, revealHud: () => {}, hideHudSoon: () => {},
    showSelf: () => {}, runGraph: async () => ({ failed: 0 }),
    ...overrides,
  };
  vm.createContext(context);
  return { context, events, run: vm.runInContext(compiled, context, { filename }) };
}

test('normalization failure releases run state and a later valid run succeeds', async () => {
  const h = harness();
  await assert.rejects(h.run({ nodes: [{ id: 'x', kind: 'unknown' }], edges: [] }), /Desteklenmeyen/);
  assert.equal(h.context.running, false);
  assert.equal(h.context.runLog, '');
  assert(!h.events.includes('awake'));
  assert(h.events.includes('run-end'), 'run state released when normalization fails');
  const result = await h.run({ nodes: [], edges: [] });
  assert.equal(result.ok, true);
  assert.equal(h.context.running, false);
  assert(h.events.includes('awake-stopped'), 'resource ID 0 is still cleaned');
});

test('store or run preparation failure cannot leave the agent permanently busy', async () => {
  for (const overrides of [
    { store: { set: () => { throw new Error('store failed'); } } },
    { getSettings: () => { throw new Error('settings failed'); } },
    { agent: { beginRun: () => { throw new Error('prepare failed'); } } },
    { powerSaveBlocker: { start: () => { throw new Error('awake failed'); }, isStarted: () => true, stop: () => {} } },
  ]) {
    const h = harness(overrides);
    await assert.rejects(h.run({ nodes: [], edges: [] }));
    assert.equal(h.context.running, false);
    assert.equal(h.context.runLog, '');
    assert(h.events.includes('run-end'), 'run state released even when preparation fails');
  }
});

test('failed cleanup still resets the run state; existing concurrent-run guard remains', async () => {
  const h = harness({ globalShortcut: { register: () => {}, unregister: () => { throw new Error('cleanup failed'); } } });
  await assert.rejects(h.run({ nodes: [], edges: [] }), /cleanup failed/);
  assert.equal(h.context.running, false);
  h.context.running = true;
  await assert.rejects(h.run({ nodes: [], edges: [] }), /zaten çalışıyor/);
  assert.equal(h.context.running, true, 'a rejected second call must not clear the first run');
});

test('existing stopped and partial-failure results are preserved', async () => {
  const stopped = harness({ runGraph: async () => { throw new StoppedError(); } });
  const stoppedResult = await stopped.run({ nodes: [], edges: [] });
  assert.equal(stoppedResult.stopped, true);
  assert.equal(stoppedResult.ok, false);
  assert.equal(stopped.context.running, false);
  const failed = harness({ runGraph: async () => ({ failed: 2 }) });
  const result = await failed.run({ nodes: [], edges: [] });
  assert.equal(result.ok, false);
  assert.equal(result.failed, 2);
});
