import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNode, type AgentGraph, type AgentNode } from '../electron/graph-types'
import { runGraph, ConditionUndecidedError, type Executor } from '../electron/runner'

const opts = { maxSteps: 50, stepDelayMs: 0, reportEnd: true }
let seq = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `nb${++seq}`, from: from.id, fromPort, to: to.id })
const ex = (over: Partial<Executor> = {}): Executor => ({
  log: () => {}, step: () => {}, shouldStop: () => false,
  click: async () => {}, type: async () => {}, key: async () => {}, exists: async () => false, ...over,
})

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('yeni sınırlar: sonsuz tur yok, sessiz başarı yok', () => {
  it('koşulda ham executor hatası (eksik anahtar) sınırlı turdan sonra yukarı verilir', async () => {
    const condition = createNode('condition', 0, 0); condition.text = 'Hazır mı?'
    const pending = runGraph({ nodes: [condition], edges: [] }, ex({ exists: async () => { throw new Error('API anahtarı yok') } }), opts)
    const checked = expect(pending).rejects.toThrow('API anahtarı yok')
    await vi.advanceTimersByTimeAsync(20000)
    await checked
  })

  it('kutu içinde karar verilemeyen koşul öğeyi sessizce tamamlandı saymaz', async () => {
    const start = createNode('start', 0, 0), end = createNode('end', 0, 0), loop = createNode('loop', 0, 0)
    loop.items = ['tek']; const condition = createNode('condition', 0, 0); condition.text = 'GLB indi mi?'
    loop.members = [condition.id]
    const graph: AgentGraph = { nodes: [start, loop, condition, end], edges: [edge(start, 'next', loop), edge(loop, 'done', end)] }
    const summary = await runGraph(graph, ex({ exists: async () => { throw new ConditionUndecidedError('okuyucu hatası') } }), opts)
    expect(summary.failed).toBe(1)
    expect(summary.reachedEnd).toBe(true)
  })

  it('eksik klasör kutusu sonsuz beklemez: sınırlı turdan sonra hata', async () => {
    const start = createNode('start', 0, 0), end = createNode('end', 0, 0), loop = createNode('loop', 0, 0)
    const ic = createNode('click', 0, 0); ic.prompt = 'Oluştur'
    // Şablonlu klasör: dışarıda onu besleyen bir kutu yok → kalıcı kurulum hatası.
    loop.folder = '{{öğe}}\\GLB'; loop.members = [ic.id]
    const graph: AgentGraph = { nodes: [start, loop, ic, end], edges: [edge(start, 'next', loop), edge(loop, 'done', end)] }
    const pending = runGraph(graph, ex(), opts)
    const checked = expect(pending).rejects.toThrow(/klasör yok|klasör okunamadı/)
    await vi.advanceTimersByTimeAsync(20000)
    await checked
  })
})
