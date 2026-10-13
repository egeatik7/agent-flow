import { describe, expect, it } from 'vitest'
import type { ScreenItem } from '../electron/matcher'
import { CLICKABLE_CONTROLS, clickableBy, normName } from '../electron/target-match'

/**
 * O13 + O14 (yönerge).
 *
 * O13 — `CLICKABLE_CONTROLS` içinde 'Link' vardı ama hiçbir üretici onu üretmiyor; gerçek tür
 * **'Hyperlink'** (UIA `ControlType.Hyperlink` ve DOM üreticisi). Hyperlink listede olmadığı için
 * bağlantı "control" sayılmıyordu: aynı yazılı bir Text etiketiyle eşitleniyor ve "birden çok aday +
 * `near` yok" kuralı yüzünden HİÇ aday üretilmiyordu.
 *
 * O14 — `normName` `toLocaleLowerCase('tr')` kullanıyordu; ASCII 'I' noktasız 'ı' olduğu için öğe
 * 'Import' ile komut 'import' hiç eşleşmiyordu.
 */
const oge = (text: string, type: string, x = 0, y = 0): ScreenItem => ({ id: Math.round(x + y + text.length), text, type, src: 'uia', x, y, w: 80, h: 20 }) as ScreenItem

describe('O13: Hyperlink tıklanabilir kontrol sayılır', () => {
  it('Hyperlink listede ve tek aday olarak seçilir', () => {
    expect(CLICKABLE_CONTROLS).toContain('Hyperlink')
    const hedef = clickableBy([oge('Belgeler', 'Text'), oge('Belgeler', 'Hyperlink')], 'Belgeler')
    expect(hedef?.type).toBe('Hyperlink') // control, etikete yeğlenir
  })

  it('eski kayıtlar için Link alias olarak korunur', () => {
    expect(CLICKABLE_CONTROLS).toContain('Link')
    expect(clickableBy([oge('Bağlantı', 'Text'), oge('Bağlantı', 'Link')], 'Bağlantı')?.type).toBe('Link')
  })
})

describe('O14: Türkçe I normalizasyonu ASCII eşleşmeyi bozmaz', () => {
  it('Import / IMPORT / import aynı ada çözülür', () => {
    expect(normName('Import')).toBe('import')
    expect(normName('IMPORT')).toBe('import')
    expect(normName('import')).toBe('import')
    expect(clickableBy([oge('Import', 'Button')], 'import')?.text).toBe('Import')
    expect(clickableBy([oge('Import', 'Button')], 'IMPORT')?.text).toBe('Import')
  })

  it('Türkçe İ/ı davranışı korunur, aksanlı metin değişmez', () => {
    expect(normName('İçe Aktar')).toBe('içe aktar')
    expect(clickableBy([oge('İçe Aktar', 'Button')], 'içe aktar')?.text).toBe('İçe Aktar')
    expect(clickableBy([oge('Yıkama', 'Button')], 'yıkama')?.text).toBe('Yıkama')
    expect(normName('Café')).toBe('café') // aksan korunur (kontrolsüz sadeleştirme yok)
  })

  it('kısmi eşleşme hâlâ reddedilir (yanlış kontrol tıklanmaz)', () => {
    expect(clickableBy([oge('Imports', 'Button')], 'import')).toBeUndefined()
  })
})
