import { describe, expect, it } from 'vitest'
import { inputGuardFor, type InputGuard, type InputWindow, type Point } from '../electron/input-policy'

/**
 * Yazma korumasının kapısı.
 *
 * Ölçülen sorun (223 gerçek günlük): "Odaktaki öğe bir yazı alanı değil (Window)" 14×,
 * "Odak bir yazı alanı değil (Pane). Yazı gönderilmedi." 9×,
 * "INPUT_FOCUS_UNRESOLVED; UIA=Pane, native=TkChild, pencere=Görsel İsimlendirici" 5+2×.
 *
 * Kural (worker tarafındaki Assert-DirectInput ile aynı): alan BİZİM tarafımızdan tıklandıysa
 * (binding.at var, hedef kaymamış) ve temizleme istenmişse "doğrudan" yol kullanılır; UIA
 * sınıflandırması (Pane/TkChild/Window) yazmayı ENGELLEMEZ. Temizleme istenmemişse doğrudan yol
 * kullanılmaz — worker bu durumda açıkça reddeder ("forced route cannot erase" koruması).
 */
const pencere = { hwnd: '1', pid: 10, rect: { x: 0, y: 0, w: 100, h: 100 } } as unknown as InputWindow
const nokta: Point = { x: 20, y: 30 }

describe('inputGuardFor: yazma kapısı', () => {
  it('tıklanmış alan + temizleme isteği → doğrudan yol (UIA sınıfı önemsiz)', () => {
    const g = inputGuardFor({ window: pencere, at: nokta }, { visual: false, clear: true }) as InputGuard
    expect(g).toBeTruthy()
    expect(g.direct, 'Pane/TkChild alanlarda yazma yine reddedilecek').toBe(true)
    expect(g.at).toEqual(nokta)
  })

  it('temizleme istenmemişse doğrudan yol KULLANILMAZ (silme yetkisi verilmez)', () => {
    const g = inputGuardFor({ window: pencere, at: nokta }, { visual: false, clear: false }) as InputGuard
    expect(g).toBeTruthy()
    expect(g.direct, 'silme isteği olmadan doğrudan yol açılmamalı').toBeFalsy()
  })

  it('hedef kaymışsa (mustRetarget) doğrudan yol kapalı', () => {
    const g = inputGuardFor({ window: pencere, at: nokta, mustRetarget: true }, { visual: false, clear: true }) as InputGuard
    expect(g.direct).toBeFalsy()
  })

  it('tıklanmış nokta yoksa doğrudan yol kapalı', () => {
    const g = inputGuardFor({ window: pencere }, { visual: false, clear: true }) as InputGuard
    expect(g.direct).toBeFalsy()
  })

  it('bağ yoksa koruma üretilmez (worker kendi kararını verir)', () => {
    expect(inputGuardFor(undefined, { visual: true, clear: true })).toBeUndefined()
  })

  it('görsel kurtarma bayrağı aynen taşınır', () => {
    const g = inputGuardFor({ window: pencere, at: nokta }, { visual: true, clear: true }) as InputGuard
    expect(g.visual).toBe(true)
  })
})
