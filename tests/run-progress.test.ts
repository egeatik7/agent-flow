import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createNode, type AgentGraph, type AgentNode } from '../electron/graph-types'
import { runGraph, StoppedError, type Executor } from '../electron/runner'
import { windowEventAllowed } from '../electron/run-events'
import { beginProgress, finishProgress, progressEdge, progressStep, runNodePath, runNodeView, visibleRunNodes } from '../src/lib/run-progress'
import NodeCanvas from '../src/components/NodeCanvas'

const task = () => createNode('type', 320, 80)
const edge = (id: string, from: AgentNode, to: AgentNode, fromPort = 'next') => ({ id, from: from.id, to: to.id, fromPort })
function nested() {
  const leaf = task(), other = task()
  const inner: AgentGraph = { nodes: [leaf, other], edges: [edge('inner-next', leaf, other)] }
  const p3 = { ...createNode('package', 300, 80), inner }
  const p2 = { ...createNode('package', 300, 80), inner: { nodes: [p3], edges: [] } }
  const p1 = { ...createNode('package', 300, 80), inner: { nodes: [p2], edges: [] } }
  const root: AgentGraph = { nodes: [p1], edges: [] }
  return { root, leaf, other, p1, p2, p3, inner }
}
function executor(overrides: Partial<Executor> = {}): Executor {
  return { log: () => {}, step: () => {}, shouldStop: () => false, click: async () => {}, type: async () => {}, key: async () => {}, exists: async () => true, ...overrides }
}
const opts = { maxSteps: 30, stepDelayMs: 0 }

describe('live run location and its containing packages', () => {
  it('finds three package levels and only marks the visible ancestor/leaf', () => {
    const s = nested()
    const p = progressStep(beginProgress('canvas'), s.root, s.leaf.id, 'running')
    expect(runNodePath(s.root, s.leaf.id)).toEqual([s.p1.id, s.p2.id, s.p3.id, s.leaf.id])
    expect(visibleRunNodes(p, s.root, s.root, 'canvas')).toEqual([s.p1.id])
    expect(visibleRunNodes(p, s.root, s.p1.inner, 'canvas')).toEqual([s.p2.id])
    expect(visibleRunNodes(p, s.root, s.p2.inner, 'canvas')).toEqual([s.p3.id])
    expect(visibleRunNodes(p, s.root, s.inner, 'canvas')).toEqual([s.leaf.id])
    expect(visibleRunNodes(p, s.root, s.inner, 'different-canvas')).toEqual([])
  })
  it('keeps the stopped leaf despite done and propagated parent errors', () => {
    const s = nested()
    let p = progressStep(beginProgress('canvas'), s.root, s.leaf.id, 'running')
    p = progressStep(p, s.root, s.leaf.id, 'done')
    for (const n of [s.p3, s.p2, s.p1]) p = progressStep(p, s.root, n.id, 'error')
    p = finishProgress(p, true)
    expect(p.nodeId).toBe(s.leaf.id)
    expect(p.phase).toBe('stopped')
    expect(visibleRunNodes(p, s.root, s.root, 'canvas')).toEqual([s.p1.id])
    expect(progressStep(p, s.root, s.other.id, 'running')).toBe(p)
    expect(visibleRunNodes(finishProgress(p, false), s.root, s.root, 'canvas')).toEqual([])
  })
  it('finds the exact package view without mistaking loops for package layers', () => {
    const s = nested()
    const found = runNodeView(s.root, s.leaf.id)!
    expect(found.view).toBe(s.inner)
    expect(found.stack.map(c => c.id)).toEqual([s.p1.id, s.p2.id, s.p3.id])
    expect(found.stack[0].parent).toBe(s.root)
    const loop = { ...createNode('loop', 0, 0), members: [s.leaf.id] }
    s.inner.nodes.push(loop)
    expect(runNodeView(s.root, loop.id)!.stack.map(c => c.id)).toEqual([s.p1.id, s.p2.id, s.p3.id])
    expect(runNodeView(s.root, 'deleted-or-unknown')).toBeNull()
    expect(runNodeView(s.root, s.p1.id)!.stack).toEqual([])
  })
  it('keeps the deepest failure through later steps; manual Stop keeps the current location', () => {
    const s = nested()
    let p = progressStep(beginProgress('canvas'), s.root, s.leaf.id, 'running')
    p = progressStep(p, s.root, s.leaf.id, 'error')
    p = progressStep(p, s.root, s.p3.id, 'error')
    p = progressStep(p, s.root, s.other.id, 'running')
    p = progressStep(p, s.root, s.other.id, 'done')
    expect(p.failedNodeId).toBe(s.leaf.id)
    expect(finishProgress(p, true, true).nodeId).toBe(s.leaf.id)
    expect(finishProgress(p, true, false).nodeId).toBe(s.other.id)
    expect(beginProgress('canvas').failedNodeId).toBeNull()
  })
  it('includes containing loops both outside and inside a package', () => {
    const s = nested()
    const innerLoop = { ...createNode('loop', 0, 0), members: [s.leaf.id] }
    const outerLoop = { ...createNode('loop', 0, 0), members: [s.p1.id] }
    s.inner.nodes.push(innerLoop)
    s.root.nodes.push(outerLoop)
    expect(runNodePath(s.root, s.leaf.id)).toEqual([outerLoop.id, s.p1.id, s.p2.id, s.p3.id, innerLoop.id, s.leaf.id])
  })
})

describe('only the actual route before the current step animates', () => {
  it.each([true, false])('reports the chosen condition port only (%s)', async answer => {
    const start = createNode('start', 0, 0), condition = createNode('condition', 200, 0), yes = task(), no = task()
    condition.text = 'target'; condition.timeoutMs = 0
    const graph = { nodes: [start, condition, yes, no], edges: [edge('entry', start, condition), edge('yes', condition, yes, 'true'), edge('no', condition, no, 'false')] }
    const traversed: string[] = []
    await runGraph(graph, executor({ exists: async () => answer, edge: id => { traversed.push(id) } }), opts)
    expect(traversed).toEqual(['entry', answer ? 'yes' : 'no'])
  })
  it('selected-node run does not invent the incoming edges it skipped', async () => {
    const start = createNode('start', 0, 0), a = task(), b = task(), end = createNode('end', 600, 0)
    const graph = { nodes: [start, a, b, end], edges: [edge('skipped', start, a), edge('skipped-too', a, b), edge('taken', b, end)] }
    const traversed: string[] = []
    await runGraph(graph, executor({ edge: id => { traversed.push(id) } }), { ...opts, startId: b.id })
    expect(traversed).toEqual(['taken'])
  })
  it('reports a selected package continuation, then the outer loop exit', async () => {
    const leaf = task(), pkg = { ...createNode('package', 200, 0), inner: { nodes: [leaf], edges: [] } }
    const next = task(), end = createNode('end', 800, 0)
    const loop = { ...createNode('loop', 0, 0), items: ['only'], members: [pkg.id, next.id] }
    const graph = { nodes: [loop, pkg, next, end], edges: [edge('package-next', pkg, next), edge('loop-done', loop, end, 'done')] }
    const traversed: string[] = []
    await runGraph(graph, executor({ edge: id => { traversed.push(id) } }), { ...opts, startId: leaf.id, packagePath: [pkg.id], resume: true })
    expect(traversed).toEqual(['package-next', 'loop-done'])
  })
  it('clears future edges on each new lap while preserving the route into the loop', async () => {
    const start = createNode('start', 0, 0), a = task(), b = task(), end = createNode('end', 700, 0)
    const loop = { ...createNode('loop', 200, 0), items: ['one', 'two'], members: [a.id, b.id] }
    const graph = { nodes: [start, loop, a, b, end], edges: [edge('into-loop', start, loop), edge('body', a, b), edge('out-loop', loop, end, 'done')] }
    let p = beginProgress('canvas')
    const atA: string[][] = []
    await runGraph(graph, executor({
      step: (id, status) => { p = progressStep(p, graph, id, status); if (id === a.id && status === 'running') atA.push([...p.edges]) },
      edge: (id, from, to) => { p = progressEdge(p, graph, id, from, to) },
    }), opts)
    expect(atA).toEqual([['into-loop'], ['into-loop']])
    expect([...p.edges]).toEqual(['into-loop', 'body', 'out-loop'])
  })
  it('keeps leaf location when the real runner is stopped inside nested packages', async () => {
    const s = nested()
    let p = beginProgress('canvas'), stopped = false
    await expect(runGraph(s.root, executor({
      step: (id, status) => { p = progressStep(p, s.root, id, status) },
      type: async () => { stopped = true; throw new StoppedError() },
      shouldStop: () => stopped,
    }), opts)).rejects.toBeInstanceOf(StoppedError)
    p = finishProgress(p, true)
    expect(p.nodeId).toBe(s.leaf.id)
  })
  it('deduplicates telemetry and resets the next canvas', () => {
    const graph = { nodes: [], edges: [] }
    const p = progressEdge(beginProgress('one'), graph, 'e', 'n', 'm')
    expect(progressEdge(p, graph, 'e', 'n', 'm')).toBe(p)
    expect(progressEdge(finishProgress(p, true), graph, 'other', 'n', 'm')).toEqual(finishProgress(p, true))
    expect(beginProgress('two').edges.size).toBe(0)
  })
  it('keeps a new incoming edge when a cyclic path returns to its earlier node', () => {
    const a = task(), b = task()
    const graph = { nodes: [a, b], edges: [edge('forward', a, b), edge('back', b, a)] }
    let p = progressStep(beginProgress('canvas'), graph, a.id, 'running')
    p = progressEdge(p, graph, 'forward', a.id, b.id)
    p = progressStep(p, graph, b.id, 'running')
    expect([...p.edges]).toEqual(['forward'])
    p = progressEdge(p, graph, 'back', b.id, a.id)
    p = progressStep(p, graph, a.id, 'running')
    expect([...p.edges]).toEqual(['back'])
    // The forward edge is now a future step, not last lap's history.
    expect(p.edges.has('forward')).toBe(false)
  })
  it('suppresses derived-run edge telemetry just like its steps and patches', () => {
    expect(windowEventAllowed('agent:edge', true)).toBe(false)
    expect(windowEventAllowed('agent:edge', false)).toBe(true)
  })
})

describe('actual NodeCanvas markup', () => {
  it.each(['running', 'stopped'] as const)('marks the leaf/loop as %s and leaves future arrows solid', phase => {
    const a = task(), b = task(), future = task()
    const loop = { ...createNode('loop', 0, 0), members: [b.id] }
    const graph = { nodes: [a, b, future, loop], edges: [edge('past', a, b), edge('future', b, future)] }
    const props = {
      graph, selectedNodeId: null, selectedIds: [], selectedEdgeId: null,
      stepStatus: { [b.id]: 'running' as const }, running: phase === 'running', runPhase: phase,
      highlightedNodeIds: [loop.id, b.id], traversedEdges: new Set(['past']),
      onSelectNode: vi.fn(), onSelectMany: vi.fn(), onSelectEdge: vi.fn(), onMoveNodes: vi.fn(), onSetMembership: vi.fn(), onWrap: vi.fn(),
      onConnect: vi.fn(), onAddAfter: vi.fn(), onAddAt: vi.fn(), onDeleteNode: vi.fn(), onDeleteEdge: vi.fn(), onDuplicate: vi.fn(),
      onRunFrom: vi.fn(), onEnterPackage: vi.fn(), onUnpackPackage: vi.fn(), onPatchNode: vi.fn(),
    }
    const html = renderToStaticMarkup(createElement(NodeCanvas, props))
    expect(html.match(new RegExp(`run-${phase}`, 'g'))).toHaveLength(2)
    expect(html.match(/class="edge-line flowing"/g)?.length ?? 0).toBe(phase === 'running' ? 1 : 0)
    expect(html.match(/class="edge-line"/g)?.length ?? 0).toBe(phase === 'running' ? 1 : 2)
    if (phase === 'stopped') expect(html).not.toContain('çalışıyor')
  })
})
