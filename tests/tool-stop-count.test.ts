import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph } from '../electron/graph-types'
import { beginRun, endRun, noteStep, noteUserStop, snapshot } from '../electron/tool-state'

describe('durdurma, hatadan ayrı sayılır (CLAUDE.md §4)', () => {
  it('kullanıcı durdurduysa adım "durduruldu" sayılır, hata sayılmaz', () => {
    const g: AgentGraph = { nodes: [createNode('start', 0, 0)], edges: [] }
    beginRun(g)
    noteUserStop()
    // Motor, durdurulan adım için "error" olayı yayıyor: canlı koşuda tam olarak bu görüldü ve
    // araç katmanı bunu "1 hata" diye raporluyordu.
    noteStep({ id: 'n1', status: 'error' })
    expect(snapshot().stopped).toBe(1)
    expect(snapshot().observed.errors).toBe(0)
    endRun({ ok: false, stopped: true })
  })

  it('durdurma yoksa hata hata sayılır ve yeni koşu sayacı sıfırlar', () => {
    const g: AgentGraph = { nodes: [createNode('start', 0, 0)], edges: [] }
    beginRun(g)
    noteStep({ id: 'n1', status: 'error' })
    expect(snapshot().observed.errors).toBe(1)
    expect(snapshot().stopped).toBe(0)
    endRun({ ok: false })
    beginRun(g)
    expect(snapshot().stopped).toBe(0)
    expect(snapshot().observed.errors).toBe(0)
  })
})
