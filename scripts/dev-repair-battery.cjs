#!/usr/bin/env node
/**
 * Onarım bataryası: düzenleme yüzeyi + debug/donma/rapor/devam + sınırlı bölge.
 *
 * Masaüstüne GİRDİ ÜRETMEZ: koşular, hedefi var olmayan bir tık düğümüyle başlar (tık, hedefi
 * bulamadan başarısız olur) ve sınırlı bölge yalnız beklemelerden kurulur. Yalnız TEST profilinin
 * ucu kullanılır; gerçek deponun hash'i önce/sonra ölçülür.
 *
 * Kullanım: node scripts/dev-repair-battery.cjs
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
const kisa = (s, n = 78) => String(s || '').replace(/\s+/g, ' ').slice(0, n)
const uyu = (v) => (v ? '✓' : '✗')

async function main() {
  const h1 = hash(REAL)
  const inf = info()
  console.log(`uç nokta: port ${inf.port} · build ${inf.build || '?'} · profil ${inf.profile || '?'}`)
  console.log(`ölçülen depo: ${REAL || '(bulunamadı)'}\n  gerçek depo önce: ${h1}\n`)
  const R = []
  const step = async (ad, name, args, bekle) => {
    const r = await call(inf, name, args)
    const ok = bekle ? bekle(r) : !!r.ok
    R.push({ ad, name, ok, outcome: r.outcome, msg: kisa(r.message) })
    console.log(`${uyu(ok)} ${ad.padEnd(34)} ${String(r.outcome || '-').padEnd(15)} ${kisa(r.message)}`)
    return r
  }

  // 0) Tuvalleri ve branch'leri gör
  const read = await step('flow.read', 'flow.read', {})
  const bid = String((await call(inf, 'branch.create', { name: 'Onarım bataryası' })).data?.branchId)
  console.log(`\nbranch: ${bid}\n`)

  // 1) Düzenleme yüzeyi: serbest tık düğümü ekle (hedefi olmayan), sonra gerçek id'sini öğren
  const ekle = await step(
    'addNode click (özgür)',
    'flow.edit',
    { branchId: bid, ops: [{ op: 'addNode', key: 'bad', kind: 'click', fields: { prompt: 'YOK-BU-YAZI-ASLA-YOK', title: 'Batarya · olmayan hedef' } }] },
    (r) => r.outcome === 'tamam'
  )
  const branchRead = await call(inf, 'flow.read', { branchId: bid })
  const nodes = (branchRead.data && (branchRead.data.nodes || branchRead.data.allNodes)) || []
  const hedef = nodes.find((n) => String(n.title || '').includes('Batarya'))
  console.log(`  yeni düğüm: ${hedef ? `${hedef.id} · ${hedef.kind} · “${hedef.title}”` : '(bulunamadı)'}`)

  // 2) Yasaklar: Başlangıç ekleme ve hedef kanıtı alanı
  await step('addNode start (yasak)', 'flow.edit', { branchId: bid, ops: [{ op: 'addNode', key: 's', kind: 'start', fields: {} }] }, (r) => r.outcome === 'plan-gecersiz')
  await step('patchNode locator (yasak)', 'flow.edit', { branchId: bid, ops: [{ op: 'patchNode', id: hedef?.id, fields: { locator: { x: 1, y: 2 } } }] }, (r) => r.outcome === 'plan-gecersiz')
  await step('patchNode bilinmeyen id', 'flow.edit', { branchId: bid, ops: [{ op: 'patchNode', id: 'yok-boyle', fields: { ms: 5 } }] }, (r) => r.outcome === 'plan-gecersiz')

  // 3) Debug koşu: hedefi olmayan tık -> donma (girdi gönderilmez)
  if (hedef?.id) {
    const rf = await step('run.from debug (donma)', 'run.from', { branchId: bid, nodeId: hedef.id, debug: true, fast: true }, (r) => r.ok)
    await call(inf, 'run.wait', { timeoutMs: 120000 })
    const rep = await step('run.report (donmuş)', 'run.report', {}, (r) => !!(r.data && r.data.frozen))
    const f = rep.data?.frozen || {}
    console.log(`    donmuş: node “${f.nodeTitle}” · hata: ${kisa(f.error, 70)} · görüntü: ${f.shot ? 'var' : 'yok'}`)
    // 4) Aynı düğümden devam: donmuş hatanın öğesi yoksa dürüstçe söylemeli, uydurmamalı
    await step('run.from resume (aynı düğüm)', 'run.from', { branchId: bid, nodeId: hedef.id, resumeFromFailure: true, fast: true }, (r) => r.ok || /devam|Donmuş|öğe|hata/i.test(String(r.message)))
    await call(inf, 'run.wait', { timeoutMs: 120000 })
    void rf
  }

  // 5) Sınırlı bölge: yalnız beklemeler; sınırdan sonraki bekleme ÇALIŞMAMALI
  const w1 = await step('addNode wait 1 (200 ms)', 'flow.edit', { branchId: bid, ops: [{ op: 'addNode', key: 'w1', kind: 'wait', fields: { ms: 200, title: 'Batarya · bekle 1' } }] }, (r) => r.outcome === 'tamam')
  const after1 = (await call(inf, 'flow.read', { branchId: bid })).data
  const n1 = ((after1 && (after1.nodes || after1.allNodes)) || []).find((n) => String(n.title || '').includes('bekle 1'))
  void w1
  let n2 = null
  let n3 = null
  if (n1?.id) {
    await call(inf, 'flow.edit', { branchId: bid, ops: [{ op: 'addNode', key: 'w2', kind: 'wait', fields: { ms: 1000, title: 'Batarya · bekle 2' }, connectFrom: n1.id }] })
    const after2 = (await call(inf, 'flow.read', { branchId: bid })).data
    n2 = ((after2 && (after2.nodes || after2.allNodes)) || []).find((n) => String(n.title || '').includes('bekle 2'))
    if (n2?.id) {
      await call(inf, 'flow.edit', { branchId: bid, ops: [{ op: 'addNode', key: 'w3', kind: 'wait', fields: { ms: 30000, title: 'Batarya · bekle 3 (sınır ötesi)' }, connectFrom: n2.id }] })
      const after3 = (await call(inf, 'flow.read', { branchId: bid })).data
      n3 = ((after3 && (after3.nodes || after3.allNodes)) || []).find((n) => String(n.title || '').includes('bekle 3'))
    }
  }
  console.log(`  zincir: ${n1?.id || '?'} → ${n2?.id || '?'} → ${n3?.id || '?'}`)
  if (n1?.id && n2?.id) {
    await step('run.from --until (sınırlı bölge)', 'run.from', { branchId: bid, nodeId: n1.id, untilNodeId: n2.id }, (r) => r.ok)
    const w = await call(inf, 'run.wait', { timeoutMs: 120000 })
    const last = w.data?.last || {}
    const steps = (w.data?.recentSteps || w.data?.steps || []).map((s) => s.id)
    console.log(`    resmî: stopped=${last.stopped} · stoppedBy=${w.data?.stoppedBy} · adım=${last.steps}`)
    // Sınır ötesi adımın KOŞMADIĞINI ölçülebilir biçimde kanıtla: sınır ötesi bekleme 30 sn olsaydı
    // koşunun süresi ~31 sn olurdu. Adım listesi boş gelebildiği için süre tek güvenilir kanıttır.
    const sure = last.endedAt && last.startedAt ? Math.round((last.endedAt - last.startedAt) / 1000) : null
    const kostu = sure !== null && sure > 10
    R.push({
      ad: 'sınır ötesi 30 sn KOŞMADI',
      name: 'run.from',
      ok: sure !== null && !kostu,
      outcome: sure === null ? 'süre yok' : `${sure}s`,
      msg: sure === null ? 'süre okunamadı' : kostu ? 'sınır ötesi bekleme koştu!' : `süre ${sure}s · 30 sn'lik bekleme koşmadı`,
    })
    console.log(`${uyu(sure !== null && !kostu)} ${'sınır ötesi 30 sn KOŞMADI'.padEnd(34)} ${sure === null ? '✗ süre okunamadı' : `${sure}s (30 sn koşsaydı ~31s olurdu)`}`)
  }

  // 6) Temizlik + değişmez
  const drop = await call(inf, 'branch.drop', { branchId: bid })
  console.log(`\ntemizlik: ${kisa(drop.message, 70)}`)
  const h2 = hash(REAL)
  const gecen = R.filter((x) => x.ok).length
  console.log(`\nözet: ${R.length} kontrol · ${gecen} ✓ · ${R.length - gecen} ✗`)
  console.log(`gerçek depo: ${h1} → ${h2} · DEĞİŞMEDİ: ${h1 === h2}`)
  console.log(`kök node sayısı (ilk okuma): ${(read.data?.nodes || []).length}`)
  fs.writeFileSync(path.join(__dirname, '..', 'test-artifacts', 'repair-battery.json'), JSON.stringify({ at: new Date().toISOString(), R, h1, h2 }, null, 2), 'utf8')
  process.exit(h1 === h2 && gecen === R.length ? 0 : 1)
}

main().catch((e) => {
  console.error(`hata: ${e.message}`)
  process.exit(2)
})
