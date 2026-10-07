#!/usr/bin/env node
/**
 * HARNESS DÖNGÜSÜ — mevcut araçlarla, insan yönlendirmesi olmadan:
 *   incele → branch'te küçük onarım → tuvalde göster → sınırlı dene → aynı öğeden devam
 *
 * Onarım: donmuş rapor "2. öğe (yok2-boyle-klasor-yok): klasör yok" diyor. En küçük onarım,
 * akışın öğe listesindeki yanlış yolu düzeltmektir — düğüm eklemek ya da her adıma koşul koymak
 * DEĞİL. Onarım yalnız branch'te yapılır; asıl akışa merge EDİLMEZ (panel yetkisi).
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const http = require('http')
const APPDATA = process.env.APPDATA || ''
const info = JSON.parse(fs.readFileSync(path.join(APPDATA, 'xp-agent-studio-test', 'tool-endpoint.json'), 'utf8'))
const kisa = (s, n = 340) => String(s || '').replace(/\s+/g, ' ').slice(0, n)
const kok = path.join(os.tmpdir(), 'nubbo-kabul')
const var1 = path.join(kok, 'var1')
const var3 = path.join(kok, 'var3')

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
            resolve({ ok: false, message: raw.slice(0, 160) })
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

function sonGunluk(satirSayisi = 60) {
  const logDir = path.join(APPDATA, 'xp-agent-studio-test', 'logs')
  const vers = fs.readdirSync(logDir).sort().pop()
  const dosyalar = fs
    .readdirSync(path.join(logDir, vers))
    .map((x) => ({ x, t: fs.statSync(path.join(logDir, vers, x)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  const satirlar = fs.readFileSync(path.join(logDir, vers, dosyalar[0].x), 'utf8').split(/\r?\n/).filter(Boolean)
  return satirlar.slice(-satirSayisi)
}

async function main() {
  // 3) ONARIM: branch aç, yanlış yolu düzelt (en küçük onarım)
  console.log('=== 3) BRANCH’TE ONARIM ===')
  const b = await call('branch.create', { name: 'Onarım · eksik klasör' })
  const bid = b.data?.branchId
  console.log(`  ${uyu(b.ok)} ${kisa(b.message, 140)}`)
  const read = await call('flow.read', {})
  const dis = (read.data?.nodes ?? []).find((n) => String(n.title).includes('Dış kutu'))
  console.log(`  dış kutu: ${dis?.id} · öğeler: ${JSON.stringify(dis?.items ?? [])}`)
  const yeniListe = [var1, var3, var3] // 2. öğedeki var olmayan yol, var olan klasörle değiştirildi
  const ed = await call('flow.edit', {
    branchId: bid,
    ops: [{ op: 'patchNode', id: dis?.id, fields: { items: yeniListe } }],
  })
  console.log(`  ${uyu(ed.outcome === 'tamam')} flow.edit → ${ed.outcome} · ${kisa(ed.message, 200)}`)

  // 4) TUVALDE GÖSTER
  console.log('\n=== 4) TUVALDE GÖSTER ===')
  const sh = await call('branch.show', { branchId: bid })
  console.log(`  ${uyu(sh.ok)} ${kisa(sh.message, 200)}`)

  // 5) SINIRLI DENEME: yalnız hatalı bölge (iç kutu → üyesi)
  console.log('\n=== 5) SINIRLI DENEME (until) ===')
  const ic = (read.data?.nodes ?? []).find((n) => String(n.title).includes('İç kutu'))
  const uye = (read.data?.nodes ?? []).find((n) => String(n.title).includes('bekle'))
  const t = await call('run.from', { branchId: bid, nodeId: ic?.id, untilNodeId: uye?.id, fast: true })
  console.log(`  başlatma: ${uyu(t.ok)} · ${kisa(t.message, 220)}`)
  if (t.ok) {
    const w = await call('run.wait', { timeoutMs: 120000 })
    console.log(`  sonuç: ${kisa(w.message, 300)}`)
  }

  // 6) AYNI ÖĞEDEN DEVAM
  console.log('\n=== 6) AYNI ÖĞEDEN DEVAM (resume) ===')
  const r = await call('run.from', { branchId: bid, resumeFromFailure: true, fast: true })
  console.log(`  başlatma: ${uyu(r.ok)} · ${kisa(r.message, 300)}`)
  if (r.ok) {
    const w2 = await call('run.wait', { timeoutMs: 180000 })
    console.log(`  sonuç: ${kisa(w2.message, 400)}`)
  }

  // 7) KANIT: öğe kayıtları (son koşu)
  console.log('\n=== 7) ÖĞE KAYITLARI (son koşu) ===')
  const satirlar = sonGunluk(80)
  let basladi = false
  for (const s of satirlar) {
    if (/1\/3: var1/.test(s)) basladi = true
    if (basladi && /—|bitti|ERROR|tekrar|SINIR|durduruldu/.test(s)) console.log(`   ${kisa(s, 150)}`)
  }
  console.log('\n=== MERGE YAPILMADI (panel yetkisi) ===')
  const list = await call('branch.list', {})
  console.log(`  ${kisa(list.message, 220)}`)
}
main().catch((e) => {
  console.error(`hata: ${e.message}`)
  process.exit(2)
})
