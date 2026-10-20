import { describe, expect, it } from 'vitest'
import { startCanvasSession } from '../electron/canvas-session'
import { createNode, type CanvasBook, type CanvasTab } from '../electron/graph-types'

const tab = (id: string, savedId?: string, name = 'Tuval'): CanvasTab => ({
  id, name, savedId, graph: { nodes: [createNode('start', 0, 0)], edges: [] },
} as unknown as CanvasTab)

const book = (tabs: CanvasTab[], recovery: CanvasTab[] = []): CanvasBook => ({ activeId: tabs[0]?.id ?? '', tabs, recovery } as unknown as CanvasBook)

describe('kurtarma taslakları: kimlikle tekilleştir, sessizce silme', () => {
  it('aynı KAYITLI tuvalin yeni oturumdaki kopyası eski taslağı EZER (tek kayıt)', () => {
    const first = startCanvasSession(book([tab('yeni-1', 'canvas-1')]))
    expect(first.recovery).toHaveLength(1)
    // Yeniden açılış: aynı kayıtlı tuval, yeni tab id'si.
    const second = startCanvasSession(book([tab('yeni-2', 'canvas-1')], first.recovery))
    expect(second.recovery).toHaveLength(1)
    expect(second.recovery?.[0].savedId).toBe('canvas-1')
  })

  it('AYNI ADLI iki kaydedilmemiş tuval birleştirilmez (ad kimlik değildir)', () => {
    const next = startCanvasSession(book([tab('a', undefined, 'Aynı ad'), tab('b', undefined, 'Aynı ad')]))
    expect(next.recovery).toHaveLength(2)
    expect(new Set(next.recovery?.map((r) => r.id))).toEqual(new Set(['a', 'b']))
  })

  it('kullanıcı taslakları sabit eşikle SİLİNMEZ', () => {
    const tabs = Array.from({ length: 25 }, (_, i) => tab(`t${i}`, `canvas-${i}`, `Tuval ${i}`))
    const next = startCanvasSession(book(tabs))
    expect(next.recovery).toHaveLength(25)
  })
})
