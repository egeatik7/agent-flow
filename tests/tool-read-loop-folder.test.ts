import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode, type AppSettings, type CanvasBook } from '../electron/graph-types'
import { callTool, type ToolContext } from '../electron/tools'

let seq = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `rf${++seq}`, from: from.id, fromPort, to: to.id })

/** Klasörlü kutu: liste boşken öğe bilinmez, koşu listeyi doldurunca öğe görünür. */
function fixture(liste: string[]) {
  const root = createNode('start', 0, 0)
  const loop = createNode('loop', 200, 0)
  loop.title = 'Klasör sınaması'
  loop.folder = 'C:\\nubbo-klasor'
  if (liste.length) loop.items = liste
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

function ilkKutu(r: { data?: unknown }) {
  const d = r.data as { loops?: { item?: string; folder?: string }[] } | undefined
  return (d?.loops ?? [])[0]
}

describe('klasörlü kutuda öğe raporu', () => {
  it('liste BOŞSA öğe uydurulmaz, klasör yolu gösterilir', async () => {
    const f = fixture([])
    const h = ctx(f.graph)
    const r = await callTool('flow.read', {}, h)
    const k = ilkKutu(r)
    expect(k?.item, `boş listede öğe uyduruldu: ${k?.item}`).toBeUndefined()
    expect(String(k?.folder)).toContain('nubbo-klasor')
  })

  it('koşu listeyi DOLDURDUYSA öğe gösterilir (bağlam kaybolmaz)', async () => {
    // Motor klasörü okuyunca listeyi node'a yazar: patch(loop.id, { items: found }).
    const f = fixture(['birinci.glb', 'ikinci.glb'])
    const h = ctx(f.graph)
    const r = await callTool('flow.read', {}, h)
    const k = ilkKutu(r)
    expect(k?.item, 'liste doluyken öğe gizlendi (durdurma/sıra koruması bağlamsız kalır)').toBe('birinci.glb')
    expect(String(k?.folder)).toContain('nubbo-klasor')
  })

  it('branch okumasında da aynı kural geçerli', async () => {
    const f = fixture(['a.glb'])
    const h = ctx(f.graph)
    const b = await callTool('branch.create', { name: 'K' }, h)
    const bid = String(b.data?.branchId)
    const r = await callTool('flow.read', { branchId: bid }, h)
    const k = ilkKutu(r)
    expect(k?.item).toBe('a.glb')
  })
})
