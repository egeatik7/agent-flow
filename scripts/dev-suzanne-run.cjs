#!/usr/bin/env node
/**
 * Taslak akışı BAŞTAN koşar ve kanıtı toplar: resmî sonuç, gözlenen adımlar, durma nedeni,
 * donmuş hata, son motor günlüğü ve en yeni ekran görüntüleri.
 *
 * Varsayım yok: ne olduğunu yalnız motorun söylediklerinden ve ekrandan okur.
 * Masaüstüne girdi üretir -> dev-safe kapısından geçirilmelidir.
 */
const fs = require('fs')
const path = require('path')
const http = require('http')
const APPDATA = process.env.APPDATA || ''
const info = JSON.parse(fs.readFileSync(path.join(APPDATA, 'xp-agent-studio-test', 'tool-endpoint.json'), 'utf8'))
const kisa = (s, n = 300) => String(s || '').replace(/\s+/g, ' ').slice(0, n)
function call(name, args, timeoutMs = 400000) {
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
async function main() {
  console.log(`uç nokta: port ${info.port} · build ${info.build}`)
  const bas = await call('run.from', { fromStart: true, fast: true })
  console.log(`\n1) başlatma: ${bas.ok ? '✓' : '✗'} · ${kisa(bas.message)}`)
  if (!bas.ok) process.exit(1)
  const bekle = await call('run.wait', { timeoutMs: 300000 })
  console.log(`\n2) SONUÇ: ${kisa(bekle.message, 800)}`)
  const durum = await call('run.state', {})
  console.log(`\n3) durum: ${kisa(durum.message, 340)}`)
  const rapor = await call('run.report', {})
  const f = rapor.data?.frozen
  console.log(`\n4) donmuş hata: ${f ? `VAR · “${f.nodeTitle}” · ${kisa(f.error, 200)}` : 'yok'}`)
  console.log(`   son adımlar: ${kisa(JSON.stringify(rapor.data?.steps ?? rapor.data?.recentSteps ?? '—'), 260)}`)

  const logDir = path.join(APPDATA, 'xp-agent-studio-test', 'logs')
  if (fs.existsSync(logDir)) {
    const vers = fs.readdirSync(logDir).sort().pop()
    const dosyalar = vers
      ? fs
          .readdirSync(path.join(logDir, vers))
          .map((x) => ({ x, t: fs.statSync(path.join(logDir, vers, x)).mtimeMs }))
          .sort((a, b) => b.t - a.t)
      : []
    if (dosyalar[0]) {
      const yol = path.join(logDir, vers, dosyalar[0].x)
      const satirlar = fs.readFileSync(yol, 'utf8').split(/\r?\n/).filter(Boolean)
      console.log(`\n5) motor günlüğü (${dosyalar[0].x}) son 26 satır:`)
      for (const s of satirlar.slice(-26)) console.log(`   ${kisa(s, 150)}`)
    }
  }
  const shots = path.join(APPDATA, 'xp-agent-studio-test', 'shots')
  if (fs.existsSync(shots)) {
    const en = fs
      .readdirSync(shots)
      .map((x) => ({ x, t: fs.statSync(path.join(shots, x)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(0, 4)
    console.log(`\n6) en yeni görüntüler:`)
    for (const x of en) console.log(`   ${x.x}`)
  }
}
main().catch((e) => {
  console.error(`hata: ${e.message}`)
  process.exit(2)
})
