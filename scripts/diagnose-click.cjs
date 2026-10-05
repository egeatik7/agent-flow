const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createTargetRecorder } = require('./target-recorder.cjs');

function arg(name) { const i = process.argv.indexOf(name); return i < 0 ? '' : process.argv[i + 1] || ''; }
app.whenReady().then(async () => {
  const bridge = require('../dist-electron/a11y-bridge.js');
  let exitCode = 0;
  try {
    if (process.platform !== 'win32') throw new Error('A real Windows desktop is required');
    const prompt = arg('--prompt'), windowTitle = arg('--window');
    if (!prompt || !windowTitle) throw new Error('Required: --window "Window title" --prompt "Instruction". Default: preview without input. Add --click to send one click.');
    const output = path.resolve(arg('--output') || 'out/click-diagnostics');
    const recorder = createTargetRecorder(output, 'diagnose');
    const settings = require('../dist-electron/graph-types.js').DEFAULT_SETTINGS;
    const allStages = ['chrome', 'uia', 'icon', 'windows', 'onnx', 'list', 'tars', 'offset'];
    const order = arg('--stages') ? arg('--stages').split(',') : ['uia', 'windows', 'onnx'];
    if (order.some(s => !allStages.includes(s))) throw new Error('Unknown stage; use ' + allStages.join(','));
    const { createAgent } = require('../dist-electron/agent.js');
    const node = { id: 'diagnostic-click', kind: 'click', title: 'Diagnostic click', prompt };
    const agent = createAgent({ log: (level, message) => console.log(`[${level}] ${message}`), send: () => {}, shouldStop: () => false,
      onTargetTrace: recorder.save, captureTargetImages: true,
      settings: () => ({ ...settings, targetWindow: windowTitle, findOrder: order, findOff: allStages.filter(s => !order.includes(s)),
        apiKey: process.env.NUBBO_TEST_API_KEY || '', model: process.env.NUBBO_TEST_TEXT_MODEL || settings.model,
        agentModel: process.env.NUBBO_TEST_GUI_MODEL || settings.agentModel }),
    });
    const result = process.argv.includes('--click')
      ? (await agent.executor.click(node, 1, { next: { id: 'observer', kind: 'condition', title: 'Independent observer' } }), { inputSent: true, targetActivationNotVerified: true })
      : await agent.previewTarget(node);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ mode: process.argv.includes('--click') ? 'one-click' : 'read-only-preview', result, traces: recorder.files() }, null, 2));
    console.log(JSON.stringify(result));
    console.log('Evidence: ' + output);
  } catch (e) { console.error(e.stack); exitCode = 1; }
  finally { bridge.shutdown(); app.exit(exitCode); }
});
