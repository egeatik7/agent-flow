#!/usr/bin/env node
/**
 * Test profilinin ayar deposuna tek bir anahtar yazar (geliştirme yardımcısı).
 *
 * Yalnız test profilinde çalışır: gerçek profilin deposuna dokunmaz. Amaç, ayar arayüzünü elle
 * açmadan bir ayarın davranışını canlı sınamak.
 *
 * Kullanım: node scripts/dev-set-setting.cjs test <anahtar> <değer>
 */
const fs = require('fs')
const path = require('path')

const profil = (process.argv[2] || 'test').trim()
const anahtar = (process.argv[3] || '').trim()
const deger = process.argv[4]
if (profil !== 'test') {
  console.error('✗ Yalnız test profili: bu betik gerçek profilin ayarlarına yazmaz.')
  process.exit(1)
}
if (!anahtar || deger === undefined) {
  console.error('Kullanım: node scripts/dev-set-setting.cjs test <anahtar> <değer>')
  process.exit(1)
}

const dosya = path.join(process.env.APPDATA || '', 'xp-agent-studio-test', 'xp-agent-studio', 'config.json')
const adaylar = [
  dosya,
  path.join(process.env.APPDATA || '', 'xp-agent-studio-test', 'electron-store-nodejs', 'Config', 'config.json'),
  path.join(process.env.APPDATA || '', 'xp-agent-studio-test', 'config.json'),
]
const bulunan = adaylar.find((p) => fs.existsSync(p))
if (!bulunan) {
  console.error('✗ Test profilinin ayar dosyası bulunamadı. Denenen yollar:')
  for (const p of adaylar) console.error(`   ${p}`)
  process.exit(1)
}

const ham = fs.readFileSync(bulunan, 'utf8')
const veri = JSON.parse(ham.replace(/^\uFEFF/, ''))
if (!veri.settings) {
  console.error('✗ Dosyada settings bölümü yok')
  process.exit(1)
}
const eski = veri.settings[anahtar]
let yeni = deger
if (deger === 'true' || deger === 'false') yeni = deger === 'true'
else if (/^-?\d+$/.test(deger)) yeni = Number(deger)
veri.settings[anahtar] = yeni
fs.writeFileSync(bulunan, JSON.stringify(veri, null, 2), 'utf8')
console.log(`✓ ${anahtar}: ${JSON.stringify(eski)} → ${JSON.stringify(yeni)}`)
console.log(`  dosya: ${bulunan}`)
console.log('  not: ayar uygulamanın açılışında okunur; değişikliğin etkisi için örnek yeniden başlatılmalı.')
