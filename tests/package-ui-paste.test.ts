import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNode, nodeHeight, nodeWidth, outputPoint, packageStepCount, summarize, type AgentGraph, type AgentNode } from '../electron/graph-types'
import { FRAME_BOTTOM, FRAME_PAD, frameRect, ownerOf } from '../electron/groups'
import { addAfter, autoLayout, copyNodes, pasteNodes } from '../src/lib/graph-ops'
import NodeCanvas from '../src/components/NodeCanvas'

const graph = (nodes: AgentNode[]): AgentGraph => ({ nodes, edges: [] })
const pkg = (nodes: AgentNode[], x = 100, y = 100): AgentNode => ({ ...createNode('package', x, y), inner: graph(nodes) })
const props = (g: AgentGraph) => ({ graph: g, canvasKey: 'root', selectedNodeId: null, selectedIds: [], selectedEdgeId: null, stepStatus: {}, running: false,
  onSelectNode: vi.fn(), onSelectMany: vi.fn(), onSelectEdge: vi.fn(), onMoveNodes: vi.fn(), onSetMembership: vi.fn(), onWrap: vi.fn(), onConnect: vi.fn(), onAddAfter: vi.fn(), onAddAt: vi.fn(), onDeleteNode: vi.fn(), onDeleteEdge: vi.fn(), onDuplicate: vi.fn(), onRunFrom: vi.fn(), onEnterPackage: vi.fn(), onUnpackPackage: vi.fn(), onPatchNode: vi.fn() })
let mounted: ReactTestRenderer | undefined
afterEach(() => { if (mounted) act(() => mounted!.unmount()); mounted = undefined; vi.unstubAllGlobals() })

function visibleBounds(g: AgentGraph, ids: string[]) {
  const rects = g.nodes.filter(n => ids.includes(n.id)).map(n => n.kind === 'loop' ? frameRect(g, n) : { x: n.x, y: n.y, w: nodeWidth(n.kind), h: nodeHeight(n.kind) })
  const x1 = Math.min(...rects.map(r => r.x)), y1 = Math.min(...rects.map(r => r.y))
  return { x: (x1 + Math.max(...rects.map(r => r.x + r.w))) / 2, y: (y1 + Math.max(...rects.map(r => r.y + r.h))) / 2 }
}

describe('package cards count actual nested nodes and retain consistent geometry', () => {
  it('counts 100 nested basic nodes once, without package wrappers or Start/End', () => {
    const deep = pkg(Array.from({ length: 90 }, () => createNode('click', 0, 0)))
    const middle = pkg([createNode('start', 0, 0), deep, ...Array.from({ length: 10 }, () => createNode('type', 0, 0)), createNode('end', 0, 0)])
    const outer = pkg([createNode('start', 0, 0), middle, createNode('end', 0, 0)])
    expect(packageStepCount(outer.inner)).toBe(100)
    expect(summarize(outer)).toBe('100 adım')
    const loop = { ...createNode('loop', 0, 0), count: 500, members: [middle.id] }
    outer.inner!.nodes.push(loop)
    expect(packageStepCount(outer.inner)).toBe(101)
    expect(summarize(pkg([pkg([])]))).toBe('Boş paket')
  })
  it('larger packages move their ports and loop frames together; ordinary nodes stay unchanged', () => {
    const packageNode = pkg([]), click = createNode('click', 0, 0)
    expect(nodeWidth(packageNode.kind)).toBe(262); expect(nodeHeight(packageNode.kind)).toBe(136)
    expect(nodeWidth(click.kind)).toBe(230); expect(nodeHeight(click.kind)).toBe(114)
    expect(outputPoint(packageNode, 'next')).toEqual({ x: 360, y: 219 })
    const loop = { ...createNode('loop', 0, 0), members: [packageNode.id] }
    const r = frameRect(graph([loop, packageNode]), loop)
    expect(r.x + r.w).toBe(packageNode.x + 262 + FRAME_PAD)
    expect(r.y + r.h).toBe(packageNode.y + 136 + FRAME_BOTTOM)
    const added = addAfter(graph([packageNode]), packageNode.id, 'next', 'click')
    expect(added.graph.nodes.find(n => n.id === added.id)!.x).toBe(packageNode.x + 262 + 70)
    const laidOut = autoLayout({ nodes: [packageNode, click], edges: [{ id: 'layout', from: packageNode.id, fromPort: 'next', to: click.id }] })
    expect(laidOut.nodes[1].x - laidOut.nodes[0].x).toBe(262 + 70)
  })
  it('actual markup shows a horizontal color/XP blue/black header and both raised controls', () => {
    const n = pkg([createNode('type', 0, 0), pkg([createNode('wait', 0, 0)])])
    const html = renderToStaticMarkup(createElement(NodeCanvas, props(graph([n]))))
    expect(html).toContain('linear-gradient(90deg,'); expect(html).toContain('#0a246a 72%, #05070c 100%')
    expect(html).toContain('width:262px;height:136px'); expect(html).toContain('2 adım')
    expect(html).toContain('package-action-open'); expect(html).toContain('package-action-unpack')
  })
})

describe('paste centres only the copied structure and keeps it disconnected', () => {
  it('centres mixed package/node bounds and preserves original objects, edges and loop membership', () => {
    const a = createNode('click', 100, 150), b = pkg([createNode('type', 20, 20)], 420, 230)
    const source = { nodes: [a, b], edges: [{ id: 'ab', from: a.id, fromPort: 'next', to: b.id }] }
    const old = createNode('type', 750, 450), loop = { ...createNode('loop', 600, 350), members: [old.id] }
    const target = graph([old, loop]), before = JSON.stringify(target)
    const result = pasteNodes(target, copyNodes(source, [a.id, b.id])!, { x: 820, y: 520 })!
    const center = visibleBounds(result.graph, result.ids)
    expect(center.x).toBeCloseTo(820, 0); expect(center.y).toBeCloseTo(520, 0)
    expect(JSON.stringify(target)).toBe(before)
    expect(result.graph.nodes.find(n => n.id === loop.id)).toBe(loop)
    expect(result.graph.edges).toHaveLength(1)
    expect(result.graph.edges.every(e => result.ids.includes(e.from) && result.ids.includes(e.to))).toBe(true)
    for (const id of result.ids) expect(ownerOf(result.graph, id)).toBeUndefined()
    const copiedPackage = result.graph.nodes.find(n => n.id === result.ids[1])!
    expect(copiedPackage.inner!.nodes[0].id).not.toBe(b.inner!.nodes[0].id)
    expect(copiedPackage.inner!.nodes[0].x).toBe(20)
  })
  it('centres copied loop frames, preserves their internal membership and cannot absorb existing nodes', () => {
    const a = createNode('click', 100, 100), b = pkg([], 400, 100), loop = { ...createNode('loop', 0, 0), members: [a.id, b.id] }
    const source = { nodes: [loop, a, b], edges: [{ id: 'a-b', from: a.id, fromPort: 'next', to: b.id }] }
    const old = createNode('click', 850, 500), target = graph([old])
    const result = pasteNodes(target, copyNodes(source, source.nodes.map(n => n.id))!, { x: 850, y: 500 })!
    const center = visibleBounds(result.graph, result.ids)
    expect(center.x).toBeCloseTo(850, 0); expect(center.y).toBeCloseTo(500, 0)
    const copyLoop = result.graph.nodes.find(n => n.id === result.ids[0])!
    expect(copyLoop.members).toEqual(result.ids.slice(1))
    expect(ownerOf(result.graph, old.id)).toBeUndefined()
  })
  it('excluded duplicate Start does not skew the centre; repeated paste uses the same point with fresh IDs', () => {
    const start = createNode('start', 0, 0), a = pkg([], 700, 300)
    const clip = copyNodes(graph([start, a]), [start.id, a.id])!
    const target = graph([createNode('start', 0, 0)])
    const first = pasteNodes(target, clip, { x: 12, y: 18 })!
    const second = pasteNodes(first.graph, clip, { x: 12, y: 18 })!
    expect(first.ids).toHaveLength(1); expect(second.ids).toHaveLength(1)
    expect(first.ids[0]).not.toBe(second.ids[0])
    expect(visibleBounds(first.graph, first.ids)).toEqual({ x: 12, y: 18 })
    expect(visibleBounds(second.graph, second.ids)).toEqual({ x: 12, y: 18 })
    expect(second.graph.edges).toEqual([])
  })
})

describe('real canvas capture supplies the last click in canvas coordinates', () => {
  it('a pasted selection cannot pan away from its anchor; a later ordinary selection still reveals its node', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const el = { clientWidth: 1000, clientHeight: 700, getBoundingClientRect: () => ({ left: 0, top: 0 }), addEventListener: vi.fn(), removeEventListener: vi.fn() }
    const a = createNode('click', 1500, 100), b = pkg([], 2000, 100), p = { ...props(graph([a, b])), pasteRevision: 0 }
    act(() => { mounted = create(createElement(NodeCanvas, p), { createNodeMock: () => el }) })
    const transform = () => mounted!.root.findAllByType('div').find(n => String(n.props.className).split(' ').includes('canvas-inner'))!.props.style.transform
    const before = transform()
    act(() => mounted!.update(createElement(NodeCanvas, { ...p, pasteRevision: 1, selectedNodeId: b.id, selectedIds: [a.id, b.id] })))
    expect(transform()).toBe(before)
    act(() => mounted!.update(createElement(NodeCanvas, { ...p, pasteRevision: 1, selectedNodeId: a.id, selectedIds: [a.id] })))
    expect(transform()).not.toBe(before)
  })
  it('respects pan/zoom, ignores middle-button panning, resets in a different canvas, and detaches on unmount', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const listeners = new Map<string, (e: unknown) => void>()
    const el = { clientWidth: 1000, clientHeight: 700, getBoundingClientRect: () => ({ left: 100, top: 50 }), addEventListener: (name: string, fn: (e: unknown) => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) }
    let readPoint: (() => { x: number; y: number }) | null = null
    const register = (read: typeof readPoint) => { readPoint = read }
    const p = { ...props(graph([pkg([])])), onPasteTarget: register }
    act(() => { mounted = create(createElement(NodeCanvas, p), { createNodeMock: () => el }) })
    const point = () => readPoint!()
    expect(point()).toEqual({ x: 476, y: 326 })
    act(() => listeners.get('wheel')!({ preventDefault: vi.fn(), clientX: 500, clientY: 350, deltaY: -1 }))
    const scroll = () => mounted!.root.findAllByType('div').find(n => String(n.props.className).split(' ').includes('canvas-scroll'))!
    act(() => scroll().props.onMouseDownCapture({ button: 0, clientX: 620, clientY: 450 }))
    const picked = point()
    expect(picked.x).toBeCloseTo(483.142857, 4); expect(picked.y).toBeCloseTo(365.285714, 4)
    act(() => scroll().props.onMouseDownCapture({ button: 1, clientX: 800, clientY: 600 }))
    expect(point()).toEqual(picked)
    act(() => mounted!.update(createElement(NodeCanvas, { ...p, canvasKey: 'root/package' })))
    expect(point()).not.toEqual(picked)
    act(() => mounted!.unmount()); mounted = undefined
    expect(readPoint).toBeNull()
  })
  it('capture remembers clicks on package buttons that stop the bubbling drag handler', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const el = { clientWidth: 1000, clientHeight: 700, getBoundingClientRect: () => ({ left: 100, top: 50 }), addEventListener: vi.fn(), removeEventListener: vi.fn() }
    let readPoint: (() => { x: number; y: number }) | null = null
    const p = { ...props(graph([pkg([])])), onPasteTarget: (read: typeof readPoint) => { readPoint = read } }
    act(() => { mounted = create(createElement(NodeCanvas, p), { createNodeMock: () => el }) })
    const scroll = mounted!.root.findAllByType('div').find(n => String(n.props.className).split(' ').includes('canvas-scroll'))!
    act(() => scroll.props.onMouseDownCapture({ button: 0, clientX: 600, clientY: 450 }))
    const button = mounted!.root.findAllByType('button').find(n => String(n.props.className).includes('package-action-open'))!
    const stopPropagation = vi.fn()
    button.props.onMouseDown({ stopPropagation })
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(readPoint!()).toEqual({ x: 476, y: 376 })
  })
})
