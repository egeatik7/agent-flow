import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph } from '../electron/graph-types'
import { searchCanvas } from '../src/lib/canvas-search'

describe('whole canvas search', () => {
  it('searches nested packages in spatial order, retains the exact package path and does not mutate JSON', () => {
    const left = { ...createNode('click', 100, 200), id: 'left', prompt: 'Save As' }
    const upper = { ...createNode('click', 100, 50), id: 'upper', prompt: 'SAVE AS' }
    const deep = { ...createNode('click', 400, 80), id: 'deep', prompt: 'Save As' }
    const inner = { ...createNode('package', 30, 50), id: 'inner', inner: { nodes: [deep], edges: [] } }
    const pack = { ...createNode('package', 200, 50), id: 'pack', inner: { nodes: [inner], edges: [] } }
    const right = { ...createNode('click', 900, 50), id: 'right', prompt: 'Save As' }
    const graph: AgentGraph = { nodes: [right, pack, left, upper], edges: [] }
    const before = JSON.stringify(graph)
    expect(searchCanvas(graph, '  save as ').map(hit => [hit.nodeId, hit.path])).toEqual([
      ['upper', []], ['left', []], ['deep', ['pack', 'inner']], ['right', []],
    ])
    expect(JSON.stringify(graph)).toBe(before)
  })
  it('supports a single-letter substring and Turkish case, excluding diagnostic target memories', () => {
    const node = { ...createNode('click', 0, 0), title: 'İçe Aktar', prompt: 'Kaydet', memory: [{ win: '', type: '', src: 'ocr' as const, rx: 0, ry: 0, text: 'secret cached target', at: 0 }] }
    const graph = { nodes: [node], edges: [] }
    expect(searchCanvas(graph, 'a')).toHaveLength(1)
    expect(searchCanvas(graph, 'içe aktar')).toHaveLength(1)
    expect(searchCanvas(graph, 'secret cached target')).toEqual([])
    expect(searchCanvas(graph, '   ')).toEqual([])
  })
})
