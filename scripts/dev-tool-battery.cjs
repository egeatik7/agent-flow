#!/usr/bin/env node
/**
 * Araç kapsam bataryası: 24 aracın hepsini canlı uç noktaya karşı bir kez çağırır.
 *
 * Güvenlik sınırları:
 *  - Yalnız TEST profiline bağlanır (jeton `xp-agent-studio-test` altından okunur); gerçek profilin
 *    jetonu okunmaz.
 *  - Masaüstüne girdi GİTMEZ: eyleyen araçlar boş/bozuk argümanla çağrılır (korumayı sınar) ve
 *    yalnızca `act.wait` gerçekten çalışır (girdi üretmez).
 *  - Gerçek profilin deposunun SHA-256'sı önce/sonra ölçülür; değişirse batarya BAŞARISIZ olur.
 *
 * Kullanım: node scripts/dev-tool-battery.cjs
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


function hash(p) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16)
  } catch {
    return null
  }
}
function info() {
  const j = JSON.parse(fs.readFileSync(TOKEN, 'utf8'))
  if (!j.port || !j.token) throw new Error('test jetonu eksik')
  if (j.profile && j.profile !== 'test') throw new Error(`jeton test profili değil: ${j.profile}`)
  return j
}
function call(inf, name, args, timeoutMs = 120000) {
  const body = JSON.stringify({ name, args: args || {} })
  const started = Date.now()
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: inf.port,
        path: '/call',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: `Bearer ${inf.token}` },
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          let r = null
          try {
            r = JSON.parse(raw)
          } catch {
            r = { ok: false, outcome: 'cevap-okunamadı', message: raw.slice(0, 80) }
          }
          resolve({ r, ms: Date.now() - started })
        })
      }
    )
    req.setTimeout(timeoutMs, () => req.destroy(new Error('zaman aşımı')))
    req.on('error', (e) => resolve({ r: { ok: false, outcome: 'bağlantı-hatası', message: e.message }, ms: Date.now() - started }))
    req.end(body)
  })
}

async function main() {
  const onceHash = hash(REAL)
  const inf = info()
  console.log(`uç nokta: port ${inf.port} · build ${inf.build || '?'} · profil ${inf.profile || '?'}`)
  console.log(`gerçek depo (önce): ${onceHash}\n`)

  const satirlar = []
  const kisa = (s) => String(s || '').replace(/\s+/g, ' ').slice(0, 74)
  async function run(name, args, not) {
    const { r, ms } = await call(inf, name, args)
    satirlar.push({ name, ok: r.ok, outcome: r.outcome, ms, msg: kisa(r.message) })
    console.log(`${String(r.ok).padEnd(5)} ${name.padEnd(16)} ${String(r.outcome || '-').padEnd(15)} ${String(ms).padStart(6)}ms  ${not || kisa(r.message)}`)
    return r
  }

  // Sıra: önce okuyanlar, sonra branch zinciri, sonra koşu, sonra eylemler.
  await run('flow.read', {})
  await run('flow.context', { nodeId: 'fixture-inner-wait' })
  await run('flow.suggest', { packagePath: ['fixture-package'], ops: [{ op: 'patchNode', id: 'fixture-inner-wait', fields: { ms: 900 } }] })
  await run('flow.edit', {})
  await run('flow.undo', {})
  const b = await run('branch.create', { name: 'Kapsam bataryası' })
  const bid = b.data && b.data.branchId
  await run('branch.list', {})
  await run('branch.diff', { branchId: bid })
  await run('branch.show', { branchId: bid })
  await run('branch.merge', { branchId: bid })
  await run('merge.undo', {})
  await run('branch.drop', { branchId: bid })
  await run('run.from', {})
  await run('run.state', {})
  await run('run.report', {})
  await run('run.stop', {})
  await run('run.wait', { timeoutMs: 200 })
  await run('step.run', { nodeId: 'fixture-inner-wait', packagePath: ['fixture-package'] })
  await run('target.preview', { nodeId: 'fixture-inner-wait' })
  await run('screen.read', { maxItems: 10 })
  await run('act.click', {})
  await run('act.type', { text: '   ' })
  await run('act.key', {})
  await run('act.wait', { ms: 60 })

  const sonHash = hash(REAL)
  const cevapVeren = satirlar.filter((s) => s.ok).length
  const reddeden = satirlar.filter((s) => !s.ok).length
  console.log(`\nözet: ${satirlar.length} araç · ${cevapVeren} ok:true · ${reddeden} red/uyarı`)
  console.log(`gerçek depo (sonra): ${sonHash} · DEĞİŞMEDİ: ${sonHash === onceHash}`)
  // Depo okunamadıysa ölçüm yoktur: batarya başarısız olur.
  if (onceHash === null || sonHash === null) {
    console.log('✗ gerçek profil deposu okunamadı; "değişmedi" DENEMEZ')
    process.exit(1)
  }
  // Beklenen sonuçlar tek tek doğrulanır: hepsi başarısız olsa da yeşil dönemez.
// Doğrulanmış beklentiler (24 aracın hepsi bir kez koşuldu ve gerekçesi okundu):
//   ok  : araç işini yaptı ya da bilgi verdi (yazmadan).
//   red : probe argümanı eksik olduğu için KASITLI kapı çalıştı — bu doğru davranıştır:
//         flow.edit (branchId yok), flow.undo (branch yok), merge.undo (panel kapısı),
//         run.from (baştan koşu onayı), act.click/act.type/act.key (boş argüman koruması).
const beklenenOk = new Set(['flow.read', 'flow.context', 'flow.suggest', 'branch.create', 'branch.list', 'branch.diff', 'branch.show', 'branch.merge', 'branch.drop', 'run.state', 'run.report', 'run.stop', 'run.wait', 'step.run', 'target.preview', 'screen.read', 'act.wait'])
const beklenenRed = new Set(['flow.edit', 'flow.undo', 'merge.undo', 'run.from', 'act.click', 'act.type', 'act.key'])
    const uymayan = satirlar.filter((x) => (beklenenOk.has(x.name) ? true : beklenenRed.has(x.name) ? false : null) !== !!x.ok).map((x) => `${x.name}:${x.ok ? 'ok' : 'red'} (beklenen ${beklenenOk.has(x.name) ? 'ok' : 'red'})`)
  if (uymayan.length) console.log(`✗ beklenmeyen sonuç: ${uymayan.join(', ')}`)
  const eksik = ['flow.suggest', 'branch.create', 'branch.list', 'branch.diff', 'flow.edit', 'flow.undo', 'branch.drop', 'branch.merge', 'merge.undo', 'flow.read', 'target.preview', 'flow.context', 'step.run', 'run.from', 'act.click', 'act.type', 'act.key', 'act.wait', 'screen.read', 'run.report', 'run.wait', 'branch.show', 'run.stop', 'run.state'].filter(
    (n) => !satirlar.some((s) => s.name === n)
  )
  if (eksik.length) console.log(`✗ çağrılmayan araç: ${eksik.join(', ')}`)
  fs.writeFileSync(path.join(__dirname, '..', 'test-artifacts', 'tool-battery.json'), JSON.stringify({ at: new Date().toISOString(), satirlar, onceHash, sonHash }, null, 2), 'utf8')
  process.exit(sonHash === onceHash && !eksik.length && !uymayan.length ? 0 : 1)
}

main().catch((e) => {
  console.error(`hata: ${e.message}`)
  process.exit(2)
})
