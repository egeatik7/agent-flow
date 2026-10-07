import { describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createNode, type AgentGraph, type AgentNode } from '../electron/graph-types'
import { runGraph, type Executor } from '../electron/runner'

let edgeNo = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `le${++edgeNo}`, from: from.id, fromPort, to: to.id })
const opts = { maxSteps: 400, stepDelayMs: 0 }
const YOK = 'C:\\nubbo-kabul-yok-boyle-klasor'

function exYap(olaylar: string[], loglar: string[]): Executor {
  return {
    log: (level, message) => loglar.push(`${level}: ${message}`),
    step: (id, status) => olaylar.push(`${id}:${status}`),
    shouldStop: () => false,
    click: async () => {},
    type: async () => {},
    key: async () => {},
    exists: async () => true,
  }
}

/** Dış kutu (öğeler) → iç kutu (klasör = {{öğe}}, üyesi: bekle) → … */
function icIce(items: string[], icCikisVar: boolean) {
  const start = createNode('start', 0, 0)
  const bekle = createNode('wait', 260, 120)
  bekle.ms = 1
  const ic = createNode('loop', 150, 90)
  ic.title = 'İç'
  ic.folder = '{{öğe}}'
  ic.members = [bekle.id]
  const dis = createNode('loop', 80, 40)
  dis.title = 'Dış'
  dis.items = items
  dis.members = [ic.id]
  const end = createNode('end', 400, 0)
  const edges = [edge(start, 'next', dis), edge(dis, 'done', end)]
  if (icCikisVar) edges.push(edge(ic, 'done', end))
  return { graph: { nodes: [start, dis, ic, bekle, end], edges } as AgentGraph, dis, ic, bekle }
}

describe('döngü hataları: araç katmanının görebilmesi ve durması', () => {
  it('#1 tur içinde fırlatılan hata, kutunun kendisi için ERROR adım olayı üretir', async () => {
    const { graph, ic } = icIce([YOK], true)
    const olaylar: string[] = []
    const loglar: string[] = []
    await runGraph(graph, exYap(olaylar, loglar), opts)
    const hatalar = olaylar.filter((x) => x === `${ic.id}:error`)
    expect(
      hatalar.length,
      `kutu hatası adım olayı olarak bildirilmedi (araç katmanı 0 hata sayar): ${JSON.stringify(olaylar)}`
    ).toBeGreaterThan(0)
  })

  it('#2 aynı hata kümesi tekrar ederse döngü DURUR (yüzlerce geçiş tükenmez)', async () => {
    // Kendine dönen bir kutu: her geçiş aynı hatayı üretir. Koruma olmadan sonsuz döner.
    const { graph, dis } = icIce([YOK], true)
    // Kutunun çıkışını kendine bağla: aynı öğe kümesi tekrar tekrar denenir.
    graph.edges = graph.edges.filter((e) => !(e.from === dis.id && e.fromPort === 'done'))
    graph.edges.push(edge(dis, 'done', dis))
    const olaylar: string[] = []
    const loglar: string[] = []
    let hata = ''
    try {
      await runGraph(graph, exYap(olaylar, loglar), { ...opts, debug: true })
    } catch (e) {
      hata = (e as Error).message
    }
    const gecis = olaylar.filter((x) => x === `${dis.id}:running`).length
    expect(gecis, `kutu ${gecis} kez çalıştı; aynı hata tekrarında durmalıydı`).toBeLessThanOrEqual(2)
    expect(loglar.join(' '), 'tekrar durdurulduğu kayda geçmedi').toMatch(/tekrar|aynı hata/i)
    void hata
  })

  it('#3 kutunun çıkışı gerçekten izlenir (doğru port) — Bitir çalışır, kutu tekrar başlamaz', async () => {
    const kucuk = path.join(os.tmpdir(), 'nubbo-test-kucuk')
    const { graph, dis } = icIce([kucuk], true) // var olan KÜÇÜK klasör (tek dosya)
    const olaylar: string[] = []
    const loglar: string[] = []
    await runGraph(graph, exYap(olaylar, loglar), opts)
    const kutuCalisma = olaylar.filter((x) => x === `${dis.id}:running`).length
    expect(kutuCalisma, `dış kutu ${kutuCalisma} kez çalıştı (1 olmalı; çıkış izlenmiyorsa başa döner)`).toBe(1)
    const bitti = graph.nodes.find((n) => n.kind === 'end') as AgentNode
    expect(loglar.join(' ')).toContain('bitti')
    void bitti
  })
})
