import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode } from '../electron/graph-types'
import { runGraph, type Executor } from '../electron/runner'

let edgeNo = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `id${++edgeNo}`, from: from.id, fromPort, to: to.id })
const opts = { maxSteps: 200, stepDelayMs: 0 }

/**
 * #2 — "Aynı dosyadan devam" kimliğe dayanmalı.
 *
 * Hata kaydındaki öğe "b.glb" idi. Koşu sırasında klasör yeniden okunur ve listenin başına "a.glb"
 * eklenmişse, kayıtlı İNDEKS artık başka bir dosyayı gösterir: motor a.glb ile başlar. Doğrusu:
 * kayıtlı ÖĞENİN kendisi yeni listede bulunup ondan devam edilir.
 */
describe('#2 devam kimliği', () => {
  function listGraph(items: string[]): { graph: AgentGraph; click: AgentNode; loop: AgentNode } {
    const start = createNode('start', 0, 0)
    const click = createNode('click', 200, 100)
    click.title = 'Yaz'
    click.prompt = '{{öğe}}'
    const loop = createNode('loop', 150, 50)
    loop.title = 'Dosyalar'
    loop.items = items
    loop.members = [click.id]
    const graph: AgentGraph = { nodes: [start, loop, click], edges: [edge(start, 'next', loop)] }
    return { graph, click, loop }
  }

  it('liste değişse de kayıtlı ÖĞEDEN devam eder (indeksten değil)', async () => {
    // Motorun koşu sırasında klasörü yeniden okuduğu durum: liste başına a.glb eklendi.
    const { graph, click, loop } = listGraph(['a.glb', 'b.glb', 'c.glb'])
    loop.startIndex = 0 // hata anında kayıtlı indeks: 0 → eskiden a.glb'ye denk geliyordu

    const yazilan: string[] = []
    const ex: Executor = {
      log: () => {},
      step: () => {},
      shouldStop: () => false,
      click: async (node: AgentNode) => {
        yazilan.push(node.prompt ?? '')
      },
      type: async () => {},
      key: async () => {},
      exists: async () => true,
    }

    await runGraph(graph, ex, { ...opts, resume: true, startId: click.id, resumeLoopId: loop.id, resumeItem: 'b.glb' } as never)

    expect(yazilan, `yanlış dosyadan başladı: ${JSON.stringify(yazilan)}`).toEqual(['b.glb', 'c.glb'])
  })

  it('kayıtlı öğe yeni listede yoksa uydurmaz, açıkça söyler', async () => {
    const { graph, click, loop } = listGraph(['a.glb', 'c.glb'])
    const ex: Executor = {
      log: () => {},
      step: () => {},
      shouldStop: () => false,
      click: async () => {},
      type: async () => {},
      key: async () => {},
      exists: async () => true,
    }
    let hata = ''
    try {
      await runGraph(graph, ex, { ...opts, resume: true, startId: click.id, resumeLoopId: loop.id, resumeItem: 'b.glb' } as never)
    } catch (e) {
      hata = (e as Error).message
    }
    expect(hata, 'kayıtlı öğe listede yokken sessizce başka dosyadan başladı').toMatch(/b\.glb/)
  })
})
