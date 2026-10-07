import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode } from '../electron/graph-types'
import { chainOf } from '../electron/tool-context'

let seq = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `li${++seq}`, from: from.id, fromPort, to: to.id })

describe('kutu öğesi raporu dürüst olmalı', () => {
  it('klasörlü ve listesiz kutuda öğe UYDURULMAZ (#1 gibi bir şey gösterilmez)', () => {
    const root = createNode('start', 0, 0)
    const loop = createNode('loop', 200, 0)
    loop.title = 'Klasörlü'
    loop.folder = 'C:\\nubbo-yok-boyle-klasor'
    loop.count = 3
    const inner = createNode('wait', 400, 0)
    loop.members = [inner.id]
    const graph: AgentGraph = { nodes: [root, loop, inner], edges: [edge(root, 'next', loop), edge(loop, 'next', inner)] }
    const zincir = chainOf(graph, inner.id)
    expect(zincir.length).toBe(1)
    expect(zincir[0].item, `klasörlü kutuda öğe uyduruldu: ${zincir[0].item}`).toBeUndefined()
    expect(zincir[0].folder).toBe('C:\\nubbo-yok-boyle-klasor')
  })

  it('liste tabanlı kutuda öğe yine gösterilir (davranış korunur)', () => {
    const root = createNode('start', 0, 0)
    const loop = createNode('loop', 200, 0)
    loop.items = ['bir', 'iki']
    const inner = createNode('wait', 400, 0)
    loop.members = [inner.id]
    const graph: AgentGraph = { nodes: [root, loop, inner], edges: [edge(root, 'next', loop), edge(loop, 'next', inner)] }
    const zincir = chainOf(graph, inner.id)
    expect(zincir[0].item).toBe('bir')
    expect(zincir[0].total).toBe(2)
  })
})
