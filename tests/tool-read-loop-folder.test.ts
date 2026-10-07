import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode, type AppSettings, type CanvasBook } from '../electron/graph-types'
import { callTool, type ToolContext } from '../electron/tools'

let seq = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `rf${++seq}`, from: from.id, fromPort, to: to.id })

function fixture() {
  const root = createNode('start', 0, 0)
  const loop = createNode('loop', 200, 0)
  loop.title = 'Klasör sınaması'
  loop.items = ['bir', 'iki']
  const graph: AgentGraph = { nodes: [root, loop], edges: [edge(root, 'next', loop)] }
  return { graph, loop }
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

describe('flow.read kutu öğesi dürüstlüğü', () => {
  it('liste tabanlıda öğeyi gösterir, klasör verilince UYDURMAZ', async () => {
    const f = fixture()
    const h = ctx(f.graph)
    const bid = String((await callTool('branch.create', { name: 'K' }, h)).data?.branchId)

    const r1 = await callTool('flow.read', { branchId: bid }, h)
    const l1 = (r1.data?.loops ?? [])[0] as { item?: string; folder?: string } | undefined
    expect(l1?.item, 'liste tabanlı kutuda öğe gösterilmiyor').toBe('bir')

    await callTool('flow.edit', { branchId: bid, ops: [{ op: 'patchNode', id: f.loop.id, fields: { folder: 'C:\\nubbo-yok' } }] }, h)

    const r2 = await callTool('flow.read', { branchId: bid }, h)
    const l2 = (r2.data?.loops ?? [])[0] as { item?: string; folder?: string } | undefined
    // Klasörlü kutuda koşucu klasörü üstün tutar ve listeyi ancak koşarken doldurur; burada "#1"
    // ya da "bir" göstermek koşunun kullanmayacağı bir öğeyi bildirmek olurdu.
    expect(l2?.item, `klasörlü kutuda öğe uyduruldu: ${l2?.item}`).toBeUndefined()
    expect(String(l2?.folder)).toContain('C:\\nubbo-yok')
  })
})
