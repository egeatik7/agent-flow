const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { normalizeGraph, createNode } = require('../dist-electron/graph-types.js');
const { StoppedError, runGraph } = require('../dist-electron/runner.js');
const { recoverySettings } = require('../dist-electron/recovery-settings.js');
const { runRecovery } = require('../dist-electron/recovery.js');

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
    running: false, stopRequested: false, runLog: 'old', recoveryActive: false, StoppedError,
    recoverySettings, runRecovery, modelChain: (primary, backups) => [primary, ...backups],
    recoveryStatus: (active, title, message) => events.push({ active, title, message }),
    pushMethod: () => {}, recentLogLines: () => [], readRecoveryReports: () => [],
    saveRecoveryReport: () => {}, recoveryToolContext: {}, recoveryAbort: () => false,
    recoveryExecutor: () => async () => ({ ok: true, outcome: 'tamam', message: 'Done' }),
    // The code legitimately reads the environment (which profile this instance is), so the sandbox
    // provides one instead of the run failing on a missing global.
    process: { env: { ...process.env } },
    normalizeGraph, store: { set: () => events.push('saved') },
    getSettings: () => ({ hideWhileRunning: false, maxSteps: 2000, stepDelayMs: 0 }),
    ensureLogsDir: () => '', openRunLog: () => {},
    agent: { beginRun: () => {}, executor: {} },
    // The tool layer's own run record, fed from the same handler: it must be released too.
    beginRun: () => events.push('run-begin'),
    endRun: () => events.push('run-end'),
    probing: () => false,
    // Debug mode is asked for per run and is set before the run starts, so a prepare failure must
    // still release everything; the harness needs the same surface `runFlow` uses.
    setDebugRun: (on) => events.push(on ? 'debug-on' : 'debug-off'),
    setErrorStopHook: () => events.push('error-hook'),
    noteError: () => {},
    noteLogLine: () => {},
    // The debug record's surface, as runFlow uses it: opened at a failure, completed by the message
    // and the screenshot that arrive later.
    completeFailure: () => {},
    noteFailureShot: () => {},
    noteRunFailed: () => events.push('run-failed'),
    // The marker a test profile writes into the log at the start of a run.
    isTestProfile: () => false,
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

test('normal action failure waits for recovery, uses its own key, and only then resumes or fails', async () => {
  for (const mode of ['retry', 'stop', 'disabled']) {
    const action = createNode('click', 0, 0);
    const reports = [], calls = [], order = [];
    let attempts = 0;
    const ex = { log: () => {}, step: (_id, status) => order.push(status), shouldStop: () => false,
      click: async () => { attempts++; if (attempts === 1) throw new Error('missing target'); },
      type: async () => {}, key: async () => {}, exists: async () => true };
    const h = harness({
      agent: { beginRun: () => {}, executor: ex }, runGraph,
      getSettings: () => ({ apiKey: 'general-fixture', hideWhileRunning: false, maxSteps: 20, stepDelayMs: 0,
        recovery: recoverySettings({ enabled: mode !== 'disabled', apiKey: 'dedicated-fixture', model: 'fixture/model' }) }),
      recoveryToolTurn: async args => {
        order.push('recover'); calls.push(args);
        return { role: 'assistant', content: null, tool_calls: [{ id: 'r', type: 'function', function: {
          name: mode === 'retry' ? 'recovery_retry' : 'recovery_stop',
          arguments: JSON.stringify({ probableCause: 'Covered', evidence: 'Window', summary: 'Repair result' }) } }] };
      },
      saveRecoveryReport: report => reports.push(structuredClone(report)),
      showSelf: () => order.push('ui-return'), hideSelf: async () => true,
    });
    if (mode === 'retry') {
      assert.equal((await h.run({ nodes: [action], edges: [] }, undefined, undefined, { canvasId: 'saved' })).ok, true);
      // normalizeGraph adds Start to legacy graphs; inspect the failed action's tail.
      assert.deepEqual(order.slice(-4), ['running', 'recover', 'done', 'ui-return']);
      assert.equal(attempts, 2); assert.equal(reports.at(-1).resumed, true);
      assert.equal(reports.at(-1).canvasId, 'saved');
    } else {
      await assert.rejects(h.run({ nodes: [action], edges: [] }), /missing target/);
      assert.equal(attempts, 1);
      assert(mode === 'stop' ? order.indexOf('recover') < order.indexOf('error') : !order.includes('recover'));
    }
    assert(calls.every(call => call.apiKey === 'dedicated-fixture'));
    assert.equal(h.context.running, false); assert.equal(h.context.recoveryActive, false);
    assert(h.events.some(event => event?.active === (mode !== 'disabled')));
  }
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
