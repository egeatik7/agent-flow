#!/usr/bin/env node
/**
 * Paket içi batarya: paket içinde düzenleme → sınırlı bölge (ölçülen süre) → geri alma → temizlik.
 *
 * Masaüstüne GİRDİ ÜRETMEZ: zincir yalnız beklemelerden kurulur ve koşu paketin İÇİNDEKİ bir
 * düğümden başlar (tık/yaz yok). Yalnız TEST profili kullanılır; gerçek depo hash'i ölçülür.
 *
 * Kullanım: node scripts/dev-package-battery.cjs
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
function info() {
  const j = JSON.parse(fs.readFileSync(TOKEN, 'utf8'))
  if (j.profile && j.profile !== 'test') throw new Error(`jeton test profili değil: ${j.profile}`)
  return j
}
function call(inf, name, args, timeoutMs = 180000) {
  const body = JSON.stringify({ name, args: args || {} })
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: inf.port, path: '/call', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: `Bearer ${inf.token}` } },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw))
          } catch {
            resolve({ ok: false, outcome: 'cevap-okunamadı', message: raw.slice(0, 80) })
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
const kisa = (s, n = 80) => String(s || '').replace(/\s+/g, ' ').slice(0, n)

async function main() {
  const h1 = hash(REAL)
  const inf = info()
  console.log(`uç nokta: port ${inf.port} · build ${inf.build || '?'} · profil ${inf.profile || '?'}`)
  console.log(`ölçülen depo: ${REAL || '(bulunamadı)'}\n  gerçek depo önce: ${h1}\n`)
  const R = []
  const puan = (ad, ok, not) => {
    R.push({ ad, ok, not })
    console.log(`${uyu(ok)} ${ad.padEnd(40)} ${not}`)
  }

  const read0 = await call(inf, 'flow.read', {})
  const pkgs = read0.data?.packages ?? []
  const pkg = pkgs[0]
  console.log(`paket: ${pkg ? `${pkg.id} · “${pkg.title}”` : null}\n`)
  if (!pkg) {
    console.error('✗ fikstürde paket yok; önce: node scripts/dev-seed-fixture.cjs test package')
    process.exit(2)
  }

  const b = await call(inf, 'branch.create', { name: 'Paket bataryası' })
  const bid = String(b.data?.branchId)

  // 1) Paket İÇİNE üç bekleme ekle (sınır ötesi olan uzun)
  const ekle = async (key, ms, title, connectFrom) => {
    const op = connectFrom
      ? { op: 'addNode', key, kind: 'wait', fields: { ms, title }, connectFrom }
      : { op: 'addNode', key, kind: 'wait', fields: { ms, title } }
    const r = await call(inf, 'flow.edit', { branchId: bid, packagePath: [pkg.id], ops: [op] })
    return r
  }
  const e1 = await ekle('p1', 500, 'Paket · bekle 1 (500 ms)')
  puan('paket içine bekleme eklendi', e1.outcome === 'tamam', kisa(e1.message))
  const read1 = await call(inf, 'flow.read', { branchId: bid })
  const icNodes = (read1.data?.nodes ?? []).filter((n) => (n.packagePath || []).includes(pkg.id))
  const n1 = icNodes.find((n) => String(n.title).includes('bekle 1'))
  puan('paket içindeki yeni düğüm flow.read ile görünüyor', !!n1, n1 ? `${n1.id} · yol ${n1.packagePath.join(' › ')}` : `bulunamadı (${icNodes.length} iç düğüm)`)

  let n2 = null
  let n3 = null
  if (n1) {
    await ekle('p2', 300, 'Paket · bekle 2 (300 ms)', n1.id)
    const read2 = await call(inf, 'flow.read', { branchId: bid })
    n2 = (read2.data?.nodes ?? []).find((n) => String(n.title).includes('bekle 2'))
    if (n2) {
      await ekle('p3', 30000, 'Paket · bekle 3 (30 sn, sınır ötesi)', n2.id)
      const read3 = await call(inf, 'flow.read', { branchId: bid })
      n3 = (read3.data?.nodes ?? []).find((n) => String(n.title).includes('bekle 3'))
    }
  }
  puan('üçlü zincir paket içinde kuruldu', !!(n1 && n2 && n3), `${n1?.id || '?'} → ${n2?.id || '?'} → ${n3?.id || '?'}`)

  // 2) Sınırlı bölge: paket içinden başla, ikinci beklemede dur (süre ölçülür)
  if (n1 && n2) {
    const rf = await call(inf, 'run.from', { branchId: bid, nodeId: n1.id, untilNodeId: n2.id })
    puan('paket içinden koşu başladı', !!rf.ok, kisa(rf.message, 70))
    const w = await call(inf, 'run.wait', { timeoutMs: 120000 })
    const last = w.data?.last || {}
    const sure = last.endedAt && last.startedAt ? Math.round((last.endedAt - last.startedAt) / 1000) : null
    puan('sınırlı bölge durdu (until)', w.data?.stoppedBy === 'until', `stoppedBy=${w.data?.stoppedBy} · stopped=${last.stopped}`)
    // 0,5 + 0,3 ≈ 1 sn beklenir; 30 sn'lik sınır ötesi koşsaydı ~31 sn olurdu.
    puan('sınır ötesi 30 sn KOŞMADI', sure !== null && sure <= 8, sure === null ? 'süre okunamadı' : `süre ${sure}s (koşsaydı ~31s)`)
  }

  // 3) merge denemesi ile branch farkı aynı şeyi söylemeli
  const d = await call(inf, 'branch.diff', { branchId: bid })
  const m = await call(inf, 'branch.merge', { branchId: bid })
  const dSayi = (String(d.message).match(/(\d+) düzenleme/) || [])[1]
  const mSayi = (String(m.message).match(/(\d+) düzenleme/) || [])[1]
  puan('merge denemesi ile diff aynı sayıyı söylüyor', !!dSayi && dSayi === mSayi, `diff=${dSayi} · merge=${mSayi}`)

  // 4) Geri alma: son grup (30 sn'lik ekleme) geri alınınca düğüm kaybolmalı
  if (n3) {
    const un = await call(inf, 'flow.undo', { branchId: bid })
    const read4 = await call(inf, 'flow.read', { branchId: bid })
    const hala = (read4.data?.nodes ?? []).some((n) => String(n.title).includes('bekle 3'))
    puan('geri alma paket içi eklemeyi kaldırdı', un.outcome === 'tamam' && !hala, `undo=${un.outcome} · bekle 3 duruyor mu: ${hala}`)
  }
  // Kalan iki grubu da geri al → değişiklik sıfır olmalı
  await call(inf, 'flow.undo', { branchId: bid })
  await call(inf, 'flow.undo', { branchId: bid })
  const d2 = await call(inf, 'branch.diff', { branchId: bid })
  puan('tüm gruplar geri alınınca fark sıfır', /değişiklik yok/.test(String(d2.message)), kisa(d2.message))

  const drop = await call(inf, 'branch.drop', { branchId: bid })
  console.log(`\ntemizlik: ${kisa(drop.message, 70)}`)
  const h2 = hash(REAL)
  const gecen = R.filter((x) => x.ok).length
  console.log(`\nözet: ${R.length} kontrol · ${gecen} ✓ · ${R.length - gecen} ✗`)
  console.log(`gerçek depo: ${h1} → ${h2} · DEĞİŞMEDİ: ${h1 !== null && h2 !== null && h1 === h2}${h1 === null || h2 === null ? ' (ÖLÇÜM YOK: depo okunamadı)' : ''}`)
  fs.writeFileSync(path.join(__dirname, '..', 'test-artifacts', 'package-battery.json'), JSON.stringify({ at: new Date().toISOString(), R, h1, h2 }, null, 2), 'utf8')
  process.exit(h1 !== null && h2 !== null && h1 === h2 && gecen === R.length ? 0 : 1)
}

main().catch((e) => {
  console.error(`hata: ${e.message}`)
  process.exit(2)
})
