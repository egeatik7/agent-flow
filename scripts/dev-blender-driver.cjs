#!/usr/bin/env node
/**
 * Kırmızı Suzanne sürücüsü — YALNIZ İNSAN ARAYÜZÜ.
 *
 * Akış: hazır "redsuzanne" fikstürünün Add → Mesh → Monkey → Material → New → Base Color → Hex
 * düğümleri. Blender zaten açık olduğu için akış "Add" menüsünden başlatılır (ikinci bir Blender
 * açmamak için); bütün hedefler arayüzden bulunur, Python/betik yok.
 *
 * Bu betik masaüstüne GİRDİ üretir; `dev-safe.cjs` kapısından geçirilerek çalıştırılmalıdır.
 */
const fs = require('fs')
const path = require('path')
const http = require('http')

const APPDATA = process.env.APPDATA || ''
const TOKEN = path.join(APPDATA, 'xp-agent-studio-test', 'tool-endpoint.json')
const info = JSON.parse(fs.readFileSync(TOKEN, 'utf8'))
const kisa = (s, n = 120) => String(s || '').replace(/\s+/g, ' ').slice(0, n)

function call(name, args, timeoutMs = 300000) {
  const body = JSON.stringify({ name, args: args || {} })
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: info.port,
        path: '/call',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: `Bearer ${info.token}` },
      },
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

async function main() {
  console.log(`uç nokta: port ${info.port} · build ${info.build} · profil ${info.profile}`)
  const bas = await call('run.from', { nodeId: 'rs2-add', fast: true })
  console.log(`\n1) koşu başlatıldı mı: ${bas.ok ? '✓' : '✗'} · ${kisa(bas.message, 200)}`)
  if (!bas.ok) process.exit(1)

  const bekle = await call('run.wait', { timeoutMs: 240000 })
  console.log(`\n2) koşu sonucu:\n   ${kisa(bekle.message, 700)}`)

  const durum = await call('run.state', {})
  console.log(`\n3) durum: ${kisa(durum.message, 400)}`)

  const rapor = await call('run.report', {})
  const f = rapor.data?.frozen
  console.log(`\n4) donmuş hata: ${f ? `VAR · “${f.nodeTitle}” · ${kisa(f.error, 160)}` : 'yok'}`)

  const bak = await call('screen.read', { maxItems: 12 })
  console.log(`\n5) ekran: ${kisa(bak.message, 220)}`)

  // Kanıt: en yeni kayıt dosyası ve varsa hata görüntüsü
  const shots = path.join(APPDATA, 'xp-agent-studio-test', 'shots')
  if (fs.existsSync(shots)) {
    const en = fs
      .readdirSync(shots)
      .map((x) => ({ x, t: fs.statSync(path.join(shots, x)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(0, 3)
    console.log(`\n6) en yeni görüntüler: ${en.map((e) => e.x).join(' · ')}`)
  }
  const logDir = path.join(APPDATA, 'xp-agent-studio-test', 'logs')
  if (fs.existsSync(logDir)) {
    const vers = fs.readdirSync(logDir).sort().pop()
    const dosyalar = vers ? fs.readdirSync(path.join(logDir, vers)).map((x) => ({ x, t: fs.statSync(path.join(logDir, vers, x)).mtimeMs })).sort((a, b) => b.t - a.t) : []
    if (dosyalar[0]) {
      const yol = path.join(logDir, vers, dosyalar[0].x)
      const satirlar = fs.readFileSync(yol, 'utf8').split(/\r?\n/).filter(Boolean)
      console.log(`\n7) motor günlüğü (${dosyalar[0].x}) son 18 satır:`)
      for (const s of satirlar.slice(-18)) console.log(`   ${kisa(s, 150)}`)
    }
  }
}

main().catch((e) => {
  console.error(`hata: ${e.message}`)
  process.exit(2)
})
