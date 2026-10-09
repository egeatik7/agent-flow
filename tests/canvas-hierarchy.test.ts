import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode } from '../electron/graph-types'
import { canvasHierarchy, hierarchyTarget, type HierarchyEntry } from '../src/lib/canvas-hierarchy'
const node = (kind: AgentNode['kind'], id: string): AgentNode => ({ ...createNode(kind, 0, 0), id, title: id })
const edge = (from: string, to: string) => ({ id: `${from}-${to}`, from, to, fromPort: 'next' })
const flatten = (rows: HierarchyEntry[]): HierarchyEntry[] => rows.flatMap(row => [row, ...flatten(row.children)])
describe('full canvas hierarchy without graph changes', () => {
  it('nests packages and loop members and resolves the exact package scope for navigation', () => {
    const leaf = node('type', 'leaf'), inner = node('package', 'inner'), outer = node('package', 'outer')
    const loop = { ...node('loop', 'loop'), members: [leaf.id, inner.id] }
    inner.inner = { nodes: [node('type', 'leaf')], edges: [] }
    outer.inner = { nodes: [loop, leaf, inner], edges: [] }
    const graph = { nodes: [outer], edges: [] }, before = JSON.stringify(graph)
    const rows = canvasHierarchy(graph), flat = flatten(rows)
    expect(rows[0].children[0].node.id).toBe(loop.id)
    expect(rows[0].children[0].children.map(row => row.node.id)).toEqual(['leaf', 'inner'])
    expect(flat.filter(row => row.node.id === 'leaf').map(row => row.packagePath)).toEqual([['outer'], ['outer', 'inner']])
    expect(new Set(flat.map(row => row.key)).size).toBe(flat.length)
    const target = hierarchyTarget(graph, 'leaf', ['outer', 'inner'])!
    expect(target.graph).toBe(inner.inner)
    expect(target.stack.map(c => c.id)).toEqual(['outer', 'inner'])
    expect(JSON.stringify(graph)).toBe(before)
    expect(hierarchyTarget(graph, 'missing', ['outer'])).toBeNull()
    expect(hierarchyTarget(graph, 'leaf', ['missing'])).toBeNull()
  })
  it('includes every disconnected node and return-path node, without swallowing nodes after the loop', () => {
    const graph: AgentGraph = { nodes: [node('start', 'start'), node('loop', 'loop'), node('type', 'body'), node('key', 'return'), node('end', 'done'), node('click', 'detached')],
      edges: [edge('start', 'loop'), edge('loop', 'body'), edge('body', 'return'), edge('return', 'loop'), edge('loop', 'done')] }
    const before = structuredClone(graph), rows = canvasHierarchy(graph)
    expect(rows.map(r => r.node.id)).toEqual(['start', 'loop', 'done', 'detached'])
    expect(rows[1].children.map(r => r.node.id)).toEqual(['body', 'return'])
    expect(flatten(rows)).toHaveLength(graph.nodes.length)
    expect(graph).toEqual(before)
  })
  it('keeps explicit frame ownership for nested loops and ignores duplicate, missing and self members', () => {
    const outer = { ...node('loop', 'outer'), members: ['inner', 'missing', 'outer', 'inner'] }
    const inner = { ...node('loop', 'inner'), members: ['child'] }
    const graph = { nodes: [outer, inner, node('type', 'child')], edges: [edge('outer', 'inner'), edge('inner', 'child'), edge('child', 'inner'), edge('inner', 'outer')] }
    const rows = canvasHierarchy(graph)
    expect(rows[0].children[0].node.id).toBe('inner')
    expect(rows[0].children[0].children[0].node.id).toBe('child')
    expect(flatten(rows)).toHaveLength(3)
  })
  it('terminates on cyclic memberships and cyclic edges, showing each node once', () => {
    const graph = { nodes: [{ ...node('loop', 'a'), members: ['b'] }, { ...node('loop', 'b'), members: ['a', 'c'] }, node('type', 'c')],
      edges: [edge('a', 'b'), edge('b', 'a'), edge('c', 'c')] }
    expect(flatten(canvasHierarchy(graph)).map(row => row.node.id).sort()).toEqual(['a', 'b', 'c'])
  })
})
