#!/usr/bin/env node
/**
 * Devam bataryası: iç içe kutu bağlamı + "aynı öğeden devam" kimlik kontrolü.
 *
 * Masaüstüne GİRDİ ÜRETMEZ: koşu, hedefi var olmayan bir tık düğümünden başlar; tık, hedefi
 * bulamadan başarısız olur. Yalnız TEST profili kullanılır; gerçek depo hash'i ölçülür.
 *
 * Kullanım: node scripts/dev-resume-battery.cjs
 */
const fs = require('fs')
const path = require('path')
const http = require('http')
const crypto = require('crypto')

const APPDATA = process.env.APPDATA || ''
const TOKEN = path.join(APPDATA, 'xp-agent-studio-test', 'tool-endpoint.json')
const REAL = path.join(APPDATA, 'electron-store-nodejs', 'Config', 'config.json')
const hash = (p) => {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16)
  } catch {
    return '(yok)'
  }
}
const info = JSON.parse(fs.readFileSync(TOKEN, 'utf8'))
function call(name, args, timeoutMs = 180000) {
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
const kisa = (s, n = 84) => String(s || '').replace(/\s+/g, ' ').slice(0, n)

async function main() {
  const h1 = hash(REAL)
  console.log(`uç nokta: port ${info.port} · build ${info.build || '?'} · profil ${info.profile || '?'}`)
  console.log(`gerçek depo önce: ${h1}\n`)
  const R = []
  const puan = (ad, ok, not) => {
    R.push({ ad, ok })
    console.log(`${uyu(ok)} ${ad.padEnd(42)} ${not}`)
  }

  // 0) İç içe kutu bağlamı: kutu → paket → iç düğüm
  const read = await call('flow.read', {})
  const loops = read.data?.loops ?? []
  const pkgs = read.data?.packages ?? []
  puan('kutu ve paket birlikte var (iç içe)', loops.length >= 1 && pkgs.length >= 1, `kutu=${loops.length} · paket=${pkgs.length}`)
  const misal = (read.data?.nodes ?? []).find((n) => String(n.title || '').includes('bulunmayan')) || (read.data?.nodes ?? []).find((n) => n.kind === 'click' && (n.packagePath || []).length)
  const icNode = misal?.id
  if (icNode) {
    const cx = await call('flow.context', { nodeId: icNode })
    const yol = cx.data?.packagePath ?? []
    const zincir = (cx.data?.loops ?? []).map((l) => l.title || l.id)
    puan('iç düğümün bağlamı kutu + paket olarak okunuyor', yol.length >= 1 && zincir.length >= 1, `paket yolu=${JSON.stringify(yol)} · kutular=${JSON.stringify(zincir)}`)
  } else {
    puan('iç düğümün bağlamı kutu + paket olarak okunuyor', false, 'iç düğüm bulunamadı')
  }

  // 1) Hedefi olmayan tık düğümünden debug koşu → donma (girdi yok)
  const hedef = icNode || (read.data?.nodes ?? []).find((n) => n.kind === 'click')?.id
  if (!hedef) {
    console.error('✗ tık düğümü yok; fikstür: node scripts/dev-seed-fixture.cjs test loop')
    process.exit(2)
  }
  const rf = await call('run.from', { nodeId: hedef, debug: true, fast: true })
  puan('debug koşu başladı (donma beklenir)', !!rf.ok, kisa(rf.message, 60))
  await call('run.wait', { timeoutMs: 120000 })
  const rep = await call('run.report', {})
  const frozen = rep.data?.frozen || null
  puan('donmuş rapor var', !!frozen, frozen ? `node “${frozen.nodeTitle}” · ${kisa(frozen.error, 46)}` : kisa(rep.message))
  const loop0 = frozen?.loops?.[0]
  puan('donma anında KUTU bağlamı kaydedildi', !!loop0, loop0 ? `kutu “${loop0.title}” · öğe ${(loop0.index ?? 0) + 1}/${loop0.total} (“${loop0.item}”)` : 'kutu bağlamı yok')

  // 2) Liste değişince devam REDDEDİLMELİ
  if (loop0 && loop0.item) {
    const b = await call('branch.create', { name: 'Devam sınaması' })
    const bid = b.data?.branchId
    const yeniListe = ['baska-dosya', ...(loop0.total > 1 ? ['ikinci'] : [])]
    const pkg = (read.data?.packages ?? [])[0]
    const ed = await call('flow.edit', { branchId: bid, packagePath: pkg ? [pkg.id] : [], ops: [{ op: 'patchNode', id: loop0.id, fields: { items: yeniListe } }] })
    puan('branch’te kutu listesi değiştirildi', ed.outcome === 'tamam', `${JSON.stringify(yeniListe)} · ${kisa(ed.message, 50)}`)
    const rs = await call('run.from', { branchId: bid, nodeId: hedef, resumeFromFailure: true, fast: true })
    const reddetti = !rs.ok && /Liste değişmiş/.test(String(rs.message))
    puan('liste değişmişse devam REDDEDİLİYOR', reddetti, kisa(rs.message, 90))
    if (rs.ok) await call('run.wait', { timeoutMs: 120000 })

    // 3) Liste eski hâline dönünce devam kabul edilmeli
    const un = await call('flow.undo', { branchId: bid })
    const rs2 = await call('run.from', { branchId: bid, nodeId: hedef, resumeFromFailure: true, fast: true })
    puan('liste geri gelince devam kabul ediliyor', !!rs2.ok, kisa(rs2.message, 100))
    if (rs2.ok) await call('run.wait', { timeoutMs: 120000 })
    void un
    await call('branch.drop', { branchId: bid })
  }

  const h2 = hash(REAL)
  const gecen = R.filter((x) => x.ok).length
  console.log(`\nözet: ${R.length} kontrol · ${gecen} ✓ · ${R.length - gecen} ✗`)
  console.log(`gerçek depo: ${h1} → ${h2} · DEĞİŞMEDİ: ${h1 === h2}`)
  fs.writeFileSync(path.join(__dirname, '..', 'test-artifacts', 'resume-battery.json'), JSON.stringify({ at: new Date().toISOString(), R, h1, h2 }, null, 2), 'utf8')
  process.exit(h1 === h2 && gecen === R.length ? 0 : 1)
}

main().catch((e) => {
  console.error(`hata: ${e.message}`)
  process.exit(2)
})
