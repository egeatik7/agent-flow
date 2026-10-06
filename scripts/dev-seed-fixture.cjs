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
// "package": a flow with a package to repair. "ui": a flow that drives the real window fixture.
const mode = (process.argv[3] || 'package').trim()
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

let graph
let canvasName = 'Tuval 1'
let summary = ''
if (mode === 'ui') {
  // A flow that drives the real window fixture. The window is named in the target, because the
  // engine's ladder scans the window in front by default and this flow must reach its own window
  // even while the console or another app happens to be in front.
  const win = 'Nubbo Click Test Host'
  const focus = createNode('click', 280, 0, 1)
  focus.id = 'ui-focus-field'
  // The title must not contain the searched text: otherwise the app's own canvas is a candidate for
  // the very string being looked for, and the engine rightly refuses to click its own window.
  focus.title = 'UI · alanı odakla'
  focus.prompt = 'Kaynak klasör'
  // No windowTitle scoping here: it is measured to find nothing for this window, while the
  // whole-screen scan does see the field by its label. Noted as its own finding instead of being
  // worked around silently.
  focus.locator = undefined
  const write = createNode('type', 560, 0, 1)
  write.id = 'ui-write'
  write.title = 'UI · alana yaz ve Enter'
  // The same labelled field the click above is aiming at: a person clicks a field and types into
  // it, and the two nodes should agree about where that field is.
  write.prompt = 'Kaynak klasör'
  write.text = 'nubbo-ui-test'
  write.pressEnter = true
  write.clearFirst = true
  const press = createNode('click', 840, 0, 1)
  press.id = 'ui-press-button'
  press.title = 'UI · Devam düğmesine bas'
  press.prompt = 'Devam'
  press.locator = undefined
  const end = createNode('end', 1120, 0)
  end.id = 'fixture-ui-end'
  graph = {
    nodes: [start, focus, write, press, end],
    edges: [
      { id: 'ui-e1', from: start.id, fromPort: 'next', to: focus.id },
      { id: 'ui-e2', from: focus.id, fromPort: 'next', to: write.id },
      { id: 'ui-e3', from: write.id, fromPort: 'next', to: press.id },
      { id: 'ui-e4', from: press.id, fromPort: 'next', to: end.id },
    ],
  }
  canvasName = 'Arayüz'
  summary = 'Başlangıç → tıkla(“source-initial” @ Nubbo Click Test Host) → yaz(“nubbo-ui-test” + Enter) → tıkla(“Devam”) → Bitir'
} else if (mode === 'loop') {
  // Kabul pilotu: paket içinde bir döngü; her öğede geçici dosya yazar, sonra kasıtlı olarak
  // BULUNMAYAN bir yazıya tıklamaya çalışır. Birinci öğe dosyasını yazar, sonra hata verir.
  const pkg = createNode('package', 300, 0, 1)
  pkg.id = 'pilot-package'
  pkg.title = 'Pilot · paket ve döngü'
  const innerStart = createNode('start', 0, 0)
  innerStart.id = 'pilot-inner-start'
  const box = createNode('loop', 220, 0, 1)
  box.id = 'pilot-loop'
  box.title = 'Pilot · iki öğe'
  box.items = ['bir', 'iki']
  const key = createNode('key', 440, 0, 1)
  key.id = 'pilot-key'
  key.title = 'Pilot · Çalıştır'
  key.keys = 'win+r'
  const wait1 = createNode('wait', 640, 0, 1)
  wait1.id = 'pilot-wait1'
  wait1.title = 'Pilot · 0,9 sn'
  wait1.ms = 900
  const write = createNode('type', 860, 0, 1)
  write.id = 'pilot-write'
  write.title = 'Pilot · dosyayı yaz'
  write.text = 'cmd /c md "%TEMP%\\nubbo-pilot" 2>nul & >"%TEMP%\\nubbo-pilot\\loop-{{sıra}}.txt" echo {{öğe}}'
  write.pressEnter = true
  write.clearFirst = true
  const wait2 = createNode('wait', 1080, 0, 1)
  wait2.id = 'pilot-wait2'
  wait2.title = 'Pilot · 1,2 sn'
  wait2.ms = 1200
  const bad = createNode('click', 1300, 0, 1)
  bad.id = 'pilot-bad-click'
  bad.title = 'Pilot · bulunmayan yazıya tıkla'
  bad.prompt = 'YOK-BU-YAZI-ASLA-YOK'
  // İkinci kasıtlı hata: birincisi onarıldıktan SONRA ortaya çıkar. Böylece ikinci onarımın
  // birinciyi kaybetmediği ölçülebilir.
  const bad2 = createNode('click', 1520, 0, 1)
  bad2.id = 'pilot-bad-click2'
  bad2.title = 'Pilot · ikinci bulunmayan yazıya tıkla'
  bad2.prompt = 'YOK-BU-YAZI-2-DE-YOK'
  const innerEnd = createNode('end', 1740, 0)
  innerEnd.id = 'pilot-inner-end'
  box.members = [key.id, wait1.id, write.id, wait2.id, bad.id, bad2.id]
  pkg.inner = {
    nodes: [innerStart, box, key, wait1, write, wait2, bad, bad2, innerEnd],
    edges: [
      { id: 'pilot-e1', from: innerStart.id, fromPort: 'next', to: box.id },
      { id: 'pilot-e2', from: box.id, fromPort: 'next', to: key.id },
      { id: 'pilot-e3', from: key.id, fromPort: 'next', to: wait1.id },
      { id: 'pilot-e4', from: wait1.id, fromPort: 'next', to: write.id },
      { id: 'pilot-e5', from: write.id, fromPort: 'next', to: wait2.id },
      { id: 'pilot-e6', from: wait2.id, fromPort: 'next', to: bad.id },
      { id: 'pilot-e7', from: bad.id, fromPort: 'next', to: bad2.id },
      { id: 'pilot-e8', from: bad2.id, fromPort: 'next', to: innerEnd.id },
    ],
  }
  const end = createNode('end', 620, 0)
  end.id = 'pilot-end'
  graph = { nodes: [start, pkg, end], edges: [{ id: 'pilot-r1', from: start.id, fromPort: 'next', to: pkg.id }, { id: 'pilot-r2', from: pkg.id, fromPort: 'next', to: end.id }] }
  canvasName = 'Pilot'
  summary = 'Başlangıç → Paket(“Pilot · paket ve döngü”: start → kutu[bir,iki] içinde win+r → yaz({{sıra}}.txt = {{öğe}}) → BULUNMAYAN yazıya tıkla) → Bitir'
} else {
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
graph = { nodes: [start, pkg], edges: [{ id: 'fixture-e1', from: start.id, fromPort: 'next', to: pkg.id }] }
summary = 'Başlangıç → Paket(“Fikstür · dosya üret” içinde: start → win+r → yaz → 1,2 sn → Bitir)'
}

// 3) Write it into the test profile's store, keeping settings and branches.
let store = { settings: {}, canvases: null }
if (fs.existsSync(storeFile)) {
  try {
    store = JSON.parse(fs.readFileSync(storeFile, 'utf8'))
  } catch {
    /* start from an empty one */
  }
}
const book = { activeId: 'fixture-canvas', tabs: [{ id: 'fixture-canvas', name: canvasName, graph }], branches: store.canvases?.branches ?? [] }
store.canvases = book
store.graph = graph
fs.writeFileSync(storeFile, JSON.stringify(store, null, 2), 'utf8')
console.log(`  fikstür yazıldı (${mode}): ${storeFile}`)
console.log(`  içerik: ${summary}`)
console.log('  sabit id’ler: fixture-package · fixture-inner-type · fixture-inner-wait · ui-focus-field · ui-write · ui-press-button')
