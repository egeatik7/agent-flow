import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../electron/graph-types'
import { DEFAULT_FIND_OFF, activeFindOrder, normalizeFind } from '../electron/llm-flow'

/**
 * U04 (yönerge) — `findOff` varsayılanları çelişiyordu.
 *
 * Ölçülen kusur: `llm-flow.ts` `DEFAULT_FIND_OFF = []` ("hiçbir aşama varsayılan olarak kapalı değil",
 * 1.9.29 notu) derken `graph-types.ts` ayar varsayılanı `findOff: ['list']` idi. Yeni kurulumda ayarlar
 * bu varsayılanla yazıldığı için "Kelime listesi → yazı modeli" aşaması FİİLEN KAPALI başlıyordu ve
 * `main.ts` içindeki `findOff === undefined ? DEFAULT_FIND_OFF : …` dalı ölü kalıyordu; panelin
 * "varsayılana dön" davranışı ise `[]` yazdığı için iki varsayılan birbiriyle çelişiyordu.
 */
describe('U04: findOff tek varsayılan kaynağa bağlı', () => {
  it('ayar varsayılanı ile DEFAULT_FIND_OFF aynıdır (yeni kurulumda hiçbir aşama kapalı değil)', () => {
    expect(DEFAULT_SETTINGS.findOff).toEqual(DEFAULT_FIND_OFF)
    expect(DEFAULT_SETTINGS.findOff).toEqual([])
  })

  it('"list" aşaması yeni kurulumda AKTİF sırada kalır (eski hata: kapalıydı)', () => {
    const { off } = normalizeFind(DEFAULT_SETTINGS.findOrder, DEFAULT_SETTINGS.findOff)
    const aktif = activeFindOrder(DEFAULT_SETTINGS.findOrder, off)
    expect(aktif).toContain('list')
    expect(off).not.toContain('list')
  })

  it('kullanıcının KAYITLI tercihi korunur (boş dizi ≠ alanın olmaması)', () => {
    // Kullanıcı listenin kullanılmamasını seçmişse bu tercih aynen geçerli.
    const kapali = normalizeFind(DEFAULT_SETTINGS.findOrder, ['list'])
    expect(activeFindOrder(DEFAULT_SETTINGS.findOrder, kapali.off)).not.toContain('list')
    // Bilinçli boş dizi de "hiçbiri kapalı değil" demektir; undefined ile aynı sayılmaz.
    const acik = normalizeFind(DEFAULT_SETTINGS.findOrder, [])
    expect(activeFindOrder(DEFAULT_SETTINGS.findOrder, acik.off)).toContain('list')
    expect(activeFindOrder(DEFAULT_SETTINGS.findOrder, open(DEFAULT_SETTINGS.findOrder).off)).toContain('list')
  })
})

/** `findOff` alanı olmayan kayıtlı ayar: main'in `findOff === undefined` dalına karşılık gelir. */
function open(order: readonly string[]) {
  const { off } = normalizeFind(order as never, DEFAULT_FIND_OFF)
  return { off }
}
