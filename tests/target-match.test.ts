import { describe, expect, it } from 'vitest'
import type { ScreenItem } from '../electron/matcher'
import { clickableBy, normName, writableBy } from '../electron/target-match'

const item = (text: string, type: string, x = 0, y = 0, w = 100, h = 30): ScreenItem =>
  ({ id: `${text}-${x}-${y}`, text, type, src: 'uia', x, y, w, h }) as unknown as ScreenItem

describe('yazılı komutun hedefi', () => {
  it('tam ad eşleşmesi arar; kısmi eşleşme kabul etmez', () => {
    const items = [item('Kaydet', 'Button'), item('Kaydet ve kapat', 'Button')]
    expect(clickableBy(items, 'Kaydet')?.text).toBe('Kaydet')
    // Kısmi eşleşme yoktur: "Kayd" hiçbir şeyi seçmez (yanlış denetime basmaktansa bulamamak).
    expect(clickableBy(items, 'Kayd')).toBeUndefined()
    expect(clickableBy(items, 'Kaydet ve')).toBeUndefined()
  })

  it('aynı adlı birden fazla varsa ve tıklama bağlamı yoksa aday üretmez', () => {
    // İki ayrı uygulamada iki "New" düğmesi: ilkini seçmek yanlış uygulamaya basmak demektir.
    const items = [item('New', 'Button', 10, 10), item('New', 'Button', 900, 500)]
    expect(clickableBy(items, 'New')).toBeUndefined()
    // Tıklama bağlamı varsa en yakın olan seçilir.
    expect(clickableBy(items, 'New', { x: 905, y: 505 })?.x).toBe(900)
  })

  it('gerçek denetimi yazı etiketine yeğler', () => {
    const items = [item('Devam', 'Text', 0, 0), item('Devam', 'Button', 300, 200)]
    expect(clickableBy(items, 'Devam')?.type).toBe('Button')
  })

  it('yazma için yalnız yazılabilir öğe kabul edilir', () => {
    const items = [item('Kaynak klasör', 'Text'), item('Kaynak klasör', 'Edit', 50, 60)]
    expect(writableBy(items, 'Kaynak klasör')?.type).toBe('Edit')
    // Yalnız etiket varsa yazma hedefi yoktur: yanlış yere yazmaktansa bulamamak doğrudur.
    expect(writableBy([item('Kaynak klasör', 'Text')], 'Kaynak klasör')).toBeUndefined()
    // İki alan ve bağlam yoksa yine aday üretilmez.
    const two = [item('Ad', 'Edit', 0, 0), item('Ad', 'Edit', 500, 500)]
    expect(writableBy(two, 'Ad')).toBeUndefined()
    expect(writableBy(two, 'Ad', { x: 10, y: 10 })?.x).toBe(0)
  })

  it('adı Türkçe küçük harfe göre normalleştirir', () => {
    expect(normName('  Kaynak   Klasör ')).toBe('kaynak klasör')
    expect(clickableBy([item('KAYNAK KLASÖR', 'Edit')], 'kaynak klasör')?.type).toBe('Edit')
  })
})
