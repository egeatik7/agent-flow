// Offline regression tool. The production resolver runs, but OS observations and
// parsed model answers are replayed. This does not measure live model accuracy.
const path = require('node:path');
const Module = require('node:module');
const { loadTrace } = require('./target-recorder.cjs');
const dist = path.resolve(__dirname, '../dist-electron');

async function replayTrace(bundle, observer) {
  const request = bundle.events.find(e => e.kind === 'request');
  if (!request || bundle.events.filter(e => e.kind === 'request').length !== 1) throw new Error('Replay needs exactly one resolver request');
  const observations = source => bundle.events.filter(e => e.kind === 'observation' && e.source === source);
  const windows = observations('windows'), onnx = observations('onnx'), tars = observations('tars');
  const models = bundle.events.filter(e => e.kind === 'model');
  let iconPass = 0, inputCalls = 0;
  function observed(source) {
    const e = observations(source).find(e => Object.hasOwn(e, 'value'));
    if (!e) throw new Error(`No recorded ${source} observation; replay is incomplete`);
    return structuredClone(e.value);
  }
  const noInput = async () => { inputCalls++; throw new Error('Offline replay must never send input'); };
  const bridge = {
    scan: async opts => {
      if (!opts.readOnly) throw new Error('Replay must be read-only');
      const e = opts.ocr === false ? tars.shift() : windows.shift();
      if (!e?.scan) throw new Error('No recorded screen observation; replay is incomplete');
      const scan = structuredClone(e.scan);
      if (opts.ocr !== false) scan.image = null; // diagnostic image was not a live model input
      return scan;
    },
    applyOnnx: async () => {
      const e = onnx.shift();
      if (!e?.scan) throw new Error('No recorded ONNX observation; replay is incomplete');
      return structuredClone(e.scan);
    },
    locate: async (_loc, _win, readOnly) => {
      if (!readOnly) throw new Error('Replay must not activate a window');
      return observed('uia');
    },
    findImage: async () => { const v = observed('icon'); return ++iconPass === 1 ? v.hit : v.again; },
    windowRect: async () => observed('offset'),
    discardShot: () => {},
    clickAt: noInput, typeText: noInput, sendKeys: noInput, inputTarget: noInput,
  };
  const nextModel = source => {
    const i = models.findIndex(e => e.source === source || (source === 'list' && e.source === 'chrome'));
    if (i < 0) throw new Error('No recorded model answer; replay is incomplete');
    return structuredClone(models.splice(i, 1)[0].value);
  };
  const chrome = observations('chrome')[0]?.scan;
  const replacements = {
    'a11y-bridge': bridge,
    browser: { userChromeItems: async () => chrome ? { items: chrome.items, area: chrome.area, host: chrome.window } : null },
    shots: { rememberShot: () => {} },
    openrouter: { isTarsModel: () => false, chooseScreenTarget: async () => nextModel('list'), guiStep: async () => nextModel('tars') },
  };
  const saved = new Map();
  for (const [name, exports] of Object.entries(replacements)) {
    const f = path.join(dist, name + '.js'); saved.set(f, require.cache[f]);
    require.cache[f] = { id: f, filename: f, loaded: true, exports };
  }
  const agentFile = path.join(dist, 'agent.js'); saved.set(agentFile, require.cache[agentFile]); delete require.cache[agentFile];
  const oldLoad = Module._load;
  Module._load = function(id, parent, isMain) {
    if (id === 'electron') return { screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }) } };
    return oldLoad.call(this, id, parent, isMain);
  };
  let agent;
  try {
    agent = require(agentFile).createAgent({
      log: () => {}, send: () => {}, shouldStop: () => false, onTargetTrace: observer,
      settings: () => ({ apiKey: request.modelEnabled ? 'offline-replay-not-a-key' : '', model: 'replayed-model', agentModel: 'replayed-model',
        targetWindow: request.windowTitle, findOrder: request.order, findOff: [] }),
    });
  } finally {
    Module._load = oldLoad;
    for (const [f, value] of saved) { if (value) require.cache[f] = value; else delete require.cache[f]; }
  }
  const node = { ...request.node, memory: request.memory ?? request.node.memory };
  const result = await agent.previewTarget(node);
  return { result, inputCalls, modelAnswersReplayed: true };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: npm run replay:target -- path/to/trace.json'); process.exitCode = 1; }
  else replayTrace(loadTrace(path.resolve(file))).then(r => console.log(JSON.stringify({ ...r, scope: 'Offline reproduction; not a live model or desktop accuracy test.' }, null, 2)))
    .catch(e => { console.error(e.message); process.exitCode = 1; });
}
module.exports = { replayTrace };
