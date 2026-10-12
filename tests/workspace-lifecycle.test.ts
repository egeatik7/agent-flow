// @vitest-environment jsdom
import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNode, DEFAULT_SETTINGS, normalizeCanvasBook, type CanvasBook } from '../electron/graph-types'
import LibraryTree from '../src/components/LibraryTree'
import CanvasLibrary from '../src/components/CanvasLibrary'
import CanvasTabs from '../src/components/CanvasTabs'
import SaveCanvasDialog from '../src/components/SaveCanvasDialog'
import WorkspaceNameDialog from '../src/components/WorkspaceNameDialog'
import NodeCanvas from '../src/components/NodeCanvas'

vi.mock('react-dom',()=>({createPortal:(children:unknown)=>children}))
vi.mock('../src/components/TitleBar', () => ({ default: () => null }))
vi.mock('../src/components/Toolbar', () => ({ default: () => null }))
vi.mock('../src/components/NodeCanvas', () => ({ default: () => null }))
vi.mock('../src/components/LogPanel', () => ({ default: () => null }))
vi.mock('../src/components/ScreenScanner', () => ({ default: () => null }))
vi.mock('../src/components/SidePanel', () => ({ default: (p: { canvasPanel: unknown }) => p.canvasPanel }))

let App: typeof import('../src/App').default
let renderer: ReactTestRenderer | undefined
let seed: CanvasBook, disk: CanvasBook | undefined
let fail = false, loadFail = false
let requestClose: (id: unknown) => void = () => {}
let saveOverride: ((book: CanvasBook) => Promise<boolean>) | undefined
const replies: { id: number; allow: boolean }[] = []
const writes: CanvasBook[] = []
const api = {
  getSettings: async () => DEFAULT_SETTINGS,
  getCanvases: async () => { if (loadFail) throw new Error('profile read failed'); return structuredClone(seed) },
  saveCanvases: async (book: CanvasBook) => {
    writes.push(structuredClone(book))
    if (saveOverride) return saveOverride(book)
    if (fail) return false
    disk = structuredClone(book); return true
  },
  listWindows: async () => [], bootReady: () => {},
  manageLibrary: vi.fn(),
  onCloseRequested: (cb: (id: unknown) => void) => { requestClose = cb; return () => { requestClose = () => {} } },
  finishClose: async (id: number, allow: boolean) => { replies.push({ id, allow }) },
  onAgentLog: () => () => {}, onAgentStep: () => () => {}, onAgentEdge: () => () => {}, onAgentPatch: () => () => {},
}
const text = (node: ReactTestInstance): string => node.children.map(c => typeof c === 'string' ? c : text(c)).join('')
const button = (label: string) => renderer!.root.findAllByType('button').find(b => text(b) === label)!
const click = async (label: string) => {
  if(label==='Tuvali Kaydet'){await context();label='Açık Tuvali Kaydet'}
  const target = button(label); expect(target, label).toBeDefined(); expect(target.props.disabled, label).not.toBe(true)
  await act(async () => { await target.props.onClick() })
}
const mount = async () => { await act(async () => { renderer = create(createElement(App)) }) }
const context=async()=>{await act(async()=>renderer!.root.findByType(LibraryTree).props.onContext({preventDefault:()=>{},stopPropagation:()=>{},clientX:10,clientY:10}))}
const draft = async (name='Pipeline') => {
 await click('Otomasyonlar');await context();await click('Yeni Otomasyon');await context();await click('Yeniden Adlandır…')
 await act(async()=>renderer!.root.findByType(WorkspaceNameDialog).props.onAnswer(name))
 await click('Tuval Ekle…');await act(async()=>renderer!.root.findAllByType(LibraryTree).at(-1)!.props.onSelect([{kind:'canvas',id:'saved'}]));await click('Ekle')
}
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(401) }) }
const close = async (id = 1) => { await act(async () => requestClose(id)) }
const answer = async (value: 'save' | 'discard' | 'cancel') => {
  await act(async () => { renderer!.root.findByType(SaveCanvasDialog).props.onAnswer(value) })
}

beforeAll(async () => {
  Object.defineProperty(window, 'xpAgent', { configurable: true, value: api })
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 0 })
  App = (await import('../src/App')).default
})
beforeEach(() => {
  vi.useFakeTimers(); replies.length = 0; writes.length = 0; disk = undefined
  fail = false; loadFail = false; saveOverride = undefined
  api.manageLibrary.mockReset()
  seed = normalizeCanvasBook({ activeId: '', tabs: [], library: { canvases: [{ id: 'saved', name: 'Shared', updatedAt: 1, graph: { nodes: [createNode('start', 0, 0)], edges: [] } }], automations: [] } })
})
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; vi.useRealTimers() })
afterAll(() => { delete (window as unknown as { xpAgent?: unknown }).xpAgent; vi.unstubAllGlobals() })

describe('real App workspace lifecycle with the real automation editor', () => {
  it('preserves an unchanged long tab name and isolates library keyboard input from canvas edits',async()=>{
    const name='An existing canvas with its complete long name';seed.library!.canvases[0].name=name
    await mount();await act(async()=>renderer!.root.findByType(CanvasLibrary).props.onOpenCanvas(seed.library!.canvases[0]));const tabs=renderer!.root.findByType(CanvasTabs).props
    const before=writes.length;await act(async()=>tabs.onRename(tabs.activeId,name));expect(writes).toHaveLength(before);expect(renderer!.root.findByType(CanvasTabs).props.tabs[0].name).toBe(name)
    const id=renderer!.root.findByType(NodeCanvas).props.graph.nodes[0].id;await act(async()=>renderer!.root.findByType(NodeCanvas).props.onSelectNode(id));const target=document.createElement('div');target.className='canvas-library';document.body.append(target)
    await act(async()=>{target.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}))});expect(renderer!.root.findByType(NodeCanvas).props.graph.nodes[0].id).toBe(id);target.remove()
  })
  it('autosaves automation typing and membership as a draft, and survives a restart without publishing it', async () => {
    await mount(); await draft(); await tick()
    expect(disk!.library!.automations).toEqual([])
    expect(disk!.automationDraft?.name).toBe('Pipeline')
    expect(disk!.automationDraft?.entries[0].canvasId).toBe('saved')
    seed = structuredClone(disk!)
    act(() => renderer!.unmount()); renderer = undefined
    await mount()
    expect(renderer!.root.findByType(CanvasLibrary).props.draft.name).toBe('Pipeline')
    expect(text(renderer!.root)).toContain('Shared')
    expect(disk!.library!.automations).toEqual([])
    await click('Kaydet')
    expect(disk!.library!.automations[0].name).toBe('Pipeline')
    // No debounce tick: the same acknowledged write must already contain the saved draft.
    expect(disk!.automationDraft?.id).toBe(disk!.library!.automations[0].id)
    expect(disk!.automationDraft?.expected).toEqual(disk!.library!.automations[0])
  })
  it('Cancel on native close keeps the automation draft and rejects the close request', async () => {
    await mount(); await draft(); await close()
    expect(renderer!.root.findByType(SaveCanvasDialog).props.kind).toBe('automation')
    await answer('cancel')
    expect(replies).toEqual([{ id: 1, allow: false }])
    expect(renderer!.root.findByType(CanvasLibrary).props.draft.name).toBe('Pipeline')
    expect(disk!.library!.automations).toEqual([])
  })
  it('Discard on native close removes only the draft and never creates a saved automation', async () => {
    await mount(); await draft(); await close(); await answer('discard')
    expect(replies).toEqual([{ id: 1, allow: true }])
    expect(disk!.automationDraft).toBeUndefined()
    expect(disk!.library!.automations).toEqual([])
    expect(disk!.library!.canvases).toHaveLength(1)
  })
  it('a failed automation Save blocks native closure, retains the attempted draft and permits a retry', async () => {
    await mount(); await draft(); await close()
    fail = true; await answer('save')
    expect(replies).toEqual([{ id: 1, allow: false }])
    expect(text(renderer!.root)).toContain('Taslak korunuyor')
    expect(renderer!.root.findByType(CanvasLibrary).props.draft.name).toBe('Pipeline')
    expect(disk!.library!.automations).toEqual([])
    fail = false; await click('Tekrar Dene')
    expect(disk!.library!.automations[0].name).toBe('Pipeline')
    await close(2)
    expect(replies.at(-1)).toEqual({ id: 2, allow: true })
  })
  it('Save All atomically includes active node edits and the automation draft', async () => {
    await mount()
    await act(async () => renderer!.root.findByType(CanvasLibrary).props.onOpenCanvas(seed.library!.canvases[0]))
    const graph = renderer!.root.findByType(NodeCanvas).props.graph
    await act(async () => renderer!.root.findByType(NodeCanvas).props.onMoveNodes({ [graph.nodes[0].id]: { x: 77, y: 0 } }))
    await draft(); const before = writes.length
    await act(async () => renderer!.root.findByType(CanvasLibrary).props.onSaveAll())
    expect(writes).toHaveLength(before + 1)
    expect(disk!.library!.canvases[0].graph.nodes[0].x).toBe(77)
    expect(disk!.library!.automations[0].name).toBe('Pipeline')
    expect(disk!.automationDraft?.expected?.name).toBe('Pipeline')
    expect(renderer!.root.findByType(CanvasTabs).props.tabs[0].dirty).toBe(false)
  })
  // 1.9.92: Kurtarilan calismalar paneli kullanici istegiyle KALDIRILDI; kurtarma taslaklari kitapta durmaya devam ediyor.
it.skip('recovers a modified canvas separately and updates the original only after explicit Save', async () => {
    const record = seed.library!.canvases[0]
    seed.tabs = [{ id: 'interrupted', name: record.name, savedId: record.id, baseline: { name: record.name, graph: structuredClone(record.graph) }, graph: structuredClone(record.graph) }]
    seed.tabs[0].graph.nodes[0].x = 99; seed.activeId = 'interrupted'
    await mount()
    expect(disk!.library!.canvases[0].graph.nodes[0].x).toBe(0)
    expect(renderer!.root.findByType(CanvasTabs).props.tabs).toEqual([])
    await click('Taslağı Aç')
    expect(renderer!.root.findByType(NodeCanvas).props.graph.nodes[0].x).toBe(99)
    expect(disk!.recovery).toEqual([])
    await click('Tuvali Kaydet')
    expect(disk!.library!.canvases).toHaveLength(1)
    expect(disk!.library!.canvases[0].graph.nodes[0].x).toBe(99)
  })
  it('does not write an empty profile when initial loading fails', async () => {
    loadFail = true; await mount(); await tick(); await close()
    expect(writes).toEqual([])
    expect(text(renderer!.root)).toContain('Kayıtlar açılamadı')
    expect(replies).toEqual([{ id: 1, allow: true }])
  })
  it('can choose a moved library after startup fails without writing over the missing catalog', async () => {
    loadFail=true;await mount();await tick();expect(writes).toEqual([])
    api.manageLibrary.mockResolvedValue({directory:'D:\\My Library',book:structuredClone(seed)})
    await click('Kütüphane Aç…')
    expect(api.manageLibrary).toHaveBeenCalledWith('open')
    expect(text(renderer!.root)).not.toContain('Kayıtlar açılamadı')
    expect(renderer!.root.findByType(CanvasLibrary).props.disabled).toBe(false)
    expect(renderer!.root.findByType(CanvasLibrary).props.library.canvases[0].id).toBe('saved')
  })
  it('reload adopts the external catalog for the next autosave while retaining open canvas and automation drafts', async () => {
    await mount()
    await act(async () => renderer!.root.findByType(CanvasLibrary).props.onOpenCanvas(seed.library!.canvases[0]))
    const graph = renderer!.root.findByType(NodeCanvas).props.graph
    await act(async () => renderer!.root.findByType(NodeCanvas).props.onMoveNodes({ [graph.nodes[0].id]: { x: 77, y: 0 } }))
    await draft(); await tick()
    const localDraft = structuredClone(disk!.automationDraft)
    const openTabs = structuredClone(disk!.tabs)
    const fresh = structuredClone(seed.library!)
    fresh.canvases[0].graph.nodes[0].title = 'Changed externally'
    fresh.canvases.push({ id: 'external', name: 'External canvas', graph: { nodes: [], edges: [] }, updatedAt: 2 })
    api.manageLibrary.mockResolvedValue({ directory: 'D:\\Library', book: { ...seed, library: fresh } })
    await act(async () => renderer!.root.findByType(CanvasLibrary).props.onManageLibrary('reload'))
    expect(renderer!.root.findByType(CanvasLibrary).props.library).toEqual(fresh)
    expect(renderer!.root.findByType(NodeCanvas).props.graph.nodes[0].x).toBe(77)
    expect(renderer!.root.findByType(CanvasLibrary).props.draft).toEqual(localDraft)
    await tick()
    expect(disk!.library).toEqual(fresh)
    expect(disk!.tabs).toEqual(openTabs)
    expect(disk!.automationDraft).toEqual(localDraft)
    // Reload must not replace the baseline: saving an old draft over the newer record is rejected.
    await act(async () => renderer!.root.findByType(CanvasLibrary).props.onSaveAll())
    expect(disk!.library).toEqual(fresh)
    expect(renderer!.root.findByType(CanvasTabs).props.tabs[0].dirty).toBe(true)
  })
  it('reload waits for pending writes and blocks additional stale autosaves until the fresh catalog is adopted', async () => {
    await mount(); await draft()
    let release!: (result: boolean) => void
    saveOverride = () => new Promise(resolve => { release = resolve })
    await tick()
    const pendingWrites = writes.length
    const fresh = structuredClone(seed.library!)
    fresh.canvases[0].name = 'External rename'
    api.manageLibrary.mockResolvedValue({ directory: 'D:\\Library', book: { ...seed, library: fresh } })
    let reload!: Promise<void>
    await act(async () => { reload = renderer!.root.findByType(CanvasLibrary).props.onManageLibrary('reload') })
    expect(api.manageLibrary).not.toHaveBeenCalled()
    // Changing a draft while the previous write is draining cannot enqueue another old catalog.
    await act(async () => renderer!.root.findByType(CanvasLibrary).props.onDraftChange({ ...disk!.automationDraft, key: 'draft', name: 'Latest draft', entries: [] }))
    await tick()
    expect(writes).toHaveLength(pendingWrites)
    saveOverride = undefined
    await act(async () => { release(true); await reload })
    expect(api.manageLibrary).toHaveBeenCalledExactlyOnceWith('reload')
    await tick()
    expect(disk!.library).toEqual(fresh)
    expect(disk!.automationDraft?.name).toBe('Latest draft')
  })
  it('an older pending autosave finishes before explicit Save and cannot later undo it', async () => {
    await mount(); await draft()
    let release!: (result: boolean) => void
    saveOverride = () => new Promise(resolve => { release = resolve })
    await tick()
    const pending = writes.length
    await act(async () => { button('Kaydet').props.onClick() })
    expect(writes).toHaveLength(pending)
    saveOverride = undefined
    await act(async () => release(true))
    expect(disk!.library!.automations[0].name).toBe('Pipeline')
    await tick()
    expect(disk!.library!.automations[0].name).toBe('Pipeline')
  })
  it('Save As creates a separate record through the real menu dialog', async () => {
    await mount()
    await act(async () => renderer!.root.findByType(CanvasLibrary).props.onOpenCanvas(seed.library!.canvases[0]))
    await click('Dosya'); await click('Tuvali Farklı Kaydet')
    await act(async () => renderer!.root.findByType(WorkspaceNameDialog).props.onAnswer('Independent'))
    expect(disk!.library!.canvases.map(c => c.name)).toEqual(['Shared', 'Independent'])
    expect(disk!.tabs[0].savedId).not.toBe('saved')
  })
  it('Ctrl+S saves current work from a text input without opening the browser Save Page action', async () => {
    await mount()
    await act(async () => renderer!.root.findByType(CanvasLibrary).props.onOpenCanvas(seed.library!.canvases[0]))
    const graph = renderer!.root.findByType(NodeCanvas).props.graph
    await act(async () => renderer!.root.findByType(NodeCanvas).props.onMoveNodes({ [graph.nodes[0].id]: { x: 42, y: 0 } }))
    const input = document.createElement('input'); document.body.appendChild(input)
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
    await act(async () => { input.dispatchEvent(event) })
    input.remove()
    expect(event.defaultPrevented).toBe(true)
    expect(disk!.library!.canvases[0].graph.nodes[0].x).toBe(42)
  })
  it('saving the open order creates its new automation and unsaved canvas together', async () => {
    await mount()
    await act(async () => renderer!.root.findByType(CanvasTabs).props.onAdd())
    await act(async () => renderer!.root.findByType(CanvasLibrary).props.onSaveSequence())
    await act(async () => renderer!.root.findByType(WorkspaceNameDialog).props.onAnswer('From tabs'))
    expect(disk!.library!.canvases).toHaveLength(2)
    expect(disk!.library!.automations[0].name).toBe('From tabs')
    expect(disk!.library!.automations[0].entries[0].canvasId).toBe(disk!.tabs[0].savedId)
  })
})
