import { describe, expect, it } from 'vitest'
import { parseTars } from '../electron/openrouter'

// UI-TARS 1.5 answers in pixels of the picture it saw. İnisiyatif sends that picture at 1288x728 (under one megapixel,
// a multiple of 28) whatever the display scale, so the same answer must hit the same spot of the screen at any scale.
const answer = (x: number, y: number) => `Thought: tıkla\nAction: click(start_box='(${x},${y})')`

describe('UI-TARS mutlak koordinat → ekran', () => {
  it('resmin ortası, hangi ekran ölçeğinde olursa olsun ekranın ortasıdır', () => {
    const a = parseTars(answer(644, 364), 1288, 728, true) as { x: number; y: number }
    expect(a.x).toBeCloseTo(0.5, 5)
    expect(a.y).toBeCloseTo(0.5, 5)
    // area.x + x * area.w, as agent.ts does it, for the same desktop at 100%, 125%, 150%
    for (const [w, h] of [[1920, 1080], [2400, 1350], [2880, 1620]]) {
      expect(Math.round(a.x * w) / w).toBeCloseTo(0.5, 3)
      expect(Math.round(a.y * h) / h).toBeCloseTo(0.5, 3)
    }
  })

  it('sağ alt köşeye yakın nokta sağ alt köşeye yakın kalır', () => {
    const a = parseTars(answer(1200, 700), 1288, 728, true) as { x: number; y: number }
    expect(a.x).toBeCloseTo(1200 / 1288, 5)
    expect(a.y).toBeCloseTo(700 / 728, 5)
  })

  it('resim boyutu gerçek ekranla değil modele gönderilen boyutla bölünür (eski hata: 1920x1080 ile bölünüyordu)', () => {
    const sent = parseTars(answer(644, 364), 1288, 728, true) as { x: number }
    const wrong = parseTars(answer(644, 364), 1920, 1080, true) as { x: number }
    expect(sent.x).toBeCloseTo(0.5, 5)
    expect(wrong.x).toBeLessThan(0.4) // tam çözünürlük sanılınca tıklama sola kayar
  })
})
