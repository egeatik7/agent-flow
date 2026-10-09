import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph } from '../electron/graph-types'
import { revealAt } from '../electron/reveal'
const node = createNode('type', 0, 0)
const inner = { ...createNode('loop', 0, 0), items: ['C:\\in\\one.glb', 'D:\\in\\two.glb'], startIndex: 1, members: [node.id] }
const pkg = { ...createNode('package', 0, 0), inner: { nodes: [inner, node], edges: [] } }
const outer = { ...createNode('loop', 0, 0), items: ['C:\\group1', 'C:\\group2'], startIndex: 1, members: [pkg.id] }
const root: AgentGraph = { nodes: [outer, pkg], edges: [] }
describe('variable hierarchy', () => {
  it('finds the closest loop, exact row and alias values', () => {
    expect(revealAt(root, node.id, '{{öge}}').value).toBe('D:\\in\\two.glb'); expect(revealAt(root, node.id, '{{oge.isim}}').value).toBe('two')
    expect(revealAt(root, node.id, '{{öğe.ad}}').value).toBe('two.glb'); expect(revealAt(root, node.id, '{{sayı}}').resolved).toBe(false)
    expect(revealAt(root, node.id, '{{sıra}}').value).toBe('2'); expect(revealAt(root, node.id, '{{toplam}}').value).toBe('2')
  })
  it('a loop folder sees the outside loop', () => { expect(revealAt(root, inner.id, '{{öğe}}').value).toBe('C:\\group2') })
  it('never fabricates an unread folder item or count', () => {
    const pending = { ...inner, items: [], folder: '{{öğe}}\\GLBs', count: 500 }, graph = { nodes: [outer, { ...pkg, inner: { nodes: [pending, node], edges: [] } }], edges: [] }
    for (const token of ['{{öğe}}', '{{sıra}}', '{{toplam}}']) { const r = revealAt(graph, node.id, token); expect(r.resolved).toBe(false); expect(r.where).toContain('C:\\group2\\GLBs') }
    expect(revealAt({ nodes: [{ ...pending, folder: 'C:\\fixed' }, node], edges: [] }, node.id, '{{toplam}}').resolved).toBe(false)
  })
  it('count mode and outside defaults mirror runtime', () => {
    const counted = { ...inner, items: [], folder: '', count: 3, startIndex: 2 }
    expect(revealAt({ nodes: [counted, node], edges: [] }, node.id, '{{öğe}}').value).toBe('3'); expect(revealAt({ nodes: [node], edges: [] }, node.id, '{{sıra}}').value).toBe('1')
    expect(revealAt({ nodes: [node], edges: [] }, node.id, '{{öğe}}').resolved).toBe(false)
  })
  it('does not mutate data', () => { const before = JSON.stringify(root); revealAt(root, node.id, '{{öğe}}'); expect(JSON.stringify(root)).toBe(before) })
})
