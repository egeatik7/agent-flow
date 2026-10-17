import { describe, expect, it, vi } from 'vitest'
import { createNode, type AgentEdge, type AgentGraph, type AgentNode, type CanvasBook } from '../electron/graph-types'
import { callTool } from '../electron/tools'

const edge = (from: AgentNode, fromPort: string, to: AgentNode): AgentEdge => ({ id: `e-${from.id}-${fromPort}-${to.id}`, from: from.id, fromPort, to: to.id })

/** Başlangıç → Kaydet (tıkla) → bekle → Bitir, on the canvas `c1`. */
function fixture() {
  const start = createNode('start', 0, 0)
  const click = createNode('click', 300, 0)
  click.prompt = 'Kaydet'
  const wait = createNode('wait', 600, 0)
  wait.ms = 2000
  const end = createNode('end', 900, 0)
  const graph: AgentGraph = { nodes: [start, click, wait, end], edges: [edge(start, 'next', click), edge(click, 'next', wait), edge(wait, 'next', end)] }
  const book: CanvasBook = { activeId: 'c1', tabs: [{ id: 'c1', name: 'Tuval 1', graph }] }
  return { start, click, wait, end, book }
}

/** A branch that removes the click and adds a 700 ms wait before the existing wait. */
async function branchWithEdit(ctx: any, f: ReturnType<typeof fixture>) {
  const created = await callTool('branch.create', { name: 'otomatik' }, ctx)
  expect(created.ok).toBe(true)
  const id = created.data?.branchId
  const edited = await callTool('flow.edit', { branchId: id, ops: [
    { op: 'disconnect', from: f.start.id },
    { op: 'addNode', key: 'alt', kind: 'wait', fields: { ms: 700 }, connectFrom: f.start.id },
    { op: 'connect', from: 'alt', to: f.wait.id },
  ] }, ctx)
  expect(edited.ok).toBe(true)
  return id as string
}

function context(autoApply: boolean | undefined, answer: { ok: boolean; error?: string }) {
  const f = fixture()
  const applyMerge = vi.fn(async () => answer)
  let book = f.book
  const ctx: any = {
    getGraph: () => book.tabs[0].graph,
    getSettings: () => ({ agentPermission: 'auto' }),
    log: () => {}, isRunning: () => false, userStop: () => false, sendStep: () => {},
    permission: () => 'auto', askApproval: async () => true,
    getCanvases: () => structuredClone(book),
    saveCanvases: (b: CanvasBook) => { book = b },
    applyMerge,
    ...(autoApply === undefined ? {} : { autoApply }),
  }
  return { f, ctx, applyMerge }
}

describe('branch merge applied by the agent', () => {
  it('outside a test session the agent cannot apply a merge, and the canvas is not touched', async () => {
    const { f, ctx, applyMerge } = context(undefined, { ok: true })
    const id = await branchWithEdit(ctx, f)
    const r = await callTool('branch.merge', { branchId: id, apply: true }, ctx, 'agent')
    expect(r.ok).toBe(false)
    expect(applyMerge).not.toHaveBeenCalled()
  })

  it('in a test session the merge is handed to the window once, with the edited graph and its canvas', async () => {
    const { f, ctx, applyMerge } = context(true, { ok: true })
    const id = await branchWithEdit(ctx, f)
    const r = await callTool('branch.merge', { branchId: id, apply: true }, ctx, 'agent')
    expect(r.ok).toBe(true)
    expect(applyMerge).toHaveBeenCalledTimes(1)
    const sent = (applyMerge.mock.calls[0] as any[])[0]
    expect(sent.tabId).toBe('c1')
    // The click is gone from the applied graph and the new 700 ms wait is in it.
    expect(sent.graph.nodes.some((n: AgentNode) => n.id === f.click.id)).toBe(false)
    expect(sent.graph.nodes.some((n: AgentNode) => n.kind === 'wait' && n.ms === 700)).toBe(true)
  })

  it('a window that refuses the merge is reported as a failure, not as success', async () => {
    const { f, ctx, applyMerge } = context(true, { ok: false, error: 'Tuval ZIP’e kaydedilemedi.' })
    const id = await branchWithEdit(ctx, f)
    const r = await callTool('branch.merge', { branchId: id, apply: true }, ctx, 'agent')
    expect(applyMerge).toHaveBeenCalledTimes(1)
    expect(r.ok).toBe(false)
  })
})
