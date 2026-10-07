import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode, type AppSettings, type CanvasBook } from '../electron/graph-types'
import { callTool, type ToolContext } from '../electron/tools'
import { beginRun, endRun, beginProbe, endProbe } from '../electron/tool-state'

let seq = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `fr${++seq}`, from: from.id, fromPort, to: to.id })

function fixture() {
  const root = createNode('start', 0, 0)
  const wait = createNode('wait', 200, 0)
  wait.ms = 500
  const graph: AgentGraph = { nodes: [root, wait], edges: [edge(root, 'next', wait)] }
  return { graph, root, wait }
}

function ctx(graph: AgentGraph): ToolContext {
  let book: CanvasBook = { activeId: 'c1', tabs: [{ id: 'c1', name: 'Tuval', graph }] }
  const base: ToolContext = {
    getGraph: () => graph,
    getSettings: () => ({ agentPermission: 'auto', screenCheck: 'log' }) as AppSettings,
    log: () => {},
    isRunning: () => false,
    userStop: () => false,
    sendStep: () => {},
    permission: () => 'auto',
    askApproval: async () => true,
    requestStop: () => {},
    startRun: async () => ({ ok: true }),
    getCanvases: () => structuredClone(book),
    saveCanvases: (next) => {
      book = structuredClone(next)
    },
    applyMerge: async () => ({ ok: true }),
  }
  return base
}

describe('flow.read branch farkındalığı', () => {
  it('branchId verilince TÜRETİLMİŞ grafik okunur: eklenen node’un gerçek id’si görünür', async () => {
    const f = fixture()
    const h = ctx(f.graph)
    const created = await callTool('branch.create', { name: 'Okuma sınaması' }, h)
    const bid = String(created.data?.branchId)
    // Eklenen node'un id'si ancak uygulandıktan sonra belli olur.
    const edited = await callTool(
      'flow.edit',
      { branchId: bid, ops: [{ op: 'addNode', key: 'x', kind: 'click', fields: { prompt: 'YOK-BU-YAZI-ASLA-YOK', title: 'Sınama · tık' } }] },
      h
    )
    expect(edited.outcome).toBe('tamam')
    const read = await callTool('flow.read', { branchId: bid }, h)
    const nodes = (read.data?.nodes ?? []) as { id: string; title: string }[]
    const bulunan = nodes.find((n) => String(n.title).includes('Sınama'))
    expect(bulunan, `eklenen node branch okumasında görünmüyor: ${JSON.stringify(nodes.map((n) => n.title))}`).toBeTruthy()
    expect(String(bulunan?.id)).toMatch(/^nbg/)
    expect(String(read.message)).toContain('branch')
  })

  it('branchId verilmezse kayıtlı tuval okunur (eklenen node görünmez)', async () => {
    const f = fixture()
    const h = ctx(f.graph)
    const created = await callTool('branch.create', { name: 'Okuma sınaması 2' }, h)
    const bid = String(created.data?.branchId)
    await callTool('flow.edit', { branchId: bid, ops: [{ op: 'addNode', key: 'x', kind: 'wait', fields: { ms: 100, title: 'Sınama · bekle' } }] }, h)
    const read = await callTool('flow.read', {}, h)
    const nodes = (read.data?.nodes ?? []) as { title: string }[]
    expect(nodes.some((n) => String(n.title).includes('Sınama'))).toBe(false)
  })

  it('bilinmeyen branch dürüstçe reddedilir', async () => {
    const f = fixture()
    const h = ctx(f.graph)
    const r = await callTool('flow.read', { branchId: 'yok' }, h)
    expect(r.ok).toBe(false)
    expect(String(r.message)).toContain('Branch bulunamadı')
    void beginRun
    void endRun
    void beginProbe
    void endProbe
  })
})
