import { describe, expect, it, vi } from 'vitest'
import { addCanvasTab, closeCanvasTab, deleteSavedCanvas, openSavedCanvas, saveAutomation, saveCanvas } from '../electron/canvas-library'
import { canvasDirty, emptyCanvasSession, settleCanvasChanges, startCanvasSession, type SaveDecision } from '../electron/canvas-session'
import { createNode, normalizeCanvasBook, type CanvasBook, type CanvasTab } from '../electron/graph-types'
import { WindowCloseGuard } from '../electron/window-close'

const blank = (): CanvasBook => normalizeCanvasBook({ activeId: '', tabs: [], library: { canvases: [], automations: [] }, branches: [{ id: 'keep' }] })
const added = (book = blank(), name = 'A') => addCanvasTab(book, name, { nodes: [createNode('start', 40, 80)], edges: [] })
const edit = (book: CanvasBook, index = 0) => { book.tabs[index].graph.nodes[0].x += 10; return book }

describe('canvas sessions and explicit save decisions', () => {
  it('keeps an empty session empty through normalization, including legacy graph fallback', () => {
    expect(normalizeCanvasBook(blank(), added().tabs[0].graph).tabs).toEqual([])
    expect(normalizeCanvasBook(blank()).activeId).toBe('')
    const book = added(), closed = closeCanvasTab(book, book.activeId)
    expect(closed.tabs).toEqual([]); expect(closed.activeId).toBe('')
    expect(closed.branches).toEqual([{ id: 'keep' }])
  })
  it('tracks new canvas edits, names, node movement and nested package changes', () => {
    const book = added(), tab = book.tabs[0]
    expect(canvasDirty(book, tab)).toBe(false)
    edit(book); expect(canvasDirty(book, tab)).toBe(true)
    const saved = saveCanvas(book, tab.id)
    expect(canvasDirty(saved, saved.tabs[0])).toBe(false)
    saved.tabs[0].name = 'Renamed'; expect(canvasDirty(saved, saved.tabs[0])).toBe(true)
    const pkg = createNode('package', 300, 0); pkg.inner = { nodes: [createNode('type', 0, 0)], edges: [] }
    saved.tabs[0].graph.nodes.push(pkg)
    const nested = saveCanvas(saved, tab.id)
    nested.tabs[0].graph.nodes[1].inner!.nodes[0].text = 'Changed inside package'
    expect(canvasDirty(nested, nested.tabs[0])).toBe(true)
  })
  it('does not mark an untouched independent copy dirty after another copy is saved', () => {
    let book = added(); book = saveCanvas(book, book.activeId)
    book = openSavedCanvas(book, book.library!.canvases[0])
    edit(book, 0); book = saveCanvas(book, book.tabs[0].id)
    expect(canvasDirty(book, book.tabs[1])).toBe(false)
    const deleted = deleteSavedCanvas(book, book.tabs[1].savedId!)
    expect(canvasDirty(deleted, deleted.tabs[1])).toBe(true)
  })
  it('opens no tabs at startup but retains catalog, groups and branches', () => {
    let book = added(); book = saveCanvas(book, book.activeId)
    book = saveAutomation(book, { name: 'Container', entries: [{ id: 'entry', canvasId: book.tabs[0].savedId! }] })
    const start = startCanvasSession(book)
    expect(start.tabs).toEqual([]); expect(start.activeId).toBe('')
    expect(start.library).toEqual(book.library); expect(start.branches).toEqual(book.branches)
  })
  it('recovers interrupted edits without replacing the saved canvas used by automations', () => {
    let book = added(); book = saveCanvas(book, book.activeId)
    const original = structuredClone(book.library!.canvases[0])
    edit(book)
    const start = startCanvasSession(book)
    expect(start.tabs).toEqual([]); expect(start.library!.canvases).toHaveLength(2)
    expect(start.library!.canvases[0]).toEqual(original)
    expect(start.library!.canvases[1].name).toBe('A (Kurtarılan)')
    expect(startCanvasSession(start).library).toEqual(start.library)
  })
  it('asks changed canvases in tab order, skips clean ones and persists each Save', async () => {
    let book = edit(added()); book = added(book, 'Clean'); book = edit(added(book, 'B'), 2)
    const decisions: SaveDecision[] = ['save', 'discard']
    const ask = vi.fn(async (_tab: CanvasTab): Promise<SaveDecision> => decisions.shift()!)
    const persist = vi.fn(async (next: CanvasBook) => { book = next; return true })
    expect(await settleCanvasChanges(() => book, ask, persist)).toBe(true)
    expect(ask.mock.calls.map(call => call[0].name)).toEqual(['A', 'B'])
    expect(persist).toHaveBeenCalledTimes(1)
    expect(book.library!.canvases.map(c => c.name)).toEqual(['A'])
    const closed = emptyCanvasSession(book)
    expect(startCanvasSession(closed).library!.canvases.map(c => c.name)).toEqual(['A'])
  })
  it('Cancel retains all tabs, including earlier saves, and stops asking', async () => {
    let book = edit(added()); book = edit(added(book, 'B'), 1); book = edit(added(book, 'C'), 2)
    const decisions: SaveDecision[] = ['save', 'cancel']
    const ask = vi.fn(async (): Promise<SaveDecision> => decisions.shift()!)
    expect(await settleCanvasChanges(() => book, ask, async next => { book = next; return true })).toBe(false)
    expect(book.tabs.map(t => t.name)).toEqual(['A', 'B', 'C'])
    expect(book.library!.canvases.map(c => c.name)).toEqual(['A'])
    expect(ask).toHaveBeenCalledTimes(2)
  })
  it('a failed save aborts closure without promoting content or losing working tabs', async () => {
    let book = edit(added()); book = edit(added(book, 'B'), 1)
    const before = structuredClone(book), ask = vi.fn(async (): Promise<SaveDecision> => 'save')
    expect(await settleCanvasChanges(() => book, ask, async () => false)).toBe(false)
    expect(book).toEqual(before); expect(ask).toHaveBeenCalledTimes(1)
  })
})

describe('native close request gate', () => {
  it('waits for one matching renderer acknowledgement, blocking repeated and stale requests', () => {
    const guard = new WindowCloseGuard(), send = vi.fn()
    expect(guard.request(send)).toBe(true)
    guard.ready = true
    expect(guard.request(send)).toBe(false); expect(guard.request(send)).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
    expect(guard.reply(999, true)).toBe(false)
    expect(guard.reply(1, false)).toBe(false)
    expect(guard.request(send)).toBe(false); expect(send).toHaveBeenLastCalledWith(2)
    expect(guard.reply(1, true)).toBe(false)
    expect(guard.reply(2, true)).toBe(true)
    expect(guard.request(send)).toBe(true)
  })
})
