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
    // Kimlik doğrulaması: pencere başlığı test profili damgası taşımalı, yoksa hiç kapatılmaz.
    let baslik = ''
    try {
      baslik = String(
        spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${Number(token.pid)} -ErrorAction SilentlyContinue).MainWindowTitle`], { encoding: 'utf8' }).stdout || ''
      ).trim()
    } catch {
      /* okunamadı */
    }
    if (/test profili/i.test(baslik)) {
      spawnSync('taskkill', ['/PID', String(token.pid), '/T', '/F'], { stdio: 'ignore' })
      console.log(`  örnek kapatıldı: pid ${token.pid} · “${baslik}”`)
    } else {
      console.log(`  örnek KAPATILMADI (pid ${token.pid}: başlıkta test profili damgası yok) — jeton eski olabilir`)
    }
  }
} catch {
  console.log('  açık örnek yok')
}
// İsimle toplu öldürme YOK (kaldırıldı): portable exe kendini geçici klasöre açtığı için isimle
// öldürmek, aynı ada benzeyen başka bir örneği de götürebilir. Kapatma yalnız jetonun pid'i ile ve
// kimliği doğrulanarak yapılır: pencere başlığında "test profili" damgası olmalı.
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
} else if (mode === 'blender') {
  // Gerçek bir iş: Nubbo Blender'ı açar, küpü koyar ve kırmızı materyali atar. İş Blender'ın kendi
  // Python'unda yapılır (fabrika ayarlarıyla, kullanıcının ayarlarına/addon'larına dokunulmaz) ve
  // kanıt olarak %TEMP% içine bir rapor ile bir .blend yazar.
  const key = createNode('key', 320, 0, 1)
  key.id = 'blender-key'
  key.title = 'Blender · Çalıştır penceresi'
  key.keys = 'win+r'
  // Once masaustundeki kisayola tiklanir: tek tik simgeyi secer ve odagi masaustune verir, boylece
  // motor kisayolu guvenle gonderebilir (baska bir pencere ondeyken gondermiyor).
  const pick = createNode('click', 120, 0, 1)
  pick.id = 'blender-pick'
  pick.title = 'Blender · masaüstündeki simgeye tıkla'
  pick.prompt = 'Blender 5.2'
  const wait0 = createNode('wait', 220, 0, 1)
  wait0.id = 'blender-wait0'
  wait0.title = 'Blender · 0,8 sn'
  wait0.ms = 800
  const wait1 = createNode('wait', 560, 0, 1)
  wait1.id = 'blender-wait1'
  wait1.title = 'Blender · 0,9 sn'
  wait1.ms = 900
  const type = createNode('type', 800, 0, 1)
  type.id = 'blender-type'
  type.title = 'Blender · başlat komutunu yaz'
  type.text = '"C:\\Users\\ASUS TUF\\AppData\\Local\\Temp\\nubbo-blender-cube.cmd"'
  type.pressEnter = true
  type.clearFirst = true
  const wait2 = createNode('wait', 1040, 0, 1)
  wait2.id = 'blender-wait2'
  wait2.title = 'Blender · 9 sn (açılış)'
  wait2.ms = 9000
  const end = createNode('end', 1280, 0)
  end.id = 'blender-end'
  // Once masaustu one gelir: pencere yoneticisi tum pencereleri kucultur, boylece Calistir kutusu
  // temiz bir on planda acilir ve kullanici ne oldugunu ekranda gorur.
  const desk = createNode('key', 160, 0, 1)
  desk.id = 'blender-desktop'
  desk.title = 'Blender · masaüstünü aç (win+d)'
  desk.keys = 'win+d'
  const waitDesk = createNode('wait', 220, 0, 1)
  waitDesk.id = 'blender-wait-desk'
  waitDesk.title = 'Blender · 1 sn'
  waitDesk.ms = 1000
  graph = {
    nodes: [start, desk, waitDesk, key, wait1, type, wait2, end],
    edges: [
      { id: 'bl-e0', from: start.id, fromPort: 'next', to: desk.id },
      { id: 'bl-e0b', from: desk.id, fromPort: 'next', to: waitDesk.id },
      { id: 'bl-e1', from: waitDesk.id, fromPort: 'next', to: key.id },
      { id: 'bl-e2', from: key.id, fromPort: 'next', to: wait1.id },
      { id: 'bl-e3', from: wait1.id, fromPort: 'next', to: type.id },
      { id: 'bl-e4', from: type.id, fromPort: 'next', to: wait2.id },
      { id: 'bl-e5', from: wait2.id, fromPort: 'next', to: end.id },
    ],
  }
  canvasName = 'Blender'
  summary = 'Başlangıç → win+d (masaüstünü aç) → win+r → yaz(başlat komutu + Enter) → 9 sn → Bitir'
} else if (mode === 'coords') {
  // Koordinat ölçümü: ekranda GÖRÜNEN ve büyük dört yazıya tıklama node'u. Okuyucunun verdiği
  // konumla görsel modelin işaret ettiği konum aynı mı diye karşılaştırmak için (salt okunur ölçüm).
  const hedefler = [
    ['c-file', 'File', 200],
    ['c-edit', 'Edit', 420],
    ['c-layout', 'Layout', 640],
    ['c-modeling', 'Modeling', 860],
  ]
  const nodes = [start]
  const edges = []
  let prev = start.id
  for (const [id, yazi, x] of hedefler) {
    const n = createNode('click', x, 0, 1)
    n.id = id
    n.title = `Ölçüm · “${yazi}”`
    n.prompt = yazi
    nodes.push(n)
    edges.push({ id: `${id}-e`, from: prev, fromPort: 'next', to: id })
    prev = id
  }
  const end = createNode('end', 1080, 0)
  end.id = 'c-end'
  nodes.push(end)
  edges.push({ id: 'c-e-end', from: prev, fromPort: 'next', to: end.id })
  graph = { nodes, edges }
  canvasName = 'Ölçüm'
  summary = 'Başlangıç → File → Edit → Layout → Modeling → Bitir (yalnız ölçüm; tıklanmaz)'
} else if (mode === 'redsuzanne') {
  // TAM GOREV, YALNIZ ARAYUZ: Blender'i ac, menuden Suzanne'i koy, Material sekmesinden yeni
  // materyal olustur, Base Color kutusunu ac, Hex alanina FF0000 yaz. Betik yok, Python yok.
  const w = (id, ms, x) => {
    const n = createNode('wait', x, 0, 1)
    n.id = id
    n.title = `Kırmızı Suzanne · ${ms / 1000} sn`
    n.ms = ms
    return n
  }
  const clk = (id, title, prompt, x) => {
    const n = createNode('click', x, 0, 1)
    n.id = id
    n.title = title
    n.prompt = prompt
    return n
  }
  const key = createNode('key', 200, 0, 1)
  key.id = 'rs2-run'
  key.title = 'Blender · Çalıştır'
  key.keys = 'win+r'
  const w1 = w('rs2-w1', 900, 320)
  const type = createNode('type', 440, 0, 1)
  type.id = 'rs2-type'
  type.title = 'Blender · başlat komutunu yaz'
  type.text = '"C:\\Users\\ASUS TUF\\AppData\\Local\\Temp\\nubbo-blender-open.cmd"'
  type.pressEnter = true
  type.clearFirst = true
  const w2 = w('rs2-w2', 15000, 560)
  const add = clk('rs2-add', 'Menü · “Add”', 'Add', 680)
  const w3 = w('rs2-w3', 1200, 800)
  const mesh = clk('rs2-mesh', 'Menü · “Mesh”', 'Mesh', 920)
  const w4 = w('rs2-w4', 1200, 1040)
  const monkey = clk('rs2-monkey', 'Menü · “Monkey”', 'Monkey', 1160)
  const w5 = w('rs2-w5', 1500, 1280)
  const tab = clk(
    'rs2-tab',
    'Material Properties sekmesi',
    'Properties panel header: the Material tab icon (red-and-white sphere), right side of the header',
    1400
  )
  const w6 = w('rs2-w6', 1500, 1520)
  const neu = clk(
    'rs2-new',
    '“New” düğmesi (materyal paneli)',
    'the New button inside the Material properties panel: the button labelled exactly New that sits on the same row as the words Material Properties',
    1640
  )
  const w7 = w('rs2-w7', 1800, 1760)
  const swatch = clk(
    'rs2-swatch',
    'Base Color kutusu',
    'the colour swatch: the only colour patch in the row of the label Base Color, a short vertical rectangle immediately to the LEFT of that label',
    1880
  )
  const w8 = w('rs2-w8', 1500, 2000)
  const hex = clk('rs2-hex', 'Hex alanı', 'the Hex text field at the bottom of the colour picker dialog', 2120)
  const w9 = w('rs2-w9', 1200, 2240)
  const val = createNode('type', 2360, 0, 1)
  val.id = 'rs2-val'
  val.title = 'Kırmızı · FF0000 yaz'
  val.text = 'FF0000'
  val.pressEnter = true
  val.clearFirst = true
  const w10 = w('rs2-w10', 1500, 2480)
  const end = createNode('end', 2600, 0)
  end.id = 'rs2-end'
  const nodes = [start, key, w1, type, w2, add, w3, mesh, w4, monkey, w5, tab, w6, neu, w7, swatch, w8, hex, w9, val, w10, end]
  const edges = nodes.slice(0, -1).map((n, i) => ({ id: `rs2-e${i}`, from: n.id, fromPort: 'next', to: nodes[i + 1].id }))
  graph = { nodes, edges }
  canvasName = 'Kırmızı Suzanne'
  summary = 'Başlangıç → Blender aç → Add/Mesh/Monkey → Material sekmesi → New → Base Color → Hex → FF0000 (yalnız arayüz)'
} else if (mode === 'suzannered') {
  // Suzanne duruyor; simdi YALNIZ arayuzle kirmizi materyal: Material sekmesi -> New -> Base Color
  // -> renk secicinin Hex alanina FF0000. Simge/kutu oldugu icin gorsel basamak gosterir.
  const tab = createNode('click', 300, 0, 1)
  tab.id = 'sr-tab'
  tab.title = 'Kırmızı · Material Properties sekmesi'
  tab.prompt = 'Properties panel header: the Material tab icon (red-and-white sphere), right side of the header'
  const w1 = createNode('wait', 520, 0, 1)
  w1.id = 'sr-w1'
  w1.title = 'Kırmızı · 1,5 sn'
  w1.ms = 1500
  const neu = createNode('click', 740, 0, 1)
  neu.id = 'sr-new'
  neu.title = 'Kırmızı · “New” düğmesi'
  neu.prompt = 'the New button inside the Material properties panel: the button labelled exactly New that sits on the same row as the words Material Properties'
  const w2 = createNode('wait', 960, 0, 1)
  w2.id = 'sr-w2'
  w2.title = 'Kırmızı · 1,8 sn'
  w2.ms = 1800
  const swatch = createNode('click', 1180, 0, 1)
  swatch.id = 'sr-swatch'
  swatch.title = 'Kırmızı · Base Color kutusu'
  swatch.prompt = 'the colour swatch: the only colour patch in the row of the label Base Color, a short vertical rectangle immediately to the LEFT of that label in the Material properties panel'
  const w3 = createNode('wait', 1400, 0, 1)
  w3.id = 'sr-w3'
  w3.title = 'Kırmızı · 1,5 sn'
  w3.ms = 1500
  const hex = createNode('click', 1620, 0, 1)
  hex.id = 'sr-hex'
  hex.title = 'Kırmızı · Hex alanı'
  hex.prompt = 'the Hex text field at the bottom of the colour picker dialog, the field that shows a hex colour value'
  const w4 = createNode('wait', 1840, 0, 1)
  w4.id = 'sr-w4'
  w4.title = 'Kırmızı · 1,2 sn'
  w4.ms = 1200
  const type = createNode('type', 2060, 0, 1)
  type.id = 'sr-type'
  type.title = 'Kırmızı · FF0000 yaz'
  type.text = 'FF0000'
  type.pressEnter = true
  type.clearFirst = true
  const w5 = createNode('wait', 2280, 0, 1)
  w5.id = 'sr-w5'
  w5.title = 'Kırmızı · 1,5 sn'
  w5.ms = 1500
  const end = createNode('end', 2500, 0)
  end.id = 'sr-end'
  graph = {
    nodes: [start, tab, w1, neu, w2, swatch, w3, hex, w4, type, w5, end],
    edges: [
      { id: 'sr-e1', from: start.id, fromPort: 'next', to: tab.id },
      { id: 'sr-e2', from: tab.id, fromPort: 'next', to: w1.id },
      { id: 'sr-e3', from: w1.id, fromPort: 'next', to: neu.id },
      { id: 'sr-e4', from: neu.id, fromPort: 'next', to: w2.id },
      { id: 'sr-e5', from: w2.id, fromPort: 'next', to: swatch.id },
      { id: 'sr-e6', from: swatch.id, fromPort: 'next', to: w3.id },
      { id: 'sr-e7', from: w3.id, fromPort: 'next', to: hex.id },
      { id: 'sr-e8', from: hex.id, fromPort: 'next', to: w4.id },
      { id: 'sr-e9', from: w4.id, fromPort: 'next', to: type.id },
      { id: 'sr-e10', from: type.id, fromPort: 'next', to: w5.id },
      { id: 'sr-e11', from: w5.id, fromPort: 'next', to: end.id },
    ],
  }
  canvasName = 'Suzanne kırmızı'
  summary = 'Başlangıç → tıkla(Material sekmesi) → tıkla(“New”) → tıkla(Base Color) → tıkla(Hex) → yaz(FF0000 + Enter) → Bitir (yalnız arayüz)'
} else if (mode === 'suzanne') {
  // YALNIZ insan arayuzu: Blender zaten acik. Ust menuden Add -> Mesh -> Monkey secilir.
  // Betik yok, Python yok, kisayol yok: ekrandaki yaziyi okuyup tiklamak.
  const addMenu = createNode('click', 300, 0, 1)
  addMenu.id = 'sz-add'
  addMenu.title = 'Suzanne · üst menüden “Add”'
  addMenu.prompt = 'Add'
  const w1 = createNode('wait', 520, 0, 1)
  w1.id = 'sz-w1'
  w1.title = 'Suzanne · 1,2 sn (menü)'
  w1.ms = 1200
  const mesh = createNode('click', 740, 0, 1)
  mesh.id = 'sz-mesh'
  mesh.title = 'Suzanne · “Mesh”'
  mesh.prompt = 'Mesh'
  const w2 = createNode('wait', 960, 0, 1)
  w2.id = 'sz-w2'
  w2.title = 'Suzanne · 1,2 sn (alt menü)'
  w2.ms = 1200
  const monkey = createNode('click', 1180, 0, 1)
  monkey.id = 'sz-monkey'
  monkey.title = 'Suzanne · “Monkey”'
  monkey.prompt = 'Monkey'
  const w3 = createNode('wait', 1400, 0, 1)
  w3.id = 'sz-w3'
  w3.title = 'Suzanne · 1,5 sn'
  w3.ms = 1500
  const end = createNode('end', 1620, 0)
  end.id = 'sz-end'
  graph = {
    nodes: [start, addMenu, w1, mesh, w2, monkey, w3, end],
    edges: [
      { id: 'sz-e1', from: start.id, fromPort: 'next', to: addMenu.id },
      { id: 'sz-e2', from: addMenu.id, fromPort: 'next', to: w1.id },
      { id: 'sz-e3', from: w1.id, fromPort: 'next', to: mesh.id },
      { id: 'sz-e4', from: mesh.id, fromPort: 'next', to: w2.id },
      { id: 'sz-e5', from: w2.id, fromPort: 'next', to: monkey.id },
      { id: 'sz-e6', from: monkey.id, fromPort: 'next', to: w3.id },
      { id: 'sz-e7', from: w3.id, fromPort: 'next', to: end.id },
    ],
  }
  canvasName = 'Suzanne arayüz'
  summary = 'Başlangıç → tıkla(“Add”) → tıkla(“Mesh”) → tıkla(“Monkey”) → Bitir (yalnız arayüz, betik yok)'
} else if (mode === 'blenderui') {
  // Gercek arayuz isi: Blender acilir, sonra ARAYUZ menusunden maymun konur. Betik yok: motor
  // ekrandaki yaziyi okuyup (OCR) ve gerekirse gorsel modelle menuyu bulup tiklar.
  const key = createNode('key', 320, 0, 1)
  key.id = 'bui-run'
  key.title = 'Blender · Çalıştır penceresi'
  key.keys = 'win+r'
  const w1 = createNode('wait', 520, 0, 1)
  w1.id = 'bui-w1'
  w1.title = 'Blender · 0,9 sn'
  w1.ms = 900
  const type = createNode('type', 720, 0, 1)
  type.id = 'bui-type'
  type.title = 'Blender · başlat komutunu yaz'
  type.text = '"C:\\Users\\ASUS TUF\\AppData\\Local\\Temp\\nubbo-blender-open.cmd"'
  type.pressEnter = true
  type.clearFirst = true
  const w2 = createNode('wait', 920, 0, 1)
  w2.id = 'bui-w2'
  w2.title = 'Blender · 15 sn (açılış)'
  w2.ms = 15000
  // Add menusu: kisayol yerine TIKLAMA. Kisayol, "onde baska program var" korumasina takiliyor
  // (uygulamayi acip sonra ona kisayol gondermek bugun ifade edilemiyor); tiklamalar koordinata
  // gider ve arayuzu gercek bir insan gibi kullanir.
  const addMenu = createNode('click', 1120, 0, 1)
  addMenu.id = 'bui-add'
  addMenu.title = 'Blender · üst menüden “Add”'
  addMenu.prompt = 'Add'
  const menu = addMenu
  const w3 = createNode('wait', 1300, 0, 1)
  w3.id = 'bui-w3'
  w3.title = 'Blender · 1,2 sn (menü çizilsin)'
  w3.ms = 1200
  const mesh = createNode('click', 1500, 0, 1)
  mesh.id = 'bui-mesh'
  mesh.title = 'Blender · menüden “Mesh”'
  mesh.prompt = 'Mesh'
  const w4 = createNode('wait', 1700, 0, 1)
  w4.id = 'bui-w4'
  w4.title = 'Blender · 1,2 sn (alt menü)'
  w4.ms = 1200
  const monkey = createNode('click', 1900, 0, 1)
  monkey.id = 'bui-monkey'
  monkey.title = 'Blender · menüden “Monkey”'
  monkey.prompt = 'Monkey'
  const w5 = createNode('wait', 2100, 0, 1)
  w5.id = 'bui-w5'
  w5.title = 'Blender · 1,5 sn'
  w5.ms = 1500
  const end = createNode('end', 2300, 0)
  end.id = 'bui-end'
  graph = {
    nodes: [start, key, w1, type, w2, menu, w3, mesh, w4, monkey, w5, end],
    edges: [
      { id: 'bui-e1', from: start.id, fromPort: 'next', to: key.id },
      { id: 'bui-e2', from: key.id, fromPort: 'next', to: w1.id },
      { id: 'bui-e3', from: w1.id, fromPort: 'next', to: type.id },
      { id: 'bui-e4', from: type.id, fromPort: 'next', to: w2.id },
      { id: 'bui-e5', from: w2.id, fromPort: 'next', to: menu.id },
      { id: 'bui-e6', from: menu.id, fromPort: 'next', to: w3.id },      { id: 'bui-e7', from: w3.id, fromPort: 'next', to: mesh.id },
      { id: 'bui-e8', from: mesh.id, fromPort: 'next', to: w4.id },
      { id: 'bui-e9', from: w4.id, fromPort: 'next', to: monkey.id },
      { id: 'bui-e10', from: monkey.id, fromPort: 'next', to: w5.id },
      { id: 'bui-e11', from: w5.id, fromPort: 'next', to: end.id },
    ],
  }
  canvasName = 'Blender arayüz'
  summary = 'Başlangıç → win+r → yaz(blender aç) → 15 sn → tıkla(“Add”) → tıkla(“Mesh”) → tıkla(“Monkey”) → Bitir'
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
