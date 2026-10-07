#!/usr/bin/env node
/**
 * Bir Windows uygulamasını, çıktısını YAKALAMADAN başlatır (geliştirme yardımcısı).
 *
 * Neden ayrı bir betik: bu ortamda çıktıyı yakalayan (`cmd /c start` + pipe) başlatma askıda
 * kalıyor; başlatıcı da bu yüzden `stdio: 'ignore'` kullanıyor. Gerçek profil için kullanılır:
 * NUBBO_PROFILE bilerek verilmez, yani uygulama sahibinin kendi deposuyla açılır.
 *
 * Kullanım: node scripts/dev-open-app.cjs "<exe yolu>"
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const hedef = (process.argv[2] || '').trim()
if (!hedef) {
  console.error('Kullanım: node scripts/dev-open-app.cjs "<exe yolu>"')
  process.exit(1)
}
const tam = path.resolve(hedef)
if (!fs.existsSync(tam)) {
  console.error(`✗ bulunamadı: ${tam}`)
  process.exit(1)
}
// Gerçek profille açılır: test profili ortam değişkeni bilerek eklenmez.
const env = { ...process.env }
delete env.NUBBO_PROFILE
delete env.NUBBO_BUILD
delete env.ELECTRON_RUN_AS_NODE
const r = spawnSync('cmd', ['/c', 'start', '', tam], { env, stdio: 'ignore', windowsHide: false })
console.log(`başlatma istendi: ${tam} (çıkış ${r.status === null ? 'yok' : r.status})`)
