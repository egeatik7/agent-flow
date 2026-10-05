const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const output = path.resolve(process.env.NUBBO_TEST_OUTPUT || 'out/windows-desktop');
if (process.platform !== 'win32') {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ status: 'environment-blocked', reason: 'A real Windows desktop is required; no native tests were run.' }, null, 2));
  console.error('ENVIRONMENT BLOCKED: a real Windows desktop is required.');
  process.exitCode = 2;
} else {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [path.resolve(__dirname, '../desktop-test.cjs'), ...process.argv.slice(2)], { stdio: 'inherit', env });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
