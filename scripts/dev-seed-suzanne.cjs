#!/usr/bin/env node
/**
 * Kırmızı Suzanne — DURUM FARKINDAKİ akış (yalnız insan arayüzü).
 *
 * Neden yeniden yazıldı: ilk akış "Add"e basıp menünün açıldığını VARSAYIYORDU. Blender ilk
 * açılışta splash ekranı gösterir; splash açıkken yapılan tıklama splash'i kapatır, menü açılmaz.
 * Ayrıca menü zaten açıkken tekrar "Add"e basmak menüyü KAPATIR (ölçüldü). Bu yüzden akış:
 *
 *   1) Önce zararsız ve YİNELEMESİZ bir tıklama ile (Layout sekmesi) splash'i kapatır.
 *   2) Menü çubuğu ("File") görünene kadar BEKLER — splash'te bu yazı yoktur.
 *   3) "Add"e bastıktan sonra menünün gerçekten açıldığını DOĞRULAR ("Metaball" yalnız o menüde).
 *      Açılmadıysa bir kez daha dener, sonra yine de devam eder (koşu kendi sonucunu dürüstçe söyler).
 *   4) "Mesh" alt menüsünü de aynı şekilde doğrular ("Monkey" yalnız o alt menüde).
 *   5) Suzanne'in gerçekten eklendiğini Outliner'daki "Suzanne" yazısıyla doğrular.
 *
 * Kullanım: node scripts/dev-seed-suzanne.cjs test
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

const profil = process.argv[2] || 'test'
const APPDATA = process.env.APPDATA || ''
const storeFile = path.join(APPDATA, `xp-agent-studio-${profil}`, 'config.json')

let seq = 0
const id = (s) => `${s}-${++seq}`
const bos = (kind, x, y, title) => {
  const n = {
    id: id(kind),
    kind,
    x,
    y,
    title,
    prompt: '',
    text: '',
    keys: '',
    ms: 0,
    count: 1,
    timeoutMs: 0,
    pressEnter: false,
    clearFirst: false,
    clickMode: 'single',
    folder: '',
    items: [],
    url: '',
  }
  if (title) n.title = title
  return n
}
const bekle = (ms, x, title) => {
  const n = bos('wait', x, 0, title || `${ms / 1000} sn bekle`)
  n.ms = ms
  return n
}
const tikla = (hedef, x, title) => {
  const n = bos('click', x, 0, title || `Tıkla: ${hedef}`)
  n.prompt = hedef
  return n
}
const kosul = (aranan, ms, x, title) => {
  const n = bos('condition', x, 0, title || `Koşul: “${aranan}” göründü mü`)
  // ÖLÇÜLDÜ (motor günlüğü + runner.ts): koşul yazıyı `text` alanından, bekleme süresini
  // `timeoutMs` alanından okur. Taslakta bunlar `prompt`/`wait` yazılmıştı ve motor
  // "koşul için yazı gir" diyerek durdu — tek onarım bu iki alan.
  n.text = aranan
  n.timeoutMs = ms
  return n
}
const e = (from, fromPort, to) => ({ id: `rs-${from.id}-${fromPort}-${to.id}`, from: from.id, fromPort, to: to.id })

const start = bos('start', 0, 0, 'Başlangıç')
const run = bos('key', 120, 0, 'Windows Çalıştır')
run.keys = 'win+r'
const w1 = bekle(900, 240)
const BlenderAc = bos('type', 360, 0, 'Blender aç')
BlenderAc.text = '"C:\\Users\\ASUS TUF\\AppData\\Local\\Temp\\nubbo-blender-open.cmd"'
BlenderAc.pressEnter = true
BlenderAc.clearFirst = true
const w2 = bekle(12000, 480, 'Blender açılışı için bekle')

// 1) splash'i kapat: Layout sekmesi zararsız ve yinelenebilir
const splash = tikla('Layout', 600, 'Splash kapat (Layout)')
const w3 = bekle(1500, 720)

// 2) gerçek arayüz gelene kadar bekle: menü çubuğu
const hazir = kosul('File', 30000, 840, 'Arayüz hazır mı (“File”)')
const w4 = bekle(1000, 960)
const add = tikla('Add', 1080, 'Menü · “Add”')

// 3) menü açıldı mı? yalnız Add menüsünde olan yazıyla doğrula
const menu1 = kosul('Metaball', 4000, 1200, 'Add menüsü açıldı mı (“Metaball”)')
const add2 = tikla('Add', 1320, 'Menü · “Add” (ikinci deneme)')
const w5 = bekle(1200, 1440)
const menu2 = kosul('Metaball', 4000, 1560, 'Menü açıldı mı (2. deneme)')
const w6 = bekle(2000, 1680)

// 4) Mesh → Monkey (alt menü de doğrulanır)
const mesh = tikla('Mesh', 1800, 'Menü · “Mesh”')
const sub1 = kosul('Monkey', 4000, 1920, 'Alt menü açıldı mı (“Monkey”)')
const mesh2 = tikla('Mesh', 2040, 'Menü · “Mesh” (ikinci deneme)')
const w7 = bekle(1500, 2160)
const monkey = tikla('Monkey', 2280, 'Menü · “Monkey”')
const w8 = bekle(2000, 2400)

// 5) gerçekten eklendi mi? Outliner'da nesne adı görünür
const eklendi = kosul('Suzanne', 8000, 2520, 'Suzanne eklendi mi (Outliner)')
const w9 = bekle(1200, 2640)

// 6) malzeme: Material sekmesi → New → Base Color → Hex → FF0000 (yalnız arayüz)
const tab = tikla(
  'the Material tab icon (red-and-white sphere) at the right side of the Properties header',
  2760,
  'Material Properties sekmesi'
)
const w10 = bekle(1500, 2880)
const yeni = tikla('New', 3000, '“New” düğmesi (materyal paneli)')
const w11 = bekle(1800, 3120)
const kutu = tikla('the colour swatch immediately to the LEFT of the label Base Color', 3240, 'Base Color kutusu')
const w12 = bekle(1500, 3360)
const hex = tikla('the Hex text field at the bottom of the colour picker dialog', 3480, 'Hex alanı')
const w13 = bekle(1200, 3600)
const kirmizi = bos('type', 3720, 0, 'Kırmızı · FF0000')
kirmizi.text = 'FF0000'
kirmizi.pressEnter = true
kirmizi.clearFirst = true
const w14 = bekle(1500, 3840)
const bitti = bos('end', 3960, 0, 'Bitir')

const nodes = [
  start,
  run,
  w1,
  BlenderAc,
  w2,
  splash,
  w3,
  hazir,
  w4,
  add,
  menu1,
  add2,
  w5,
  menu2,
  w6,
  mesh,
  sub1,
  mesh2,
  w7,
  monkey,
  w8,
  eklendi,
  w9,
  tab,
  w10,
  yeni,
  w11,
  kutu,
  w12,
  hex,
  w13,
  kirmizi,
  w14,
  bitti,
]

const edges = [
  e(start, 'next', run),
  e(run, 'next', w1),
  e(w1, 'next', BlenderAc),
  e(BlenderAc, 'next', w2),
  e(w2, 'next', splash),
  e(splash, 'next', w3),
  e(w3, 'next', hazir),
  // Arayüz hazırsa doğrudan Add'e; değilse bir kez daha zararsız tıklama + kısa bekleme
  { id: 'rs-hazir-var', from: hazir.id, fromPort: 'true', to: add.id },
  { id: 'rs-hazir-yok', from: hazir.id, fromPort: 'false', to: splash.id },
  e(add, 'next', menu1),
  // Menü açıldıysa Mesh'e; açılmadıysa bir kez daha Add
  { id: 'rs-menu1-var', from: menu1.id, fromPort: 'true', to: mesh.id },
  { id: 'rs-menu1-yok', from: menu1.id, fromPort: 'false', to: add2.id },
  e(add2, 'next', w5),
  e(w5, 'next', menu2),
  { id: 'rs-menu2-var', from: menu2.id, fromPort: 'true', to: mesh.id },
  { id: 'rs-menu2-yok', from: menu2.id, fromPort: 'false', to: w6.id },
  e(w6, 'next', mesh),
  // Alt menü doğrulaması
  e(mesh, 'next', sub1),
  { id: 'rs-sub-var', from: sub1.id, fromPort: 'true', to: monkey.id },
  { id: 'rs-sub-yok', from: sub1.id, fromPort: 'false', to: mesh2.id },
  e(mesh2, 'next', w7),
  e(w7, 'next', monkey),
  e(monkey, 'next', w8),
  e(w8, 'next', eklendi),
  // Suzanne eklendiyse malzemeye geç; eklenmediyse de malzemeyi denemek yerine bitir (dürüst sonuç)
  { id: 'rs-eklendi-var', from: eklendi.id, fromPort: 'true', to: w9.id },
  { id: 'rs-eklendi-yok', from: eklendi.id, fromPort: 'false', to: bitti.id },
  e(w9, 'next', tab),
  e(tab, 'next', w10),
  e(w10, 'next', yeni),
  e(yeni, 'next', w11),
  e(w11, 'next', kutu),
  e(kutu, 'next', w12),
  e(w12, 'next', hex),
  e(hex, 'next', w13),
  e(w13, 'next', kirmizi),
  e(kirmizi, 'next', w14),
  e(w14, 'next', bitti),
]

const graph = { nodes, edges }

// Açılış komutu: Blender'ı başlatır (akış bunu Windows Çalıştır ile çalıştırır)
const cmd = path.join(os.tmpdir(), 'nubbo-blender-open.cmd')
if (!fs.existsSync(cmd)) {
  fs.writeFileSync(cmd, '@echo off\r\nstart "" "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe"\r\n', 'utf8')
  console.log(`  açılış komutu yazıldı: ${cmd}`)
} else {
  console.log(`  açılış komutu var: ${cmd}`)
}

let store = { settings: {}, canvases: null }
if (fs.existsSync(storeFile)) {
  try {
    store = JSON.parse(fs.readFileSync(storeFile, 'utf8'))
  } catch {
    /* boş başla */
  }
}
const book = {
  activeId: 'fixture-canvas',
  tabs: [{ id: 'fixture-canvas', name: 'Kırmızı Suzanne (durum farkında)', graph }],
  branches: store.canvases?.branches ?? [],
}
store.canvases = book
store.graph = graph
fs.writeFileSync(storeFile, JSON.stringify(store, null, 2), 'utf8')
console.log(`  akış yazıldı: ${storeFile}`)
console.log(`  ${nodes.length} düğüm · ${edges.length} bağlantı`)
console.log('  sıra: splash kapat → “File” bekle → Add → “Metaball” doğrula → Mesh → “Monkey” doğrula → Monkey → “Suzanne” doğrula → Material → New → Base Color → Hex → FF0000')
