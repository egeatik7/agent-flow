import { describe, expect, it } from 'vitest'
import { startCanvasSession, MAX_RECOVERY_DRAFTS } from '../electron/canvas-session'
import { createNode, type CanvasBook, type CanvasTab } from '../electron/graph-types'

const tab = (id: string, savedId?: string, name = 'Tuval'): CanvasTab => ({
  id, name, savedId, graph: { nodes: [createNode('start', 0, 0)], edges: [] },
} as unknown as CanvasTab)

const book = (tabs: CanvasTab[], recovery: CanvasTab[] = []): CanvasBook => ({ activeId: tabs[0]?.id ?? '', tabs, recovery } as unknown as CanvasBook)

describe('kurtarma taslakları: sınırsız birikme yok', () => {
  it('aynı tuvalin yeni oturumdaki kopyası eski taslağı EZER (tek kayıt)', () => {
    const first = startCanvasSession(book([tab('yeni-1', 'canvas-1')]))
    expect(first.recovery).toHaveLength(1)
    // Yeniden açılış: aynı kayıtlı tuval, yeni tab id'si.
    const second = startCanvasSession(book([tab('yeni-2', 'canvas-1')], first.recovery))
    expect(second.recovery).toHaveLength(1)
    expect(second.recovery?.[0].savedId).toBe('canvas-1')
  })

  it('en yeni MAX_RECOVERY_DRAFTS taslak tutulur', () => {
    const tabs = Array.from({ length: MAX_RECOVERY_DRAFTS + 5 }, (_, i) => tab(`t${i}`, `canvas-${i}`, `Tuval ${i}`))
    const next = startCanvasSession(book(tabs))
    expect(next.recovery).toHaveLength(MAX_RECOVERY_DRAFTS)
    expect(next.tabs).toHaveLength(0)
  })
})
