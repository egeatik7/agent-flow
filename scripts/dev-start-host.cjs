#!/usr/bin/env node
/**
 * Starts the real-window fixture: a WPF window with a labelled text box and buttons, which writes
 * everything it receives - every control's current text and every click it got, with the control's
 * own id - into state.json a few times a second.
 *
 * That file is the point. A shell command can create a file, but only the application itself can
 * say "this box now contains this text" and "the click landed on this button". The engine drives
 * the window; this only puts the window there and clears its event list first.
 *
 * Usage: node scripts/dev-start-host.cjs
 */
const fs = require('fs')
const path = require('path')
const { spawn, spawnSync } = require('child_process')

const root = path.join(__dirname, '..')
const dir = path.join(root, 'test-artifacts', 'fixture')
const exe = path.join(dir, 'NubboClickTestHost.exe')
fs.mkdirSync(dir, { recursive: true })

// One host at a time: a leftover window would take clicks meant for this run.
spawnSync('taskkill', ['/IM', 'NubboClickTestHost.exe', '/T', '/F'], { stdio: 'ignore' })

if (!fs.existsSync(exe)) {
  const built = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'windows', 'build-host.ps1'), '-Output', exe],
    { encoding: 'utf8', timeout: 120_000 }
  )
  if (!fs.existsSync(exe)) {
    console.error(`  fıkstür derlenemedi: ${built.stderr || built.stdout || ''}`)
    process.exit(2)
  }
  console.log('  fıkstür derlendi')
}

const stateFile = path.join(dir, 'state.json')
if (fs.existsSync(stateFile)) fs.rmSync(stateFile, { force: true })
const child = spawn(exe, [dir], { detached: true, stdio: 'ignore' })
child.unref()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  for (let i = 1; i <= 30; i++) {
    await sleep(500)
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
      if (state?.title === 'Nubbo Click Test Host') {
        // Clear the event list so the evidence belongs to this run and nothing else.
        // The fixture's command key is "kind" (a wrong key shows up as an error inside state.json).
        fs.writeFileSync(path.join(dir, 'command.json'), JSON.stringify({ seq: Date.now(), kind: 'reset' }), 'utf8')
        await sleep(400)
        // And keep it above everything: a maximised window would cover it, and a covered control is
        // not on screen for the ladder to read.
        fs.writeFileSync(path.join(dir, 'command.json'), JSON.stringify({ seq: Date.now() + 1, kind: 'topmost' }), 'utf8')
        await sleep(600)
        const after = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
        console.log(`  ✓ fıkstür hazır: hwnd ${state.hwnd} · pid ${state.pid} · interactive ${state.interactive} · olay ${(after.events || []).length}`)
        console.log(`  rapor: ${path.relative(root, stateFile)}`)
        process.exit(0)
      }
    } catch {
      /* not written yet */
    }
  }
  console.error('  ✗ fıkstür penceresi açılmadı')
  process.exit(1)
}
main()
