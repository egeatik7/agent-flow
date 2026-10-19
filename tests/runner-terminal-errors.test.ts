import { describe, expect, it, vi } from 'vitest'
import { createNode, type AgentGraph } from '../electron/graph-types'
import { runGraph, ConditionUndecidedError, newTally, type Executor } from '../electron/runner'
import { repeatMethodCycle } from '../electron/method-cycle'

const ex = (overrides: Partial<Executor> = {}): Executor => ({
  log: () => {}, step: () => {}, shouldStop: () => false,
  click: async () => {}, type: async () => {}, key: async () => {}, exists: async () => false,
  ...overrides,
})
const opts = { maxSteps: 20, stepDelayMs: 0, reportEnd: true }

describe('eylem dışı node hataları kalıcıdır (sonsuz tur yok)', () => {
  it('boş koşul metni koşuyu kilitlmez: açık hatayla biter', async () => {
    const condition = createNode('condition', 0, 0); condition.text = ''
    const pending = runGraph({ nodes: [condition], edges: [] }, ex(), opts)
    await expect(pending).rejects.toThrow('koşul için ne aradığını yaz')
  })

  it('kaldırılmış node türü açık hatayla biter, yeniden denenmez', async () => {
    const legacy = { ...createNode('click', 0, 0), kind: 'waitFile' as const, title: 'Dosya bekle' }
    await expect(runGraph({ nodes: [legacy], edges: [] }, ex(), opts)).rejects.toThrow('artık desteklenmiyor')
  })

  it('paket iç grafı hata verince paket BAŞTAN oynatılmaz (tıklama bir kez denenir)', async () => {
    const start = createNode('start', 0, 0), end = createNode('end', 0, 0), pkg = createNode('package', 0, 0)
    const inner = createNode('click', 0, 0); inner.title = 'Oluştur'; inner.prompt = 'Oluştur'
    pkg.inner = { nodes: [inner], edges: [] }
    const graph: AgentGraph = {
      nodes: [start, pkg, end],
      edges: [{ id: 'e1', from: start.id, fromPort: 'next', to: pkg.id }, { id: 'e2', from: pkg.id, fromPort: 'next', to: end.id }],
    }
    const click = vi.fn(async () => { throw new Error('pencere kapandı') })
    // Eylem türü olduğu için kurtarma aşamasına düşer; kurtarma "failed" derse paket yeniden
    // oynatılmaz, hata tek kez yukarı çıkar.
    await expect(runGraph(graph, ex({ click, recover: async () => 'failed' }), opts)).rejects.toThrow('pencere kapandı')
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('paket içinde yarım kalan koşul, Bitir’e gidilse de "tamamlandı" sayılmaz', async () => {
    const start = createNode('start', 0, 0), end = createNode('end', 0, 0), pkg = createNode('package', 0, 0)
    const inner = createNode('condition', 0, 0); inner.text = 'Hazır mı?'
    pkg.inner = { nodes: [inner], edges: [] }
    const graph: AgentGraph = {
      nodes: [start, pkg, end],
      edges: [{ id: 'e1', from: start.id, fromPort: 'next', to: pkg.id }, { id: 'e2', from: pkg.id, fromPort: 'next', to: end.id }],
    }
    const summary = await runGraph(graph, ex({ exists: async () => false }), opts)
    expect(summary.reachedEnd).toBe(true)
    expect(summary.incomplete).toBe(true)
  })

  it('paket içi hata her katmanda yeniden sayılmaz (failed=1)', async () => {
    const start = createNode('start', 0, 0), end = createNode('end', 0, 0), pkg = createNode('package', 0, 0)
    const ai = createNode('ai', 0, 0); ai.prompt = 'bir şey yap'
    pkg.inner = { nodes: [ai], edges: [] }
    const graph: AgentGraph = {
      nodes: [start, pkg, end],
      edges: [{ id: 'e1', from: start.id, fromPort: 'next', to: pkg.id }, { id: 'e2', from: pkg.id, fromPort: 'next', to: end.id }],
    }
    const tally = newTally()
    // Yap "başarısız" derse 'fail' çıkışı bağlı değildir → paket içi StepFailedError (ölümcül değil).
    await expect(runGraph(graph, ex({ initiative: async () => false }), { ...opts, tally })).rejects.toThrow()
    expect(tally.stepFailures).toBe(1)
    expect(tally.failed).toBe(0)
  })

  it('yonlem turu maxRounds verilince sınırda hatayı yukarı verir', async () => {
    let attempts = 0
    const retried = vi.fn()
    await expect(repeatMethodCycle(async () => { attempts++; throw new Error('okuyucu hatası') }, {
      check: () => {}, wait: async () => {}, retry: retried, maxRounds: 3,
    })).rejects.toThrow('okuyucu hatası')
    expect(attempts).toBe(3)
    expect(retried).toHaveBeenCalledTimes(2)
  })

  it('maxRounds verilmezse eski davranış korunur (sınırsız tur)', async () => {
    let attempts = 0
    const result = await repeatMethodCycle(async () => { if (++attempts < 5) throw new Error('geçici'); return 'tamam' }, {
      check: () => {}, wait: async () => {}, retry: () => {},
    })
    expect(result).toBe('tamam')
    expect(attempts).toBe(5)
  })
})
