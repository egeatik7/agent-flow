import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode } from '../electron/graph-types'
import { runGraph, type Executor } from '../electron/runner'

let edgeNo = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `nl${++edgeNo}`, from: from.id, fromPort, to: to.id })
const opts = { maxSteps: 200, stepDelayMs: 0 }

/**
 * #3 — İç içe döngüden devam.
 *
 * Dış kutu iki öğe (x, y), iç kutu üç tur. Koşu iç kutunun 2. turundan başlatılır (resume).
 * Beklenen: iç 2 → iç 3 → dış öğe x biter → dış öğe y'nin bütün turları. Dış öğe değişkeni
 * metinde kalmamalı ({{öğe}} çözülmeli).
 *
 * Ölçülen kusur: yalnız en içteki kutu çalışıyor; dış kutunun değişkenleri kurulmadığı için
 * tıklama metni "{{öğe}}" olarak kalıyor ve dış kutunun kalan öğesi (y) hiç çalışmıyor.
 */
describe('#3 iç içe döngüden devam', () => {
  function nested(): { graph: AgentGraph; inner: AgentNode; click: AgentNode } {
    const start = createNode('start', 0, 0)
    const click = createNode('click', 300, 200)
    click.title = 'Yaz'
    click.prompt = '{{öğe}}'
    const inner = createNode('loop', 250, 150)
    inner.title = 'İç'
    inner.count = 3
    inner.members = [click.id]
    const outer = createNode('loop', 200, 100)
    outer.title = 'Dış'
    outer.items = ['x', 'y']
    outer.members = [inner.id]
    const graph: AgentGraph = { nodes: [start, outer, inner, click], edges: [edge(start, 'next', outer), edge(inner, 'next', click)] }
    return { graph, inner, click }
  }

  it('iç kutunun işaretinden devam eder, dış öğe değişkeni çözülür ve kalan dış öğe atlanmaz', async () => {
    const { graph, inner, click } = nested()
    // Hata anındaki işaretler: dış 1. öğe (x), iç 2. tur.
    const dis = graph.nodes.find((n) => n.kind === 'loop' && n.title === 'Dış') as AgentNode
    dis.startIndex = 0
    inner.startIndex = 1

    const tiklanan: string[] = []
    const ex: Executor = {
      log: () => {},
      step: () => {},
      shouldStop: () => false,
      click: async (node: AgentNode) => {
        tiklanan.push(node.prompt ?? '')
      },
      type: async () => {},
      key: async () => {},
      exists: async () => true,
    }

    await runGraph(graph, ex, { ...opts, resume: true, startId: click.id })

    // Dış öğe değişkeni hiçbir tıklamada ham kalmamalı.
    expect(tiklanan.filter((t) => t.includes('{{')), `dış değişken çözülmedi: ${JSON.stringify(tiklanan)}`).toEqual([])
    // İç 2 ve 3 (x öğesi), ardından y öğesinin bütün turları: 2 + 3 = 5 tıklama.
    // İç içe döngüde {{öğe}} en içteki öğedir (mevcut sözleşme). Doğru sıra: iç 2,3 (dış öğe x),
    // ardından iç 1,2,3 (dış öğe y) — yani dış kutunun kalan öğesi ATLANMIYOR.
    expect(tiklanan, `iç içe devam yanlış: ${JSON.stringify(tiklanan)}`).toEqual(['2', '3', '1', '2', '3'])
  })
})
