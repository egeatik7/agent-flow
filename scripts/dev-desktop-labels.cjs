#!/usr/bin/env node
/**
 * Masaüstündeki GERÇEK yazıları ölçer (kabul testinin başarı hedefi için).
 *
 * Neden: kabul testinde 1. öğe bir hedefi BULUP geçmeli, 2. öğe aynı hedefi BULAMAMALI.
 * Hedefi uydurmak yerine masaüstünü gösterip okunacak yazıları listeliyoruz; iş bitince masaüstü
 * geri alınır (win+d iki kez).
 *
 * Masaüstüne girdi üretir -> dev-safe kapısından geçirilmelidir.
 */
const fs = require('fs')
const path = require('path')
const http = require('http')
const APPDATA = process.env.APPDATA || ''
const info = JSON.parse(fs.readFileSync(path.join(APPDATA, 'xp-agent-studio-test', 'tool-endpoint.json'), 'utf8'))
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
const bekle = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const goster = await call('act.key', { keys: 'win+d' })
  console.log(`  masaüstü gösterildi: ${goster.outcome} · ${String(goster.message || '').slice(0, 120)}`)
  await bekle(2500)
  const r = await call('screen.read', { maxItems: 90 })
  const items = Array.isArray(r.data?.items) ? r.data.items : []
  console.log(`  okunan öğe: ${items.length} · ${String(r.message || '').slice(0, 100)}`)
  // Yalnız masaüstüne özgü olanlar: kısa, tek satır, görev çubuğu/menü dışı
  const aday = items
    .filter((x) => x.text && x.text.length >= 4 && x.text.length <= 40)
    .filter((x) => !/^(File|Edit|Render|Window|Help|View|Select|Object|Add|Layout|Modeling|Sculpting|UV Editing|Texture Paint|Shading|Animation|Rendering|Compositing|Geometry Nodes|Scripting)$/i.test(x.text))
    .filter((x) => !/Nubbo|Blender|DeepSeek|Windows|Geri Dönüşüm|Recycle/i.test(x.text))
    .slice(0, 26)
  console.log('  --- masaüstünde görünen yazılar (adaylar) ---')
  for (const x of aday) console.log(`   · [${x.type}] '${x.text}' @${Math.round(x.x)},${Math.round(x.y)}`)
  const anahtar = ['Geri Dönüşüm Kutusu', 'Recycle Bin', 'Bu Bilgisayar', 'This PC', 'Nubbo', 'Projeye genel bakış']
  console.log('  --- bilinen etiketler ---')
  for (const a of anahtar) {
    const bulundu = items.filter((x) => String(x.text || '').includes(a))
    console.log(`   ${bulundu.length ? '✓' : '✗'} '${a}' · ${bulundu.length} eşleşme${bulundu[0] ? ` @${Math.round(bulundu[0].x)},${Math.round(bulundu[0].y)}` : ''}`)
  }
  await bekle(1200)
  const geri = await call('act.key', { keys: 'win+d' })
  console.log(`  masaüstü geri alındı: ${geri.outcome}`)
}
main().catch((e) => {
  console.error(`hata: ${e.message}`)
  process.exit(2)
})
