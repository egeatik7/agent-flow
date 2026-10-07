#!/usr/bin/env node
/** Tek tıklama sınaması: "Add" hedefi gerçekten menüyü açıyor mu? (Kapıdan geçirilmelidir.) */
const fs = require('fs')
const path = require('path')
const http = require('http')
const APPDATA = process.env.APPDATA || ''
const info = JSON.parse(fs.readFileSync(path.join(APPDATA, 'xp-agent-studio-test', 'tool-endpoint.json'), 'utf8'))
const kisa = (s, n = 200) => String(s || '').replace(/\s+/g, ' ').slice(0, n)
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
            resolve({ ok: false, message: raw.slice(0, 120) })
          }
        })
      }
    )
    req.setTimeout(timeoutMs, () => req.destroy(new Error('zaman aşımı')))
    req.on('error', (e) => resolve({ ok: false, message: e.message }))
    req.end(body)
  })
}
const uyu = (v) => (v ? '✓' : '✗')
async function main() {
  const oncesi = await call('screen.read', { maxItems: 6 })
  console.log(`  önce: ${kisa(oncesi.message, 160)}`)
  const t = await call('act.click', { target: 'Add' })
  console.log(`  ${uyu(t.ok)} act.click «Add» → ${t.outcome} · ${kisa(t.message, 260)}`)
  await new Promise((r) => setTimeout(r, 2500))
  const sonrasi = await call('screen.read', { maxItems: 10 })
  console.log(`  sonra: ${kisa(sonrasi.message, 300)}`)
  const shots = path.join(APPDATA, 'xp-agent-studio-test', 'shots')
  if (fs.existsSync(shots)) {
    const en = fs.readdirSync(shots).map((x) => ({ x, t: fs.statSync(path.join(shots, x)).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, 2)
    console.log(`  en yeni görüntüler: ${en.map((e) => e.x).join(' · ')}`)
  }
}
main().catch((e) => {
  console.error(`hata: ${e.message}`)
  process.exit(2)
})
