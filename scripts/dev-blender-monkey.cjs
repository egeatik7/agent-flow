#!/usr/bin/env node
/**
 * Suzanne'ı YALNIZ ARAYÜZLE koyar: Add menüsü açıkken Mesh → Monkey.
 * Her adım gerçek fare tıklamasıdır; kapıdan (dev-safe) geçirilmelidir.
 */
const fs = require('fs')
const path = require('path')
const http = require('http')
const APPDATA = process.env.APPDATA || ''
const info = JSON.parse(fs.readFileSync(path.join(APPDATA, 'xp-agent-studio-test', 'tool-endpoint.json'), 'utf8'))
const kisa = (s, n = 240) => String(s || '').replace(/\s+/g, ' ').slice(0, n)
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
const bekle = (ms) => new Promise((r) => setTimeout(r, ms))
const uyu = (v) => (v ? '✓' : '✗')

async function main() {
  const oncesi = await call('screen.read', { maxItems: 8 })
  console.log(`  0) önce: ${kisa(oncesi.message, 140)}`)

  // Add menüsü açık mı? Menüye özgü öğeler ekranda varsa açıktır; değilse menü açılır.
  const menuAcik = /Metaball|Grease Pencil|Collection Instance/i.test(String(oncesi.data?.text ?? oncesi.message ?? ''))
  if (!menuAcik) {
    const add = await call('act.click', { target: 'Add' })
    console.log(`  0b) menü kapalıydı, «Add» tıklandı → ${add.outcome} · ${kisa(add.message, 140)}`)
    await bekle(1500)
  } else {
    console.log('  0b) Add menüsü zaten açık ✓')
  }

  const mesh = await call('act.click', { target: 'Mesh' })
  console.log(`  1) ${uyu(mesh.ok)} «Mesh» → ${mesh.outcome} · ${kisa(mesh.message, 200)}`)
  await bekle(1500)

  const monkey = await call('act.click', { target: 'Monkey' })
  console.log(`  2) ${uyu(monkey.ok)} «Monkey» → ${monkey.outcome} · ${kisa(monkey.message, 200)}`)
  await bekle(2500)

  const sonrasi = await call('screen.read', { maxItems: 12 })
  console.log(`  3) sonra: ${kisa(sonrasi.message, 260)}`)

  const shots = path.join(APPDATA, 'xp-agent-studio-test', 'shots')
  if (fs.existsSync(shots)) {
    const en = fs.readdirSync(shots).map((x) => ({ x, t: fs.statSync(path.join(shots, x)).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, 3)
    console.log(`  4) en yeni görüntüler: ${en.map((e) => e.x).join(' · ')}`)
  }
}
main().catch((e) => {
  console.error(`hata: ${e.message}`)
  process.exit(2)
})
