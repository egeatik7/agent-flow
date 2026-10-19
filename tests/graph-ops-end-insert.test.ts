import { describe, expect, it } from 'vitest'
import { addAfter, connect } from '../src/lib/graph-ops'
import { createNode, type AgentGraph, type AgentNode } from '../electron/graph-types'

const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `e-${from.id}-${fromPort}`, from: from.id, fromPort, to: to.id })

describe('araya node ekleme: çıkışsız tür aşağıdaki adımı silmez', () => {
  it('Bitir araya eklenmek istenirse graf DEĞİŞMEZ ve boş id döner (sessiz kayıp yok)', () => {
    const start = createNode('start', 0, 0), click = createNode('click', 200, 0), end = createNode('end', 400, 0)
    const graph: AgentGraph = { nodes: [start, click, end], edges: [edge(start, 'next', click), edge(click, 'next', end)] }
    const result = addAfter(graph, click.id, 'next', 'end')
    expect(result.id).toBe('')
    expect(result.graph).toBe(graph)
    expect(result.graph.edges).toHaveLength(2)
  })

  it('çıkışı olan tür (Tıkla) araya girer ve zincir korunur', () => {
    const start = createNode('start', 0, 0), click = createNode('click', 200, 0), end = createNode('end', 400, 0)
    const graph: AgentGraph = { nodes: [start, click, end], edges: [edge(start, 'next', click), edge(click, 'next', end)] }
    const result = addAfter(graph, click.id, 'next', 'click')
    const added = result.graph.nodes.find((n) => n.id === result.id)!
    const toEnd = result.graph.edges.find((e) => e.from === added.id && e.fromPort === 'next')
    expect(toEnd?.to).toBe(end.id)
  })
})
