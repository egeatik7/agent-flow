import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode, type AppSettings } from '../electron/graph-types'
import { contextOf, findPlace, walkGraph } from '../electron/tool-context'
import { callTool, toolList, type ToolContext } from '../electron/tools'

let seq = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `e${++seq}`, from: from.id, fromPort, to: to.id })

/** Başlangıç → Her Öğe İçin (g1, g2) → [Paket → içi: Başlangıç → Tıkla] */
function fixture() {
  const root = createNode('start', 0, 0)
  const loop = createNode('loop', 200, 100)
  loop.title = 'Gruplar'
  loop.items = ['g1', 'g2']
  const pkg = createNode('package', 300, 150)
  pkg.title = 'Blender'
  const innerStart = createNode('start', 0, 0)
  const click = createNode('click', 100, 0)
  click.prompt = 'Kaydet'
  pkg.inner = { nodes: [innerStart, click], edges: [edge(innerStart, 'next', click)] }
  loop.members = [pkg.id]
  const graph: AgentGraph = { nodes: [root, loop, pkg], edges: [edge(root, 'next', loop)] }
  return { graph, loop, pkg, click }
}

function ctx(graph: AgentGraph): ToolContext {
  return {
    getGraph: () => graph,
    getSettings: () => ({}) as AppSettings,
    log: () => {},
    isRunning: () => false,
  }
}

describe('akış okuma: paket ve döngü bağlamı', () => {
  it('paketin içindeki node, paketin bağlı olduğu kutuyu da görür', () => {
    const { graph, pkg, loop, click } = fixture()
    const place = findPlace(graph, click.id)
    expect(place?.packagePath).toEqual([pkg.id])
    expect(place?.loops.map((l) => l.id)).toEqual([loop.id])
  })

  it('döngü işaretini ve çözülmüş değişkenleri verir', () => {
    const { graph, loop, click } = fixture()
    const first = contextOf(graph, click.id)
    expect(first?.loop?.item).toBe('g1')
    expect(first?.loop?.index).toBe(0)
    expect(first?.loop?.total).toBe(2)
    expect(first?.loop?.vars?.['oge']).toBe('g1')
    expect(first?.loop?.vars?.['oge.isim']).toBe('g1')
    expect(first?.loop?.vars?.['sira']).toBe('1')

    loop.startIndex = 1
    const second = contextOf(graph, click.id)
    expect(second?.loop?.item).toBe('g2')
    expect(second?.loop?.vars?.['sira']).toBe('2')
  })

  it('her node’u bir kez gezer, paketlerin içi dahil', () => {
    const { graph } = fixture()
    const seen: string[] = []
    walkGraph(graph, ({ node }) => seen.push(node.id))
    expect(seen).toHaveLength(5)
    expect(new Set(seen).size).toBe(5)
  })
})

describe('araç katmanı', () => {
  it('akışı okur ve sayıları söyler', async () => {
    const { graph } = fixture()
    const r = await callTool('flow.read', { graph }, ctx(graph))
    expect(r.ok).toBe(true)
    expect(r.outcome).toBe('tamam')
    expect(r.message).toContain('paket')
    expect((r.data?.nodes as unknown[]).length).toBe(5)
    expect((r.data?.loops as unknown[]).length).toBe(1)
    expect((r.data?.packages as unknown[]).length).toBe(1)
  })

  it('bilinmeyen aracı ve henüz hazır olmayanı açıkça reddeder', async () => {
    const { graph } = fixture()
    const unknown = await callTool('yok.boyle', {}, ctx(graph))
    expect(unknown.ok).toBe(false)
    expect(unknown.message).toContain('Bilinmeyen')
    const planned = await callTool('step.run', { nodeId: 'x' }, ctx(graph))
    expect(planned.ok).toBe(false)
    expect(planned.message).toContain('hazır değil')
  })

  it('önizleme, eksik nodeId ve bilinmeyen node için motoru yüklemeden cevap verir', async () => {
    const { graph } = fixture()
    const missing = await callTool('target.preview', {}, ctx(graph))
    expect(missing.ok).toBe(false)
    expect(missing.message).toContain('nodeId')
    const bogus = await callTool('target.preview', { nodeId: 'yok-boyle-node' }, ctx(graph))
    expect(bogus.ok).toBe(false)
    expect(bogus.message).toContain('bulunamadı')
  })

  it('katalog hem hazır hem sıradaki araçları listeler', () => {
    const list = toolList()
    const names = list.map((t) => t.name)
    expect(names).toContain('target.preview')
    expect(names).toContain('flow.read')
    expect(names).toContain('step.run')
    expect(list.find((t) => t.name === 'target.preview')?.ready).toBe(true)
    expect(list.find((t) => t.name === 'step.run')?.ready).toBe(false)
    expect(list.find((t) => t.name === 'step.run')?.sendsInput).toBe(true)
  })
})
