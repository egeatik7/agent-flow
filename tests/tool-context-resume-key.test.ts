import { describe, expect, it } from 'vitest'
import { createNode, loopKeys, type AgentGraph } from '../electron/graph-types'
import { chainOf } from '../electron/tool-context'

/**
 * O16 (yönerge) — araç katmanı sayaç kutusunda motorun GERÇEK anahtarını göstermeli.
 *
 * Ölçülen kusur: `tool-context.ts` sayısal (liste/klasör değil) kutu için `String(index + 1)` = "3"
 * veriyordu; motorun kendisi (`loopKeys`, graph-types.ts:588) sayaç kutusunda "#1".."#N" üretir. Bu yüzden
 *   (1) ajanın gördüğü `{{öğe}}` ile koşan değer farklıydı,
 *   (2) hatadan devamda `resumeItem = "3"` motorun listesinde bulunamıyor (`indexOf("3") = -1`) ve devam
 *       koşusu hata ile bitiyordu.
 */
const kutu = (kutuAlanlari: Record<string, unknown>) => ({ ...createNode('loop', 0, 0), id: 'kutu', title: 'Kutu', members: ['ic'], ...kutuAlanlari }) as never
const graf = (kutuAlanlari: Record<string, unknown>): AgentGraph =>
  ({ version: 3, nodes: [kutu(kutuAlanlari), { ...createNode('click', 0, 0), id: 'ic', title: 'İç' } as never], edges: [], packages: [] }) as unknown as AgentGraph

describe('O16: sayaç kutusunda devam anahtarı motorla aynı', () => {
  it('motor sayaç kutusunda #1..#N üretir (tek kaynak)', () => {
    expect(loopKeys({ ...createNode('loop', 0, 0), count: 3 } as never)).toEqual(['#1', '#2', '#3'])
  })

  it('araç katmanı sayaç kutusunda AYNI anahtarı gösterir (eski hata: "1")', () => {
    const zincir = chainOf(graf({ count: 5 }), 'ic')
    expect(zincir).toHaveLength(1)
    expect(zincir[0].item).toBe('#1') // ESKİ HATA: '1' idi
  })

  it('gerçek liste kutusunda dosya adı korunur ("3" varsa "#3"e çevrilmez)', () => {
    const zincir = chainOf(graf({ items: ['3', 'b.glb'] }), 'ic')
    expect(zincir[0].item).toBe('3')
  })

  it('klasör kutusunda liste henüz boşsa öğe bilinmiyor denir (uydurulmaz)', () => {
    const zincir = chainOf(graf({ folder: 'C:\\Klasor' }), 'ic')
    expect(zincir[0].item).toBeUndefined()
  })
})
