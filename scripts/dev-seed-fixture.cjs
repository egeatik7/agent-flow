#!/usr/bin/env node
/**
 * Puts a small, fixed fixture on the test profile's canvas: one package whose inside creates a
 * file. The loop needs something to repair that looks like the real thing - a node inside a
 * package - and the ids have to be stable so a scenario can name them.
 *
 * Only ever touches the test profile. The instance is stopped first, because the app holds the
 * store in memory and would write over anything changed underneath it.
 *
 * Usage: node scripts/dev-seed-fixture.cjs [profile]   (default: test)
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.join(__dirname, '..')
const profile = (process.argv[2] || 'test').trim()
if (!profile) {
  console.error('Profil adı gerekli; gerçek profil bu betikle tohumlanmaz.')
  process.exit(2)
}
const appDir = path.join(process.env.APPDATA || '', `xp-agent-studio-${profile}`)
const storeFile = path.join(appDir, 'config.json')
const tokenFile = path.join(appDir, 'tool-endpoint.json')

// 1) The instance must be down: a live app would overwrite the store it is holding in memory.
try {
  const token = JSON.parse(fs.readFileSync(tokenFile, 'utf8'))
  if (token?.pid) {
    spawnSync('taskkill', ['/PID', String(token.pid), '/T', '/F'], { stdio: 'ignore' })
    console.log(`  örnek kapatıldı: pid ${token.pid}`)
  }
} catch {
  console.log('  açık örnek yok')
}
spawnSync('taskkill', ['/IM', 'Nubbo-test.exe', '/T', '/F'], { stdio: 'ignore' })
if (fs.existsSync(tokenFile)) fs.rmSync(tokenFile, { force: true })

// 2) Build the fixture with the app's own node factory, so the graph is valid by construction.
let createNode
try {
  ;({ createNode } = require(path.join(root, 'dist-electron', 'graph-types.js')))
} catch (e) {
  console.error(`  dist-electron yok (önce npm run build:electron): ${e.message}`)
  process.exit(2)
}

const start = createNode('start', 0, 0)
start.id = 'fixture-start'
const pkg = createNode('package', 340, 0, 1)
pkg.id = 'fixture-package'
pkg.title = 'Fikstür · dosya üret'

const innerStart = createNode('start', 0, 0)
innerStart.id = 'fixture-inner-start'
const innerKey = createNode('key', 200, 0, 1)
innerKey.id = 'fixture-inner-key'
innerKey.title = 'Fikstür · Çalıştır'
innerKey.keys = 'win+r'
const innerType = createNode('type', 420, 0, 1)
innerType.id = 'fixture-inner-type'
innerType.title = 'Fikstür · komutu yaz'
innerType.text = 'cmd /c md "%TEMP%\\nubbo-pilot" 2>nul & >"%TEMP%\\nubbo-pilot\\inner.txt" echo inner'
innerType.pressEnter = true
innerType.clearFirst = true
const innerWait = createNode('wait', 700, 0, 1)
innerWait.id = 'fixture-inner-wait'
innerWait.title = 'Fikstür · 1,2 sn'
innerWait.ms = 1200
const innerEnd = createNode('end', 940, 0)
innerEnd.id = 'fixture-inner-end'

pkg.inner = {
  nodes: [innerStart, innerKey, innerType, innerWait, innerEnd],
  edges: [
    { id: 'fixture-ie1', from: innerStart.id, fromPort: 'next', to: innerKey.id },
    { id: 'fixture-ie2', from: innerKey.id, fromPort: 'next', to: innerType.id },
    { id: 'fixture-ie3', from: innerType.id, fromPort: 'next', to: innerWait.id },
    { id: 'fixture-ie4', from: innerWait.id, fromPort: 'next', to: innerEnd.id },
  ],
}
const graph = { nodes: [start, pkg], edges: [{ id: 'fixture-e1', from: start.id, fromPort: 'next', to: pkg.id }] }

// 3) Write it into the test profile's store, keeping settings and branches.
let store = { settings: {}, canvases: null }
if (fs.existsSync(storeFile)) {
  try {
    store = JSON.parse(fs.readFileSync(storeFile, 'utf8'))
  } catch {
    /* start from an empty one */
  }
}
const book = { activeId: 'fixture-canvas', tabs: [{ id: 'fixture-canvas', name: 'Tuval 1', graph }], branches: store.canvases?.branches ?? [] }
store.canvases = book
store.graph = graph
fs.writeFileSync(storeFile, JSON.stringify(store, null, 2), 'utf8')
console.log(`  fikstür yazıldı: ${storeFile}`)
console.log('  içerik: Başlangıç → Paket(“Fikstür · dosya üret” içinde: start → win+r → yaz → 1,2 sn → Bitir)')
console.log('  sabit id’ler: fixture-package · fixture-inner-type · fixture-inner-wait')
