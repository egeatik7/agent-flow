#!/usr/bin/env node
/**
 * Ayar arayüzü yaması — CRLF farkındalıklı sürüm.
 *
 * Dosyalar CRLF satır sonu kullanıyor; satır karşılaştırmaları bu yüzden tutmuyordu. Burada satır
 * sonu korunur, karşılaştırmalar `\r` temizlenerek yapılır ve dosya aynı satır sonuyla yazılır.
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const root = path.join(__dirname, '..')
const p = path.join(root, 'src/components/AgentTab.tsx')

execFileSync('git', ['checkout', '--', 'src/components/AgentTab.tsx'], { cwd: root, stdio: 'inherit' })
const ham = fs.readFileSync(p, 'utf8')
const crlf = ham.includes('\r\n')
const satirlar = ham.split(/\r?\n/)
console.log(`✓ geri alındı · satır sonu: ${crlf ? 'CRLF' : 'LF'} · ${satirlar.length} satır`)

const label = satirlar.findIndex((s) => s.includes('<label>Ajan izni</label>'))
let acilis = -1
for (let k = label; k >= 0; k--) {
  if (/^\s*<div className="field">\s*$/.test(satirlar[k])) {
    acilis = k
    break
  }
}
if (label < 0 || acilis < 0) {
  console.error('✗ alan bulunamadı')
  process.exit(1)
}
const g = satirlar[acilis].match(/^\s*/)[0]
let kapanis = -1
for (let k = label; k < satirlar.length; k++) {
  if (satirlar[k].replace(/\s+$/, '') === `${g}</div>`) {
    kapanis = k
    break
  }
}
if (kapanis < 0 || kapanis - acilis > 30) {
  console.error(`✗ kapanış bulunamadı (açılış ${acilis + 1}, kapanış ${kapanis + 1})`)
  process.exit(1)
}
console.log(`✓ alan: açılış ${acilis + 1} · etiket ${label + 1} · kapanış ${kapanis + 1} (girinti ${g.length})`)

const iç = `${g}  `
const blok = [
  '',
  `${g}<div className="field">`,
  `${iç}<label>Ekran doğrulaması</label>`,
  `${iç}<select`,
  `${iç}  className="xp-input"`,
  `${iç}  value={screenCheckMode(settings)}`,
  `${iç}  onChange={(e) => onSaveSettings({ screenCheck: e.target.value as 'off' | 'log' | 'on' })}`,
  `${iç}>`,
  `${iç}  <option value="off">Kapalı — eylemden sonra ekrana hiç bakılmaz (en hızlı)</option>`,
  `${iç}  <option value="log">Yalnızca günlük — bakar ve yazar, adımı hata saymaz, model çağırmaz</option>`,
  `${iç}  <option value="on">Açık — bakmazsa yakından bakar ve plan sorar</option>`,
  `${iç}</select>`,
  `${iç}<p className="hint">`,
  `${iç}  Varsayılan <b>yalnızca günlük</b>. Eşik ayarı denendi ve sürekli sorun çıkardı; tekrar`,
  `${iç}  denenmez (CLAUDE.md §17). Kapalı seçilirse eylem yapıldı sayılır ve hiçbir tarama yapılmaz.`,
  `${iç}</p>`,
  `${g}</div>`,
]
satirlar.splice(kapanis + 1, 0, ...blok)
let metin = satirlar.join(crlf ? '\r\n' : '\n')

const eskiImport = "import type { AgentGraph, AgentNode, AppSettings, ToolResult, ToolSpec } from '../types'"
if (!metin.includes(eskiImport)) {
  console.error('✗ içe aktarma satırı yok')
  process.exit(1)
}
metin = metin.replace(
  eskiImport,
  "import { screenCheckMode, type AgentGraph, type AgentNode, type AppSettings, type ToolResult, type ToolSpec } from '../types'"
)
fs.writeFileSync(p, metin, 'utf8')
const say = (n) => metin.split(n).length - 1
console.log(`✓ eklendi · screenCheckMode ${say('screenCheckMode')} · alan div'i ${say('<div className="field">')} · satır sonu korundu: ${metin.includes('\r\n') === crlf}`)
if (say('screenCheckMode') !== 2 || metin.includes('\r\n') !== crlf) process.exit(1)
console.log('Yapı doğru')
