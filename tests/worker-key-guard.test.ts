import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * U01 (yönerge) — `direct` tuş dalında hedef pencere doğrulaması.
 *
 * Ölçülen kusur: `a11y/worker.ps1` `keys` op'unun direct dalında `try { Enter-Window ... } catch {}`
 * vardı; köprü HER çağrıda `direct:true` yolladığı için (a11y-bridge.ts:579) aktivasyon başarısız olsa
 * bile tuş gönderiliyordu. Gerçek pencere/odak davranışı yalnız canlı Windows'ta ölçülebilir; bu dosya
 * düzeltmenin KAYNAKTA kalıcı olduğunu (yeniden yutulmadığını) güvenceye alır.
 */
const ham = readFileSync(fileURLToPath(new URL('../a11y/worker.ps1', import.meta.url)))
// worker.ps1 BOM'lu/UTF-16 olabilir: NUL görürsek utf16le olarak çöz (indexOf aksi hâlde hiç eşleşmez).
const kaynak = ham.includes(0) ? ham.toString('utf16le') : ham.toString('utf8')
// Direct dal: `if ($P.direct) {` ile hemen ardından gelen `if ($P.focusHwnd)` (direct OLMAYAN dal) arası.
const directDal = kaynak.slice(kaynak.indexOf('if ($P.direct) {'), kaynak.indexOf("'foreground' {"))

describe('U01: direct tuş dalı hedef pencereyi doğrular', () => {
  it('aktivasyon başarısızlığı artık yutulmuyor (eski boş catch deseni yok)', () => {
    expect(directDal.length).toBeGreaterThan(100)
    expect(directDal).not.toMatch(/try\s*\{\s*Enter-Window\s*\(Find-Window\s*\(\[string\]\$P\.windowTitle\)\)\s*\}\s*catch\s*\{\s*\}/)
  })

  it('direct dalı, direct olmayan dalla aynı korumayı kullanır (Enter-Window + Assert-KeyWindowActive)', () => {
    expect(directDal).toContain('Enter-Window $win')
    expect(directDal).toContain('Assert-KeyWindowActive $win')
  })

  it('meşru sistem kısayolları muaf tutulur (hedef uygulamadan çıkabilmek için)', () => {
    expect(directDal).toContain('Test-SystemShortcut')
  })

  it('Nubbo kendi penceresine tuş göndermeme koruması korunuyor', () => {
    expect(directDal).toContain('INPUT_SELF_TARGET')
  })
})
