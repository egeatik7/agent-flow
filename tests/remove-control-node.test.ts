import { describe, expect, it } from 'vitest'
import { NODE_KINDS, NODE_SPECS, createNode, normalizeGraph, type AgentNode } from '../electron/graph-types'
import { ADDABLE_KINDS } from '../electron/tool-edit'
import { runGraph, type Executor } from '../electron/runner'
const start = createNode('start', 0, 0), action = createNode('type', 300, 100), end = createNode('end', 600, 100)
const probe = (id: string) => ({ id, kind: 'probe', title: 'Kontrol', x: 250, y: 50, text: '{{öğe}}' })
const edge = (from: string, to: string, fromPort = 'next') => ({ id: `${from}:${fromPort}`, from, to, fromPort })
describe('Kontrol removal and old-flow migration', () => {
  it('cannot be added; condition remains', () => {
    expect(NODE_KINDS).not.toContain('probe'); expect(NODE_SPECS).not.toHaveProperty('probe'); expect(ADDABLE_KINDS).not.toContain('probe'); expect(ADDABLE_KINDS).toContain('condition')
  })
  it('preserves incoming branch port/id across a chain without mutating data', () => {
    const condition = createNode('condition', 100, 100), raw = { nodes: [start, condition, probe('p1'), probe('p2'), action, end], edges: [edge(start.id, condition.id), edge(condition.id, 'p1', 'true'), edge(condition.id, end.id, 'false'), edge('p1', 'p2'), edge('p2', action.id), edge(action.id, end.id)] }
    const before = JSON.stringify(raw), graph = normalizeGraph(raw)
    expect(graph.nodes.map(n => n.id)).not.toContain('p1'); expect(graph.nodes.map(n => n.id)).not.toContain('p2')
    expect(graph.edges.find(e => e.fromPort === 'true')).toEqual(edge(condition.id, action.id, 'true')); expect(graph.edges.find(e => e.fromPort === 'false')).toEqual(edge(condition.id, end.id, 'false')); expect(JSON.stringify(raw)).toBe(before)
  })
  it('the migrated loop still executes every item and reaches End', async () => {
    const loop: AgentNode = { ...createNode('loop', 40, 80), items: ['one', 'two'], members: ['p1', action.id, 'p2'] }
    const graph = normalizeGraph({ nodes: [start, loop, probe('p1'), action, probe('p2'), end], edges: [edge(start.id, loop.id), edge('p1', action.id), edge(action.id, 'p2'), edge(loop.id, end.id, 'done')] })
    expect(graph.nodes.find(n => n.id === loop.id)?.members).toEqual([action.id]); graph.nodes.find(n => n.id === action.id)!.text = '{{öğe}}'
    const values: string[] = [], statuses: string[] = [], ex: Executor = { log: () => {}, step: (id, status) => statuses.push(`${id}:${status}`), shouldStop: () => false, click: async () => {}, type: async n => { values.push(n.text!) }, key: async () => {}, exists: async () => true }
    await runGraph(graph, ex, { maxSteps: 30, stepDelayMs: 0 }); expect(values).toEqual(['one', 'two']); expect(statuses).toContain(`${end.id}:done`)
  })
  it('migrates packages and preserves action fields and roundtrips', () => {
    const rawAction = { ...action, text: 'C:\\{{öge.isim}}.glb', clearFirst: false }, pkg = { ...createNode('package', 250, 100), inner: { nodes: [start, probe('p'), rawAction, end], edges: [edge(start.id, 'p'), edge('p', action.id), edge(action.id, end.id)] } }
    const graph = normalizeGraph({ nodes: [start, pkg, end], edges: [edge(start.id, pkg.id), edge(pkg.id, end.id)] }), nested = graph.nodes.find(n => n.id === pkg.id)!.inner!
    expect(nested.nodes.some(n => (n.kind as string) === 'probe')).toBe(false); expect(nested.edges[0].to).toBe(action.id); expect(nested.nodes.find(n => n.id === action.id)).toMatchObject(rawAction)
    expect(normalizeGraph(JSON.parse(JSON.stringify(graph)))).toEqual(graph)
  })
  it('refuses to silently execute a disconnected branch after removing a head', () => {
    const detached = createNode('key', 270, 50), loop = { ...createNode('loop', 100, 50), members: ['p', action.id, detached.id] }, raw = { nodes: [start, loop, probe('p'), action, detached], edges: [edge(start.id, loop.id), edge('p', action.id)] }, before = JSON.stringify(raw)
    expect(() => normalizeGraph(raw)).toThrow('kutunun ilk adımı değişiyor'); expect(JSON.stringify(raw)).toBe(before)
  })
  it('never invents a successor for dead-end or cyclic passive chains', () => {
    expect(normalizeGraph({ nodes: [start, probe('p')], edges: [edge(start.id, 'p')] }).edges).toEqual([])
    const graph = normalizeGraph({ nodes: [start, probe('p1'), probe('p2')], edges: [edge(start.id, 'p1'), edge('p1', 'p2'), edge('p2', 'p1')] })
    expect(graph.edges).toEqual([]); expect(graph.nodes.map(n => n.id)).toEqual([start.id])
  })
})
