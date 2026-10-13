import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * O05 (yönerge) — görsel modelin büyütme kırpması negatif sanal masaüstü koordinatını 0'a kırpmamalı.
 *
 * Ölçülen kusur: `agent.ts` içinde kırpma dikdörtgeni `Math.max(0, Math.round(anchor.x - zoomW/2))` ile
 * hesaplanıyordu. Ana monitörün solunda/üstünde ekran varsa sanal masaüstü koordinatları NEGATİFTİR;
 * 0'a kırpma istenen bölgeyi birincil ekranın kenarına kaydırır, model yanlış bölgeye bakar ve cevap
 * gerçek kırpma alanına (`crop.area`) göre ekrana taşındığı için tıklama da kayabilir. Worker'ın `crop`
 * dalı x/y'yi zaten sanal ekran sınırlarına kırpar ve negatif koordinatı destekler.
 *
 * Çoklu monitör davranışı canlı Windows ister; bu dosya düzeltmenin KAYNAKTA kalıcı olduğunu güvenceye alır.
 */
const ham = readFileSync(fileURLToPath(new URL('../electron/agent.ts', import.meta.url)))
const kaynak = ham.includes(0) ? ham.toString('utf16le') : ham.toString('utf8')
const bolge = (() => { const bas = kaynak.indexOf('const zoomW = 420'); return bas > 0 ? kaynak.slice(bas, bas + 2200) : '' })()

describe('O05: büyütme kırpması negatif koordinatı korur', () => {
  it('kırpma x/y 0’a kırpılmıyor (eski desen yok)', () => {
    expect(bolge).not.toContain('Math.max(0, Math.round(anchor.x')
    expect(bolge).not.toContain('Math.max(0, Math.round(anchor.y')
  })

  it('kırpma koordinatı doğrudan ankordan hesaplanır (işaret korunur)', () => {
    expect(bolge).toContain('x: Math.round(anchor.x - zoomW / 2)')
    expect(bolge).toContain('y: Math.round(anchor.y - zoomH / 2)')
  })

  it('haritalama dönen gerçek kırpma alanıyla yapılır (crop.area)', () => {
    expect(bolge).toContain('crop.area')
  })
})
