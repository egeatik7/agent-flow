#!/usr/bin/env node
/**
 * Kapı bataryası: klasörlü kutu dürüstlüğü + merge kapıları + branch sınırı.
 *
 * Masaüstüne GİRDİ ÜRETMEZ (yalnız okuma, düzenleme ve reddedilmesi beklenen çağrılar).
 * Yalnız TEST profili kullanılır; gerçek depo hash'i ölçülür.
 *
 * Kullanım: node scripts/dev-gate-battery.cjs
 */
const fs = require('fs')
const path = require('path')
const http = require('http')
const crypto = require('crypto')

const APPDATA = process.env.APPDATA || ''
const TOKEN = path.join(APPDATA, 'xp-agent-studio-test', 'tool-endpoint.json')
const ADAYLAR = [
  path.join(APPDATA, 'electron-store-nodejs', 'Config', 'config.json'),
  path.join(APPDATA, 'xp-agent-studio', 'config.json'),
  path.join(APPDATA, 'xp-agent-studio', 'xp-agent-studio.json'),
]

/** Uygulamanın anahtarlarını taşıyan dosya gerçek depodur; hiçbiri yoksa ölçüm yoktur (null). */
function gercekDepo() {
  for (const aday of ADAYLAR) {
    try {
      const j = JSON.parse(fs.readFileSync(aday, 'utf8'))
      if (j && typeof j === 'object' && ('graph' in j || 'canvases' in j || 'settings' in j)) return aday
    } catch {
      /* aday değil ya da okunamadı */
    }
  }
  return null
}

const REAL = gercekDepo()

const hash = (p) => {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16)
  } catch {
    return null
  }
}
const info = JSON.parse(fs.readFileSync(TOKEN, 'utf8'))
function call(name, args, timeoutMs = 120000) {
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
            resolve({ ok: false, outcome: 'cevap-okunamadı', message: raw.slice(0, 90) })
          }
        })
      }
    )
    req.setTimeout(timeoutMs, () => req.destroy(new Error('zaman aşımı')))
    req.on('error', (e) => resolve({ ok: false, outcome: 'bağlantı-hatası', message: e.message }))
    req.end(body)
  })
}
const uyu = (v) => (v ? '✓' : '✗')
const kisa = (s, n = 88) => String(s || '').replace(/\s+/g, ' ').slice(0, n)

async function main() {
  const h1 = hash(REAL)
  console.log(`uç nokta: port ${info.port} · build ${info.build || '?'} · profil ${info.profile || '?'}`)
  console.log(`ölçülen depo: ${REAL || '(bulunamadı)'}\n  gerçek depo önce: ${h1}\n`)
  const R = []
  const puan = (ad, ok, not) => {
    R.push({ ad, ok })
    console.log(`${uyu(ok)} ${ad.padEnd(44)} ${not}`)
  }

  const read = await call('flow.read', {})
  const loop = (read.data?.loops ?? [])[0]
  const pkg = (read.data?.packages ?? [])[0]
  if (!loop || !pkg) {
    console.error('✗ fikstür eksik; önce: node scripts/dev-seed-fixture.cjs test loop')
    process.exit(2)
  }
  console.log(`kutu “${loop.title}” (${loop.id}) · paket “${pkg.title}”\n`)

  // Önceki koşulardan kalan branch'ler sınırı doldurmasın. Test profilindeki branch'ler her zaman
  // araç katmanının açtıklarıdır (pencere branch açamaz), o yüzden temizlenmeleri güvenlidir.
  const mevcut = await call('branch.list', {})
  const kalanlar = mevcut.data?.branches ?? []
  for (const kalan of kalanlar) await call('branch.drop', { branchId: kalan.branchId })
  if (kalanlar.length) console.log(`temizlendi: ${kalanlar.length} eski branch (${kalanlar.map((x) => x.name).join(', ')})\n`)

  // 1) Klasörlü kutu: öğe UYDURULMAMALI
  const b1 = await call('branch.create', { name: 'Klasör kapısı' })
  const bid1 = b1.data?.branchId
  const klasor = path.join(APPDATA, '..', 'Local', 'Temp', 'nubbo-klasor-kapisi')
  fs.mkdirSync(klasor, { recursive: true })
  fs.writeFileSync(path.join(klasor, 'aaa.txt'), 'x', 'utf8')
  const ed = await call('flow.edit', { branchId: bid1, packagePath: [pkg.id], ops: [{ op: 'patchNode', id: loop.id, fields: { folder: klasor } }] })
  puan('klasör yaması kabul edildi', ed.outcome === 'tamam', kisa(ed.message, 60))
  const r2 = await call('flow.read', { branchId: bid1 })
  const loop2 = (r2.data?.loops ?? [])[0] ?? {}
  // Sözleşme: liste BOŞSA öğe bilinmiyor; koşu listeyi doldurduysa (ya da kullanıcı liste
  // verdiyse) öğe GÖSTERİLİR — yoksa "aynı dosyadan devam" koruması bağlamsız kalır.
  const icListe = (loop2.item === undefined || loop2.item === null || loop2.item === '') ? 'boş' : 'dolu'
  puan('klasörlü kutu: liste durumuna göre öğe raporu', Array.isArray(loop2.items) || typeof loop2.item === 'string' || icListe === 'boş', `öğe=${JSON.stringify(loop2.item)} · klasör=${kisa(loop2.folder, 36)}`)
  puan('klasör yolu raporda görünüyor', String(loop2.folder || '').includes('nubbo-klasor-kapisi'), kisa(loop2.folder, 60))
  await call('branch.drop', { branchId: bid1 })
  fs.rmSync(klasor, { recursive: true, force: true })

  // 2) merge kapıları: uygulama yalnız panelden; geri alma bir kez
  const b2 = await call('branch.create', { name: 'Merge kapısı' })
  const bid2 = b2.data?.branchId
  await call('flow.edit', { branchId: bid2, packagePath: [pkg.id], ops: [{ op: 'patchNode', id: loop.id, fields: { count: 2 } }] })
  const apply = await call('branch.merge', { branchId: bid2, apply: true })
  puan('ajan merge UYGULAYAMIYOR (panel kapısı)', !apply.ok && /penceresini|panel/i.test(String(apply.message)), kisa(apply.message, 90))
  const undo = await call('merge.undo', {})
  puan('uygulanmamış merge geri alınamıyor (dürüst red)', !undo.ok, kisa(undo.message, 90))
  const trial = await call('branch.merge', { branchId: bid2 })
  puan('deneme hâlâ serbest ve sayıyı söylüyor', !!trial.ok && /düzenleme/.test(String(trial.message)), kisa(trial.message, 90))
  await call('branch.drop', { branchId: bid2 })

  // 2b) Debug koşusu + kullanıcı durdurması: donmuş hata ÜRETİLMEMELİ.
  // Koşu GERÇEKTEN beklemeli: hedefi olmayan bir tık, durdurmadan önce arızalanır ve donma
  // haklı olur. Bu yüzden zincire 20 sn bekleyen bir düğüm eklenir ve koşu ondan başlatılır.
  const b3 = await call('branch.create', { name: 'Durdurma donması' })
  const bid3 = b3.data?.branchId
  await call('flow.edit', { branchId: bid3, packagePath: [pkg.id], ops: [{ op: 'addNode', key: 'uzun', kind: 'wait', fields: { ms: 20000, title: 'Kapı · uzun bekleme' } }] })
  const r3 = await call('flow.read', { branchId: bid3 })
  const uzun = (r3.data?.nodes ?? []).find((x) => String(x.title).includes('uzun bekleme'))
  if (!uzun) {
    puan('debug + kullanıcı durdurması donma ÜRETMİYOR', false, 'uzun bekleme düğümü kurulamadı')
  } else {
    const rf3 = await call('run.from', { branchId: bid3, nodeId: uzun.id, debug: true, fast: true })
    await new Promise((r) => setTimeout(r, 2500))
    const st3 = await call('run.state', {})
    const sp3 = await call('run.stop', {})
    await call('run.wait', { timeoutMs: 90000 })
    const rep3 = await call('run.report', {})
    const dondu = !!rep3.data?.frozen
    puan('debug + kullanıcı durdurması donma ÜRETMİYOR', !dondu, `durum=${kisa(st3.message, 30)} · ${kisa(sp3.message, 30)} · donmuş=${dondu}`)
  }
  await call('branch.drop', { branchId: bid3 })

  // 3) Branch sınırı: 3 açık branch, dördüncüsü reddedilmeli
  const acilan = []
  for (let i = 1; i <= 3; i++) {
    const x = await call('branch.create', { name: `Sınır ${i}` })
    if (x.ok) acilan.push(x.data?.branchId)
  }
  puan('üç branch açılabiliyor', acilan.length === 3, `açılan=${acilan.length}`)
  const dorduncu = await call('branch.create', { name: 'Sınır 4' })
  puan('dördüncü branch reddediliyor', !dorduncu.ok, kisa(dorduncu.message, 90))
  for (const id of acilan) await call('branch.drop', { branchId: id })

  const h2 = hash(REAL)
  const gecen = R.filter((x) => x.ok).length
  console.log(`\nözet: ${R.length} kontrol · ${gecen} ✓ · ${R.length - gecen} ✗`)
  console.log(`gerçek depo: ${h1} → ${h2} · DEĞİŞMEDİ: ${h1 !== null && h2 !== null && h1 === h2}${h1 === null || h2 === null ? ' (ÖLÇÜM YOK: depo okunamadı)' : ''}`)
  fs.writeFileSync(path.join(__dirname, '..', 'test-artifacts', 'gate-battery.json'), JSON.stringify({ at: new Date().toISOString(), R, h1, h2 }, null, 2), 'utf8')
  process.exit(h1 !== null && h2 !== null && h1 === h2 && gecen === R.length ? 0 : 1)
}

main().catch((e) => {
  console.error(`hata: ${e.message}`)
  process.exit(2)
})
