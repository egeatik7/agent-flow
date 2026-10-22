const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { normalizeGraph, createNode } = require('../dist-electron/graph-types.js');
const { fileSetup, fileCanvasKey } = require('../dist-electron/file-contract.js');
const { StoppedError, runGraph, newTally } = require('../dist-electron/runner.js');
const { recoverySettings } = require('../dist-electron/recovery-settings.js');
const { runRecovery } = require('../dist-electron/recovery.js');
const { assertRunStructure, structureSummary } = require('../dist-electron/run-structure.js');

// Extract the real run path; its dependencies are test doubles. We do not boot
// Electron, patch the desktop, or rewrite a second copy of the runner.
const filename = path.resolve(__dirname, '../electron/main.ts');
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
let callback, namedFileCallback;
(function walk(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'runFlow') callback = node;
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'usesNamedFiles') namedFileCallback = node;
  ts.forEachChild(node, walk);
})(source);
assert(callback, 'runFlow must exist');
const compiled = ts.transpileModule(namedFileCallback.getText(source) + '\nconst handler = ' + callback.getText(source) + '; handler;', {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness(overrides = {}) {
  const events = [];
  const context = {
    running: false, stopRequested: false, runLog: 'old', recoveryActive: false, StoppedError, newTally,
    fileSetup, fileCanvasKey, recoverySettings, runRecovery, assertRunStructure, structureSummary, modelChain: (primary, backups) => [primary, ...backups],
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
    agent: { beginRun: () => {}, releaseRunSettings: () => events.push('agent-released'), executor: {} },
    // The tool layer's own run record, fed from the same handler: it must be released too.
    beginRun: () => events.push('run-begin'),
    endRun: () => events.push('run-end'),
    probing: () => false,
    // Debug mode is asked for per run and is set before the run starts, so a prepare failure must
    // still release everything; the harness needs the same surface `runFlow` uses.
    setDebugRun: (on) => events.push(on ? 'debug-on' : 'debug-off'),
    setErrorStopHook: () => events.push('error-hook'),
    noteError: () => {},
    // 1.9.89: tablet izleme durumu. runFlow kosunun basinda/sonunda haber verir;
    // harness in kendi kurali: runFlow un kullandigi yuzeyin aynisi burada da olmali.
    viewerState: { begin: () => {}, finish: () => {}, event: () => {}, setBook: () => {}, setReports: () => {} },
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
    // 1.9.104: runFlow kosu sonunda zamanlayici geri sayimini da birakir; yuzeyin aynisi burada da var.
    stopHudCountdown: () => events.push('countdown-stop'),
    // 1.9.163: kosu bitince model kronometresi de durur; yuzeyin aynisi burada da olmali.
    durdurHudStopwatch: () => events.push('stopwatch-stop'),
    // 1.9.129: kosu bitince baglam olcum karti da birakilir (bir sonraki kosuya eski olcum tasinmaz).
    // runFlow un kullandigi yuzeyin aynisi: main.ts bunu gercek durum nesnesiyle yapar.
    baglamKartiniTemizle: () => events.push('context-cleared'),
    // 1.9.170: kosu bitince bellek karti SILINMEZ, donmus/eski olarak kalir (kart nesnesi null'a cekilmez).
    bellekKartiniTemizle: () => events.push('memory-frozen'),
    // 1.9.130: kosu basinda ve hata aninda bellek olcumunun son ornegi gunluge girer (her ornek DEGIL).
    // runFlow un kullandigi yuzeyin aynisi: main.ts bunu gercek olcum dongusuyle yapar.
    bellekGunlukBaslangic: () => events.push('memory-start'),
    bellekGunlukHatasi: (mesaj) => events.push({ memoryError: mesaj }),
    // 1.9.160: runFlow artik checkpoint oturumu da acar/kapatir. Testte gercek disk izleyici
    // ACILMAZ (ag ve zamanlayici yok); yalniz runFlow un cagirdigi yuzey taklit edilir.
    checkpoints: {
      begin: async () => { events.push('checkpoint-begin') },
      mark: async () => 'test-checkpoint',
      finish: async () => { events.push('checkpoint-finish') },
      snapshot: async () => ({ graph: { nodes: [], edges: [] }, cursor: { packagePath: [], loops: [], scopes: [] } }),
    },
    // checkpoint yolu structuredClone kullanir; vm baglaminda bulunmayabilir.
    structuredClone: (value) => JSON.parse(JSON.stringify(value)),
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
      agent: { beginRun: () => {}, releaseRunSettings: () => {}, executor: ex }, runGraph,
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
      // The retried step succeeded: the operator must see success, not the first failure reported as a resume failure.
      assert(h.events.some(e => e?.message === 'Kurtarma başarılı; akış aynı öğede devam ediyor.'));
      assert(!h.events.some(e => e?.message?.startsWith('Kurtarma sonrası devam başarısız')));
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
    { agent: { beginRun: () => { throw new Error('prepare failed'); }, releaseRunSettings: () => {} } },
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
  // Temizlik hatası, çalışma durumu SIFIRLANDIKTAN SONRA çalışan bir adımda üretilir (1.9.168:
  // Durdur kısayolu artık koşuya değil uygulama ömrüne bağlı; eski test register/unregister'ı
  // kullanıyordu ve bu kanca kalkınca senaryo hiç tetiklenmiyordu).
  const h = harness({ hideHudSoon: () => { throw new Error('cleanup failed') } });
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
