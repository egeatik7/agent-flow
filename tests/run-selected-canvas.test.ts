import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createNode, DEFAULT_SETTINGS, normalizeCanvasBook, type AgentGraph, type AgentNode, type CanvasBook } from '../electron/graph-types'
import { runGraph, StoppedError, type Executor } from '../electron/runner'
import Toolbar from '../src/components/Toolbar'
import NodeCanvas from '../src/components/NodeCanvas'
import CanvasTabs from '../src/components/CanvasTabs'
import LogPanel from '../src/components/LogPanel'

// Exercise App's real callbacks and the real runner. Only rendering and desktop input
// are replaced: no Windows session or LLM is needed to test the selected-node handoff.
vi.mock('../src/components/TitleBar', () => ({ default: () => null }))
vi.mock('../src/components/Toolbar', () => ({ default: () => null }))
vi.mock('../src/components/NodeCanvas', () => ({ default: () => null }))
vi.mock('../src/components/CanvasTabs', () => ({ default: () => null }))
vi.mock('../src/components/SidePanel', () => ({ default: () => null }))
vi.mock('../src/components/LogPanel', () => ({ default: () => null }))
vi.mock('../src/components/ScreenScanner', () => ({ default: () => null }))
vi.mock('../src/components/ConfirmDialog', () => ({ default: () => null }))

let App: typeof import('../src/App').default
let book: CanvasBook
let lastSaved: CanvasBook | undefined
let mounted: ReactTestRenderer | undefined
let stopped = false
let onPatch = (_p: unknown) => {}
let onStep = (_p: unknown) => {}
let onEdge = (_p: unknown) => {}
let beforeAction: ((node: AgentNode) => Promise<void>) | undefined
const executed: string[] = []
const dispatched: { graph: AgentGraph; startId?: string; packagePath?: string[] }[] = []
const windowListeners = new Map<string, Set<(event: unknown) => void>>()
const api = {
  getSettings: async () => ({ ...DEFAULT_SETTINGS, stepDelayMs: 0, maxSteps: 100 }),
  getCanvases: async () => structuredClone(book),
  saveCanvases: async (b: CanvasBook) => { lastSaved = structuredClone(b); return true },
  listWindows: async () => [],
  bootReady: () => {},
  onAgentLog: (_cb: (p: unknown) => void) => () => {},
  onAgentStep: (cb: (p: unknown) => void) => { onStep = cb; return () => { onStep = () => {} } },
  onAgentEdge: (cb: (p: unknown) => void) => { onEdge = cb; return () => { onEdge = () => {} } },
  onAgentPatch: (cb: (p: unknown) => void) => { onPatch = cb; return () => { onPatch = () => {} } },
  stopAgent: async () => { stopped = true; return true },
  runAgent: async (graph: AgentGraph, startId?: string, packagePath?: string[], options?: { requireEnd?: boolean }) => {
    dispatched.push({ graph: structuredClone(graph), startId, packagePath: packagePath?.slice() })
    stopped = false
    const record = async (node: AgentNode) => {
      executed.push(node.text ?? node.prompt ?? node.id)
      await beforeAction?.(node)
    }
    const ex: Executor = {
      log: () => {}, step: (id, status) => onStep({ id, status }), edge: (id, from, to) => onEdge({ id, from, to }), shouldStop: () => stopped,
      click: record, type: record, key: record, exists: async () => true,
      patchNode: (id, patch) => onPatch({ id, patch }),
    }
    try {
      const summary = await runGraph(graph, ex, {
        maxSteps: 100, stepDelayMs: 0, startId, resume: !!startId,
        packagePath, reportEnd: options?.requireEnd,
      })
      return { ok: summary.failed === 0, ...summary }
    } catch (e) {
      if (e instanceof StoppedError) return { ok: false, stopped: true }
      throw e
    }
  },
}

beforeAll(async () => {
  vi.stubGlobal('window', { xpAgent: api,
    addEventListener: (name: string, fn: (event: unknown) => void) => {
      if (!windowListeners.has(name)) windowListeners.set(name, new Set())
      windowListeners.get(name)!.add(fn)
    },
    removeEventListener: (name: string, fn: (event: unknown) => void) => windowListeners.get(name)?.delete(fn),
    setTimeout, clearTimeout })
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 0 })
  App = (await import('../src/App')).default
})
afterAll(() => vi.unstubAllGlobals())
afterEach(() => {
  if (mounted) act(() => mounted!.unmount())
  mounted = undefined
  executed.length = 0
  dispatched.length = 0
  stopped = false
  beforeAction = undefined
  lastSaved = undefined
})

let edgeId = 0
const edge = (from: AgentNode, to: AgentNode, fromPort = 'next') => ({ id: `selected-edge-${++edgeId}`, from: from.id, fromPort, to: to.id })
function task(text: string, x = 300) {
  return { ...createNode('type', x, 100), text }
}
function nextCanvas() {
  const start = createNode('start', 0, 100), write = task('RIGHT'), end = createNode('end', 650, 100)
  return { id: 'right', name: 'Right', graph: { nodes: [start, write, end], edges: [edge(start, write), edge(write, end)] } }
}
function scenario(depth = 1, withLoop = false, connectedEnd = true) {
  const before = task('BEFORE'), selected = task('SELECTED {{öğe}}', 650), after = task('AFTER', 1000)
  const innerStart = createNode('start', 0, 100), innerEnd = createNode('end', 1350, 100)
  let graph: AgentGraph = { nodes: [innerStart, before, selected, after, innerEnd], edges: [edge(innerStart, before), edge(before, selected), edge(selected, after), edge(after, innerEnd)] }
  const path: string[] = []
  for (let i = 0; i < depth; i++) {
    const start = createNode('start', 0, 100), pkg = createNode('package', 350, 100), end = createNode('end', 1200, 100)
    pkg.inner = graph
    graph = { nodes: [start, pkg, end], edges: [edge(start, pkg), ...(connectedEnd || i < depth - 1 ? [edge(pkg, end)] : [])] }
    path.unshift(pkg.id)
  }
  let loop: AgentNode | undefined
  if (withLoop) {
    loop = { ...createNode('loop', 300, 0), items: ['first', 'second', 'third'], startIndex: 1, loopIndex: 1, members: [path[0]] }
    const start = graph.nodes[0], pkg = graph.nodes[1], end = graph.nodes[2]
    graph = { nodes: [start, loop, pkg, end], edges: [edge(start, loop), edge(loop, end, 'done')] }
  }
  book = normalizeCanvasBook({ activeId: 'active', tabs: [
    { id: 'left', name: 'Left', graph: nextCanvas().graph },
    { id: 'active', name: 'Active', graph }, nextCanvas(),
  ] })
  return { path, selected, loop }
}
async function mount() {
  await act(async () => { mounted = create(createElement(App)) })
  return mounted!
}
async function select(renderer: ReactTestRenderer, path: string[], id: string) {
  for (const pkgId of path) await act(async () => { renderer.root.findByType(NodeCanvas).props.onEnterPackage(pkgId) })
  await act(async () => { renderer.root.findByType(NodeCanvas).props.onSelectNode(id) })
}
const logs = (renderer: ReactTestRenderer): string => renderer.root.findByType(LogPanel).props.logs.map((l: { message: string }) => l.message).join('\n')

describe('Seçiliden Çalıştır: real App → bridge arguments → runner → next canvas', () => {
  it('real Ctrl+C/Ctrl+V consumes the canvas point, selects fresh copies and creates no external edges', async () => {
    const s = scenario(1), r = await mount()
    const canvas = r.root.findByType(NodeCanvas), before = structuredClone(canvas.props.graph) as AgentGraph
    await act(async () => { canvas.props.onSelectNode(s.path[0]) })
    r.root.findByType(NodeCanvas).props.onPasteTarget(() => ({ x: 900, y: 400 }))
    const shortcut = async (key: string) => {
      const e = { key, ctrlKey: true, metaKey: false, target: { tagName: 'DIV' }, preventDefault: vi.fn() }
      await act(async () => { for (const listener of [...(windowListeners.get('keydown') ?? [])]) listener(e) })
      expect(e.preventDefault).toHaveBeenCalled()
    }
    await shortcut('c'); await shortcut('v')
    const after = r.root.findByType(NodeCanvas).props.graph as AgentGraph
    const copy = after.nodes.find(n => !before.nodes.some(old => old.id === n.id))!
    expect(copy.kind).toBe('package'); expect(copy.x).toBe(769); expect(copy.y).toBe(332)
    expect(after.edges).toEqual(before.edges)
    expect(r.root.findByType(NodeCanvas).props.selectedIds).toEqual([copy.id])
    expect(copy.inner!.nodes[0].id).not.toBe(before.nodes.find(n => n.id === s.path[0])!.inner!.nodes[0].id)
  })
  it.each([1, 2])('keeps outer loop patches and hidden sibling memory while inspecting %i package levels', async depth => {
    const s = scenario(depth, true)
    const sibling = { ...createNode('click', 0, 0), id: 'hidden-sibling' }
    book.tabs[1].graph.nodes.push(sibling)
    const view = await mount()
    await select(view, s.path, s.selected.id)
    const memory = [{ text: 'Saved', win: 'Fixture', type: 'Text', src: 'ocr' as const, rx: .3, ry: .4, at: 1 }]
    await act(async () => {
      onPatch({ id: s.loop!.id, patch: { startIndex: 2, loopIndex: 2 } })
      onPatch({ id: sibling.id, patch: { memory } })
      onPatch({ id: s.selected.id, patch: { text: 'UPDATED' } })
    })
    expect(view.root.findByType(NodeCanvas).props.graph.nodes.find((n: AgentNode) => n.id === s.selected.id).text).toBe('UPDATED')
    await act(async () => { view.root.findByType(CanvasTabs).props.onSelect('right'); await Promise.resolve() })
    const saved = lastSaved!.tabs.find(t => t.id === 'active')!.graph
    expect(saved.nodes.find(n => n.id === s.loop!.id)?.startIndex).toBe(2)
    expect(saved.nodes.find(n => n.id === sibling.id)?.memory).toEqual(memory)
    let inner = saved
    for (const id of s.path) inner = inner.nodes.find(n => n.id === id)!.inner!
    expect(inner.nodes.find(n => n.id === s.selected.id)?.text).toBe('UPDATED')
  })
  it.each([1, 2])('keeps %i package levels, skips prior actions, then runs only the canvas on the right', async depth => {
    const s = scenario(depth), r = await mount()
    await select(r, s.path, s.selected.id)
    await act(async () => { r.root.findByType(Toolbar).props.onRunFromSelected(); await Promise.resolve() })
    expect(dispatched[0]?.packagePath).toEqual(s.path)
    expect(dispatched[0]?.startId).toBe(s.selected.id)
    expect(executed).toEqual(['SELECTED {{öğe}}', 'AFTER', 'RIGHT'])
    expect(dispatched).toHaveLength(2)
    expect(dispatched[1].packagePath).toEqual([])
    expect(dispatched[1].startId).toBeUndefined()
    expect(logs(r)).not.toContain('Başlangıç node’u bulunamadı')
  })
  it('retains the marked loop item when resuming inside a package', async () => {
    const s = scenario(1, true), r = await mount()
    await select(r, s.path, s.selected.id)
    await act(async () => { r.root.findByType(Toolbar).props.onRunFromSelected(); await Promise.resolve() })
    expect(dispatched[0].graph.nodes.find(n => n.id === s.loop!.id)?.startIndex).toBe(1)
    expect(executed).toEqual(['SELECTED second', 'AFTER', 'BEFORE', 'SELECTED third', 'AFTER', 'RIGHT'])
  })
  it('a package-local End cannot advance to the right canvas when the root End is disconnected', async () => {
    const s = scenario(2, false, false), r = await mount()
    await select(r, s.path, s.selected.id)
    await act(async () => { r.root.findByType(Toolbar).props.onRunFromSelected(); await Promise.resolve() })
    expect(executed).toEqual(['SELECTED {{öğe}}', 'AFTER'])
    expect(dispatched).toHaveLength(1)
    expect(logs(r)).toContain('Bitti node’una ulaşmadı')
  })
  it('normal sequence Play still starts at the active canvas root and resets its loop marker', async () => {
    const s = scenario(1, true), r = await mount()
    await select(r, s.path, s.selected.id)
    await act(async () => { r.root.findByType(CanvasTabs).props.onRunAll(); await Promise.resolve() })
    expect(dispatched[0].startId).toBeUndefined()
    expect(dispatched[0].packagePath).toEqual([])
    expect(dispatched[0].graph.nodes.find(n => n.id === s.loop!.id)?.startIndex).toBe(0)
    expect(executed).toEqual(['BEFORE', 'SELECTED first', 'AFTER', 'BEFORE', 'SELECTED second', 'AFTER', 'BEFORE', 'SELECTED third', 'AFTER', 'RIGHT'])
    expect(dispatched).toHaveLength(2)
  })
  it('a selected root node also skips preceding nodes and continues to the right', async () => {
    const s = scenario(0), r = await mount()
    await select(r, [], s.selected.id)
    await act(async () => { r.root.findByType(Toolbar).props.onRunFromSelected(); await Promise.resolve() })
    expect(dispatched[0].packagePath).toEqual([])
    expect(executed).toEqual(['SELECTED {{öğe}}', 'AFTER', 'RIGHT'])
  })
  it('subsequent canvases start from their first item even when they have a saved marker', async () => {
    const s = scenario()
    const start = createNode('start', 0, 100), loop = createNode('loop', 300, 0), write = task('RIGHT {{öğe}}', 350), end = createNode('end', 1200, 100)
    loop.items = ['first', 'second']; loop.startIndex = 1; loop.members = [write.id]
    book.tabs[2].graph = { nodes: [start, loop, write, end], edges: [edge(start, loop), edge(loop, end, 'done')] }
    const r = await mount()
    await select(r, s.path, s.selected.id)
    await act(async () => { r.root.findByType(Toolbar).props.onRunFromSelected(); await Promise.resolve() })
    expect(dispatched[1].graph.nodes.find(n => n.id === loop.id)?.startIndex).toBe(0)
    expect(executed).toEqual(['SELECTED {{öğe}}', 'AFTER', 'RIGHT first', 'RIGHT second'])
  })
  it('Stop while a selected action is pending prevents remaining actions and the next canvas', async () => {
    const s = scenario(), r = await mount()
    await select(r, s.path, s.selected.id)
    let release!: () => void
    beforeAction = async () => new Promise<void>(resolve => { release = resolve })
    await act(async () => { r.root.findByType(Toolbar).props.onRunFromSelected(); await Promise.resolve() })
    expect(r.root.findByType(Toolbar).props.running).toBe(true)
    await act(async () => { r.root.findByType(Toolbar).props.onStop(); release(); await Promise.resolve() })
    expect(executed).toEqual(['SELECTED {{öğe}}'])
    expect(dispatched).toHaveLength(1)
    expect(r.root.findByType(Toolbar).props.running).toBe(false)
  })
  it('an actual execution error does not launch the right canvas', async () => {
    const s = scenario(), r = await mount()
    await select(r, s.path, s.selected.id)
    beforeAction = async () => { throw new Error('desktop action failed') }
    await act(async () => { r.root.findByType(Toolbar).props.onRunFromSelected(); await Promise.resolve() })
    expect(executed).toEqual(['SELECTED {{öğe}}'])
    expect(dispatched).toHaveLength(1)
    expect(logs(r)).toContain('desktop action failed')
    expect(r.root.findByType(Toolbar).props.running).toBe(false)
  })
  it('keeps live and stopped highlights through three package views', async () => {
    const s = scenario(3), r = await mount()
    let release!: () => void
    beforeAction = async node => {
      if (node.id === s.selected.id) await new Promise<void>(resolve => { release = resolve })
    }
    await act(async () => { r.root.findByType(Toolbar).props.onRun(); await Promise.resolve() })
    let canvas = r.root.findByType(NodeCanvas)
    expect(canvas.props.runPhase).toBe('running')
    expect(canvas.props.highlightedNodeIds).toEqual([s.path[0]])
    const seenEdges = [...canvas.props.traversedEdges]
    for (let i = 0; i < s.path.length; i++) {
      await act(async () => { r.root.findByType(NodeCanvas).props.onEnterPackage(s.path[i]) })
      canvas = r.root.findByType(NodeCanvas)
      expect(canvas.props.highlightedNodeIds).toEqual([s.path[i + 1] ?? s.selected.id])
      expect([...canvas.props.traversedEdges]).toEqual(seenEdges)
    }
    const exit = () => r.root.findAllByType('button').find(b => b.props.className?.includes('package-exit'))!
    expect(exit().props.disabled).toBe(false)
    await act(async () => { exit().props.onClick() })
    expect(r.root.findByType(NodeCanvas).props.highlightedNodeIds).toEqual([s.path[2]])
    await act(async () => { r.root.findByType(Toolbar).props.onStop(); release(); await Promise.resolve() })
    canvas = r.root.findByType(NodeCanvas)
    expect(canvas.props.runPhase).toBe('stopped')
    expect(canvas.props.highlightedNodeIds).toEqual([s.selected.id])
    expect(canvas.props.selectedNodeId).toBe(s.selected.id)
    expect(canvas.props.focus.nodeId).toBe(s.selected.id)
    // Stop opened the deepest view automatically. Subsequent manual navigation
    // must remain under the user's control, not snap back on every render.
    await act(async () => { exit().props.onClick() })
    expect(r.root.findByType(NodeCanvas).props.highlightedNodeIds).toEqual([s.path[2]])
    await act(async () => { r.root.findByType(NodeCanvas).props.onEnterPackage(s.path[2]) })
    expect(r.root.findByType(NodeCanvas).props.highlightedNodeIds).toEqual([s.selected.id])
    expect(r.root.findByType(NodeCanvas).props.running).toBe(false)
  })
  it('automatically opens the failing leaf from the root without manual package navigation', async () => {
    const s = scenario(3), r = await mount()
    beforeAction = async node => { if (node.id === s.selected.id) throw new Error('nested desktop failure') }
    await act(async () => { r.root.findByType(Toolbar).props.onRun(); await Promise.resolve() })
    const canvas = r.root.findByType(NodeCanvas)
    expect(canvas.props.runPhase).toBe('stopped')
    expect(canvas.props.graph.nodes.some((n: AgentNode) => n.id === s.selected.id)).toBe(true)
    expect(canvas.props.selectedNodeId).toBe(s.selected.id)
    expect(canvas.props.focus.nodeId).toBe(s.selected.id)
    expect(dispatched).toHaveLength(1)
  })
  it('opens the actual failed loop member even if execution later reaches End', async () => {
    const start = createNode('start', 0, 0), write = task('loop member'), end = createNode('end', 900, 0)
    const loop = { ...createNode('loop', 200, 0), items: ['one', 'two'], members: [write.id] }
    book = normalizeCanvasBook({ activeId: 'active', tabs: [{ id: 'active', name: 'Active', graph: {
      nodes: [start, loop, write, end], edges: [edge(start, loop), edge(loop, end, 'done')],
    } }] })
    const r = await mount()
    let actions = 0
    beforeAction = async () => { if (++actions === 1) throw new Error('first item failed') }
    await act(async () => { r.root.findByType(Toolbar).props.onRun(); await Promise.resolve() })
    const canvas = r.root.findByType(NodeCanvas)
    expect(actions).toBe(2)
    expect(canvas.props.stepStatus[end.id]).toBe('done')
    expect(canvas.props.runPhase).toBe('stopped')
    expect(canvas.props.selectedNodeId).toBe(write.id)
    expect(canvas.props.focus.nodeId).toBe(write.id)
    expect(canvas.props.highlightedNodeIds).toEqual([loop.id, write.id])
  })
  it('clears highlights after normal completion and resets arrows between canvases', async () => {
    const s = scenario(0), r = await mount()
    await select(r, [], s.selected.id)
    await act(async () => { r.root.findByType(Toolbar).props.onRunFromSelected(); await Promise.resolve() })
    const canvas = r.root.findByType(NodeCanvas)
    expect(canvas.props.runPhase).toBe('idle')
    expect(canvas.props.highlightedNodeIds).toEqual([])
    expect([...canvas.props.traversedEdges]).toEqual(book.tabs[2].graph.edges.map(e => e.id))
    expect([...canvas.props.traversedEdges]).not.toContain(book.tabs[1].graph.edges[0].id)
  })
  it('package-path runs without End reporting retain the legacy result shape', async () => {
    const s = scenario()
    const summary = await runGraph(book.tabs[1].graph, {
      log: () => {}, step: () => {}, shouldStop: () => false,
      click: async () => {}, type: async () => {}, key: async () => {}, exists: async () => true,
    }, { maxSteps: 100, stepDelayMs: 0, startId: s.selected.id, packagePath: s.path, resume: true })
    expect(summary).toEqual({ steps: 4, failed: 0 })
  })
})
