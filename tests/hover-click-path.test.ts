import { describe, expect, it, beforeEach } from 'vitest'
import { parseJsonAction } from '../electron/openrouter'
import { clearHover, hoverDecision, hoverOf, recordHover, HOVER_MAX_AGE_MS } from '../electron/hover'

/**
 * İNCELEME DÜZELTMESİ TESTLERİ (kullanıcının raporu).
 *
 * Eskiden testler ağırlıkla TARS ayrıştırıcısını ve kaynakta belirli yazıların bulunmasını
 * kontrol ediyordu; Luna'nın JSON yolu, gerçek imleç ve bayat kayıt sınanmamıştı.
 * Bu dosya GERÇEK fonksiyonları çalıştırır:
 *   - parseJsonAction  → modelin JSON cevabı hangi eyleme dönüşüyor
 *   - hoverDecision    → "oradan tıkla" ne zaman tıklar, ne zaman REDDEDER
 */
describe('Luna JSON yolu: move / click_current artık wait DEĞİL', () => {
  // Kullanıcının ölçtüğü tablo: bu satırlar eskiden 'wait' oluyordu.
  it("action:\"move\" → move", () => {
    const a = parseJsonAction(JSON.stringify({ action: 'move', x: 120, y: 340, thought: 'konumlan' }))
    expect(a.kind, 'move yine wait oluyor').toBe('move')
    expect(a.x).toBeCloseTo(0.12, 5)
    expect(a.y).toBeCloseTo(0.34, 5)
  })

  it('action:"click_current" → clickCurrent', () => {
    expect(parseJsonAction(JSON.stringify({ action: 'click_current' })).kind).toBe('clickCurrent')
  })

  it('action:"clickCurrent" → clickCurrent', () => {
    expect(parseJsonAction(JSON.stringify({ action: 'clickCurrent' })).kind).toBe('clickCurrent')
  })

  it('koordinatlı click eskisi gibi click (davranış korunuyor)', () => {
    const a = parseJsonAction(JSON.stringify({ action: 'click', x: 500, y: 250 }))
    expect(a.kind).toBe('click')
    expect(a.x).toBeCloseTo(0.5, 5)
  })

  it('move koordinatsız gelirse reddedilir (uydurma yok)', () => {
    expect(() => parseJsonAction(JSON.stringify({ action: 'move' }))).toThrow()
  })

  it('bilinmeyen eylem hâlâ wait', () => {
    expect(parseJsonAction(JSON.stringify({ action: 'zipla' })).kind).toBe('wait')
  })
})

describe('"oradan tıkla" kararı: gerçek imleç + tazelik', () => {
  beforeEach(() => clearHover())

  it('kayıt yoksa TIKLAMAZ', () => {
    const k = hoverDecision({ x: 100, y: 100 })
    expect(k.ok).toBe(false)
    expect(k.reason).toContain('bilinmiyor')
  })

  it('imleç kayıttaki noktadaysa tıklar', () => {
    recordHover({ x: 100, y: 200 })
    const k = hoverDecision({ x: 101, y: 201 })
    expect(k.ok).toBe(true)
    expect(k.point).toEqual({ x: 100, y: 200 })
  })

  it('kullanıcı/başka eylem fareyi oynattıysa BAYAT NOKTAYA BASMAZ', () => {
    recordHover({ x: 100, y: 200 })
    const k = hoverDecision({ x: 400, y: 500 })
    expect(k.ok, 'eski noktaya bastı').toBe(false)
    expect(k.reason).toContain('beklenen yerde değil')
  })

  it('gerçek imleç okunamazsa TIKLAMAZ (tahmin etmez)', () => {
    recordHover({ x: 100, y: 200 })
    expect(hoverDecision(undefined).ok).toBe(false)
  })

  it('yaşlı kayda güvenmez', () => {
    const eski = Date.now() - HOVER_MAX_AGE_MS - 1000
    recordHover({ x: 10, y: 10 }, 42, eski)
    const k = hoverDecision({ x: 10, y: 10 })
    expect(k.ok).toBe(false)
    expect(k.reason).toContain('bayat')
  })

  it('kayıt pencere damgasını (hwnd) taşır — pencere değişirse worker basmaz', () => {
    recordHover({ x: 5, y: 6 }, 987654)
    expect(hoverOf()?.hwnd).toBe(987654)
    expect(hoverOf()?.x).toBe(5)
  })

  it('clearHover kaydı siler (koşu başında ve pencere değişiminde çağrılır)', () => {
    recordHover({ x: 1, y: 2 })
    clearHover()
    expect(hoverOf()).toBeUndefined()
    expect(hoverDecision({ x: 1, y: 2 }).ok).toBe(false)
  })
})
