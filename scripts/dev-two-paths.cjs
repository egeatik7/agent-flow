#!/usr/bin/env node
/**
 * Aynı hedefe iki yol: araç katmanı (step.run) ve akış yolu (run.from).
 * Amaç: "Add bulunamadı" hatasının yola mı bağlı olduğunu ÖLÇMEK (tahmin değil).
 * Kapıdan geçirilmelidir.
 */
const fs = require('fs')
const path = require('path')
const http = require('http')
const APPDATA = process.env.APPDATA || ''
const info = JSON.parse(fs.readFileSync(path.join(APPDATA, 'xp-agent-studio-test', 'tool-endpoint.json'), 'utf8'))
const kisa = (s, n = 300) => String(s || '').replace(/\s+/g, ' ').slice(0, n)
function call(name, args, timeoutMs = 240000) {
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
const bekle = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const hedef = process.argv[2] || 'click-10' // akıştaki "Add" tıklaması
  console.log(`hedef düğüm: ${hedef}`)

  console.log('\nA) ARAÇ KATMANI — step.run (izole tek adım, akışa yazmaz)')
  const a = await call('step.run', { nodeId: hedef, fast: true })
  console.log(`   sonuç: ${a.outcome} · ok=${a.ok} · ${kisa(a.message, 260)}`)

  await bekle(2500)

  console.log('\nB) AKIŞ YOLU — run.from (aynı düğümden)')
  const b = await call('run.from', { nodeId: hedef, fast: true })
  console.log(`   başlatma: ok=${b.ok} · ${kisa(b.message, 200)}`)
  if (b.ok) {
    const w = await call('run.wait', { timeoutMs: 120000 })
    console.log(`   sonuç: ${kisa(w.message, 420)}`)
  }
}
main().catch((e) => {
  console.error(`hata: ${e.message}`)
  process.exit(2)
})
