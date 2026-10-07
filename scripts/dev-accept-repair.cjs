#!/usr/bin/env node
/**
 * KABUL TESTİ — iç içe döngülü, üç öğeli akış; hata İKİNCİ öğede.
 *
 * Akış (masaüstüne HİÇ girdi üretmez: yalnız beklemeler ve klasör okuma):
 *   Başlangıç → Dış kutu (3 öğe: var1, yok2, var3)
 *                 └ İç kutu (klasör = {{öğe}}) → [bekle]
 *
 * 1. öğe: klasör VAR → iç kutu dosyaları gezer, hata yok.
 * 2. öğe: klasör YOK   → kontrollü hata (klasör yok).
 * 3. öğe: klasör VAR   → (onarımdan sonra) çalışmalı.
 *
 * Bu betik: klasörleri kurar, akışı test profilinin deposuna yazar, örneği yeniden başlatır,
 * debug koşusunu yapar ve KANITI toplar (öğe başına motor günlüğü + resmî sonuç + donmuş rapor).
 *
 * Kullanım: node scripts/dev-accept-repair.cjs        (kur + koş)
 *           node scripts/dev-accept-repair.cjs seed   (yalnız kur)
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const http = require('http')
const { spawnSync } = require('child_process')

const APPDATA = process.env.APPDATA || ''
const storeFile = path.join(APPDATA, 'xp-agent-studio-test', 'config.json')
const TOKEN = path.join(APPDATA, 'xp-agent-studio-test', 'tool-endpoint.json')
const kok = path.join(os.tmpdir(), 'nubbo-kabul')
const var1 = path.join(kok, 'var1')
const yok2 = path.join(kok, 'yok2-boyle-klasor-yok')
const var3 = path.join(kok, 'var3')

function klasorleriKur() {
  fs.rmSync(kok, { recursive: true, force: true })
  for (const [d, adet] of [
    [var1, 2],
    [var3, 2],
  ]) {
    fs.mkdirSync(d, { recursive: true })
    for (let i = 1; i <= adet; i++) fs.writeFileSync(path.join(d, `dosya${i}.txt`), `içerik ${i}`, 'utf8')
  }
  console.log(`  klasörler kuruldu: ${var1} (2 dosya) · ${var3} (2 dosya) · yok: ${yok2}`)
}

let seq = 0
const bos = (kind, x, y, title) => {
  const n = {
    id: `${kind}-${++seq}`,
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
  return n
}

function akis() {
  seq = 0
  const start = bos('start', 0, 0, 'Başlangıç')
  const icBekle = bos('wait', 260, 120, 'İç · bekle 250 ms')
  icBekle.ms = 250
  const ic = bos('loop', 150, 90, 'İç kutu · dosyalar')
  ic.folder = '{{öğe}}'
  ic.members = [icBekle.id]
  const dis = bos('loop', 80, 40, 'Dış kutu · 3 klasör')
  dis.items = [var1, yok2, var3]
  dis.members = [ic.id]
  const end = bos('end', 400, 0, 'Bitir')
  const nodes = [start, dis, ic, icBekle, end]
  const edges = [
    { id: 'k-e1', from: start.id, fromPort: 'next', to: dis.id },
    { id: 'k-e2', from: dis.id, fromPort: 'done', to: end.id },
  ]
  return { graph: { nodes, edges }, dis, ic, icBekle }
}

function yaz(akisVerisi, ad) {
  let store = { settings: {}, canvases: null }
  if (fs.existsSync(storeFile)) {
    try {
      store = JSON.parse(fs.readFileSync(storeFile, 'utf8'))
    } catch {
      /* boş */
    }
  }
  const book = { activeId: 'kabul-canvas', tabs: [{ id: 'kabul-canvas', name: ad, graph: akisVerisi.graph }], branches: store.canvases?.branches ?? [] }
  store.canvases = book
  store.graph = akisVerisi.graph
  fs.writeFileSync(storeFile, JSON.stringify(store, null, 2), 'utf8')
  console.log(`  akış yazıldı: ${storeFile} · tuval “${ad}”`)
  console.log(`  düğümler: ${akisVerisi.graph.nodes.map((n) => n.title).join(' → ')}`)
}

function call(name, args, timeoutMs = 300000) {
  const info = JSON.parse(fs.readFileSync(TOKEN, 'utf8'))
  const body = JSON.stringify({ name, args: args || {} })
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: info.port, path: '/call', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: `Bearer ${info.token}` } },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw))
          } catch {
            resolve({ ok: false, message: raw.slice(0, 150) })
          }
        })
      }
    )
    req.setTimeout(timeoutMs, () => req.destroy(new Error('zaman aşımı')))
    req.on('error', (e) => resolve({ ok: false, message: e.message }))
    req.end(body)
  })
}
const kisa = (s, n = 400) => String(s || '').replace(/\s+/g, ' ').slice(0, n)

function sonGunluk(satirSayisi = 40) {
  const logDir = path.join(APPDATA, 'xp-agent-studio-test', 'logs')
  if (!fs.existsSync(logDir)) return []
  const vers = fs.readdirSync(logDir).sort().pop()
  if (!vers) return []
  const dosyalar = fs
    .readdirSync(path.join(logDir, vers))
    .map((x) => ({ x, t: fs.statSync(path.join(logDir, vers, x)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  if (!dosyalar[0]) return []
  const satirlar = fs.readFileSync(path.join(logDir, vers, dosyalar[0].x), 'utf8').split(/\r?\n/).filter(Boolean)
  return satirlar.slice(-satirSayisi)
}

async function main() {
  const yalnizKur = process.argv[2] === 'seed'
  klasorleriKur()
  const a = akis()
  yaz(a, 'Kabul · otomatik onarım')
  if (yalnizKur) return

  console.log('\n  örnek yeniden başlatılıyor (yeni akış belleğe gelsin)')
  const bas = spawnSync('node', [path.join(__dirname, 'dev-start-test.cjs'), 'test'], { encoding: 'utf8' })
  console.log(`  ${String(bas.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || ''}`)

  console.log('\n=== 1) İZLE: debug koşusu (hata olursa bağlamı koruyarak durur) ===')
  const r = await call('run.from', { fromStart: true, debug: true, fast: true })
  console.log(`  başlatma: ok=${r.ok} · ${kisa(r.message, 200)}`)
  const w = await call('run.wait', { timeoutMs: 180000 })
  console.log(`  SONUÇ: ${kisa(w.message, 600)}`)

  console.log('\n=== 2) İNCELE: donmuş rapor + öğe kayıtları ===')
  const rep = await call('run.report', {})
  const f = rep.data?.frozen
  if (f) {
    console.log(`  donmuş: koşu ${f.runId} · düğüm “${f.nodeTitle}” (${f.nodeId})`)
    console.log(`  hata: ${kisa(f.error, 220)}`)
    if (Array.isArray(f.loops) && f.loops.length) {
      for (const l of f.loops) console.log(`  kutu: “${l.title}” ${(l.index ?? 0) + 1}/${l.total ?? '?'}${l.item ? ` (“${String(l.item).split(/[\\/]/).pop()}”)` : ''}`)
    } else console.log('  kutu bağlamı: yok')
  } else console.log('  donmuş rapor yok')
  const durum = await call('run.state', {})
  console.log(`  durum: ${kisa(durum.message, 400)}`)

  console.log('\n=== 3) ÖĞE/DÜĞÜM KAYITLARI (motor günlüğü) ===')
  for (const s of sonGunluk(40)) {
    if (/—|bitti|hata|HATA|ERROR|klasör|öğe|tur|SINIR|durduruldu|Bitti/.test(s)) console.log(`   ${kisa(s, 150)}`)
  }
}
main().catch((e) => {
  console.error(`hata: ${e.message}`)
  process.exit(2)
})
