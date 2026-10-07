import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode, type AppSettings, type CanvasBook } from '../electron/graph-types'
import { callTool, type ToolContext } from '../electron/tools'

let seq = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `mm${++seq}`, from: from.id, fromPort, to: to.id })

function fixture() {
  const root = createNode('start', 0, 0)
  const wait = createNode('wait', 200, 0)
  wait.ms = 400
  const graph: AgentGraph = { nodes: [root, wait], edges: [edge(root, 'next', wait)] }
  return { graph }
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

describe('merge denemesi ne uygulanacağını sayıyla söyler', () => {
  it('diff ile aynı düzenleme sayısını bildirir (canlı ölçümde eksikti)', async () => {
    const f = fixture()
    const h = ctx(f.graph)
    const bid = String((await callTool('branch.create', { name: 'M' }, h)).data?.branchId)
    await callTool('flow.edit', { branchId: bid, ops: [{ op: 'addNode', key: 'a', kind: 'wait', fields: { ms: 100 } }] }, h)
    const d = await callTool('branch.diff', { branchId: bid }, h)
    const m = await callTool('branch.merge', { branchId: bid }, h)
    const sayi = (s: unknown) => (String(s).match(/(\d+) düzenleme/) || [])[1]
    expect(sayi(d.message), `diff sayı bildirmiyor: ${d.message}`).toBeTruthy()
    expect(sayi(m.message), `merge denemesi sayı bildirmiyor: ${m.message}`).toBeTruthy()
    expect(sayi(m.message)).toBe(sayi(d.message))
    expect(String(m.message)).toContain('apply: true')
  })
})
