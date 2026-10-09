import { describe, expect, it } from 'vitest'
import { createNode, type AgentNode } from '../electron/graph-types'
import { canvasNodes, canvasView, emptyNavigation, visitLocation } from '../src/lib/canvas-navigation'
const node = (kind: AgentNode['kind'], id: string): AgentNode => ({ ...createNode(kind, 0, 0), id, title: id })
const edge = (from: string, to: string) => ({ id: `${from}-${to}`, from, to, fromPort: 'next' })
describe('current-scope canvas navigator', () => {
  it('includes disconnected and loop return nodes exactly once, leaving package interiors in their own scope', () => {
    const pack = { ...node('package', 'pack'), inner: { nodes: [node('type', 'hidden')], edges: [] } }
    const graph = { nodes: [node('start', 'start'), { ...node('loop', 'loop'), members: ['body'] }, node('type', 'body'), node('key', 'return'), pack, node('end', 'done'), node('click', 'detached')],
      edges: [edge('start', 'loop'), edge('loop', 'body'), edge('body', 'return'), edge('return', 'loop'), edge('loop', 'done')] }
    const before = structuredClone(graph), ids = canvasNodes(graph).map(n => n.id)
    expect(ids).toHaveLength(7); expect(new Set(ids).size).toBe(7)
    expect(ids).toContain('return'); expect(ids).toContain('detached'); expect(ids).not.toContain('hidden')
    expect(graph).toEqual(before)
  })
  it('resolves scoped duplicate IDs and tolerates empty packages and deleted history paths', () => {
    const inner = { ...node('package', 'inner'), inner: { nodes: [node('type', 'same')], edges: [] } }
    const outer = { ...node('package', 'outer'), inner: { nodes: [node('click', 'same'), inner], edges: [] } }
    const graph = { nodes: [outer, node('package', 'empty')], edges: [] }
    expect(canvasView(graph, ['outer', 'inner'])!.graph).toBe(inner.inner)
    expect(canvasView(graph, ['outer'])!.stack.map(c => c.id)).toEqual(['outer'])
    expect(canvasView(graph, ['empty'])!.graph.nodes).toEqual([])
    expect(canvasView(graph, ['gone'])).toBeNull()
  })
  it('preserves back/forward entries, avoids duplicates and drops the forward branch on a new visit', () => {
    const root = { path: [] }, inside = { path: ['pack'] }, leaf = { path: ['pack'], nodeId: 'leaf' }
    let history = visitLocation(emptyNavigation(), root, inside)
    history = visitLocation(history, inside, leaf)
    expect(history.entries).toEqual([root, inside, leaf]); expect(history.index).toBe(2)
    expect(visitLocation(history, leaf, leaf)).toBe(history)
    history = { ...history, index: 1 }
    history = visitLocation(history, inside, { path: ['pack'], nodeId: 'other' })
    expect(history.entries).toEqual([root, inside, { path: ['pack'], nodeId: 'other' }])
  })
})
