import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createNode, normalizeGraph, type AgentGraph } from '../electron/graph-types'
import NodeCanvas from '../src/components/NodeCanvas'
import { packageAppearances } from '../src/lib/package-appearance'

function fixture(count = 3): AgentGraph {
  return { nodes: Array.from({ length: count }, (_, index) => ({ ...createNode('package', index * 300, 0), id: `legacy-package-${index}` })), edges: [] }
}
describe('package identity without changing saved flows', () => {
  it('old normalized flows gain distinct color/symbol pairs without new node fields', () => {
    const graph = normalizeGraph(fixture(64)), before = JSON.stringify(graph)
    const looks = packageAppearances(graph)
    expect(new Set([...looks.values()].map(v => `${v.color}/${v.symbol}`)).size).toBe(64)
    expect(JSON.stringify(graph)).toBe(before)
  })
  it('keeps identity through rename, movement, graph reordering and loop membership', () => {
    const graph = fixture(), before = packageAppearances(graph)
    graph.nodes.reverse(); graph.nodes[0].title = 'Renamed'; graph.nodes[1].x = 2000
    graph.nodes.push({ ...createNode('loop', 0, 0), members: graph.nodes.map(n => n.id) })
    expect(packageAppearances(graph)).toEqual(before)
    expect(packageAppearances(JSON.parse(JSON.stringify(graph)))).toEqual(before)
  })
  it('remains finite and badges distinct beyond the palette size', () => {
    const looks = packageAppearances(fixture(80))
    expect(looks.size).toBe(80)
    expect(new Set([...looks.values()].map(v => v.badge)).size).toBe(80)
  })
  it('renders actual SVG symbols and distinct headers on old packages inside a loop', () => {
    const graph = fixture(2), loop = { ...createNode('loop', 0, 0), members: graph.nodes.map(n => n.id) }
    graph.nodes.push(loop)
    const props = { graph, selectedNodeId: null, selectedIds: [], selectedEdgeId: null, stepStatus: {}, running: false,
      onSelectNode: vi.fn(), onSelectMany: vi.fn(), onSelectEdge: vi.fn(), onMoveNodes: vi.fn(), onSetMembership: vi.fn(), onWrap: vi.fn(), onConnect: vi.fn(), onAddAfter: vi.fn(), onAddAt: vi.fn(), onDeleteNode: vi.fn(), onDeleteEdge: vi.fn(), onDuplicate: vi.fn(), onRunFrom: vi.fn(), onEnterPackage: vi.fn(), onUnpackPackage: vi.fn(), onPatchNode: vi.fn() }
    const html = renderToStaticMarkup(createElement(NodeCanvas, props))
    expect(html.match(/class="package-symbol"/g)).toHaveLength(2)
    expect(html).toContain('P01'); expect(html).toContain('P02')
    for (const look of packageAppearances(graph).values()) expect(html).toContain(look.color)
  })
})
