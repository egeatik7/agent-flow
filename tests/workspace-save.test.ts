import { describe, expect, it, vi } from 'vitest'
import { addCanvasTab, libraryOf, openSavedCanvas, saveCanvas, saveCanvasAs, saveAutomation } from '../electron/canvas-library'
import { canvasDirty, discardCanvasDraft, restoreCanvasDraft, startCanvasSession } from '../electron/canvas-session'
import { createNode, normalizeCanvasBook, type CanvasBook } from '../electron/graph-types'
import { saveOpenSequence, saveWorkspace } from '../electron/workspace-save'
import { readWorkspace, writeWorkspace } from '../electron/workspace-store'

const empty = (): CanvasBook => normalizeCanvasBook({ activeId: '', tabs: [], library: { canvases: [], automations: [] }, branches: [{ id: 'tool' }] })
const add = (book = empty(), name = 'A') => addCanvasTab(book, name, { nodes: [createNode('start', 0, 0)], edges: [] })
const saved = () => { const book = add(); return saveCanvas(book, book.activeId) }
const edit = (book: CanvasBook) => { book.tabs[0].graph.nodes[0].title = 'edited'; return book }

describe('unified workspace saves', () => {
  it('Save All explicitly saves an untouched new canvas and a draft without changing its input', () => {
    const book = add()
    book.automationDraft = { key: 'draft', name: 'List', entries: [] }
    const before = structuredClone(book), next = saveWorkspace(book)
    expect(libraryOf(next).canvases).toHaveLength(1)
    expect(libraryOf(next).automations).toHaveLength(1)
    expect(next.automationDraft?.expected?.id).toBe(libraryOf(next).automations[0].id)
    expect(canvasDirty(next, next.tabs[0])).toBe(false)
    expect(book).toEqual(before)
  })
  it('a stale automation aborts Save All without publishing earlier canvas saves', () => {
    let book = saved()
    book = saveAutomation(book, { name: 'List', entries: [] })
    const automation = libraryOf(book).automations[0]
    book.automationDraft = { key: 'draft', ...structuredClone(automation), expected: structuredClone(automation), name: 'Draft' }
    book = saveAutomation(book, { ...automation, name: 'Newer', expected: automation })
    edit(book)
    const before = structuredClone(book)
    expect(() => saveWorkspace(book)).toThrow(/değişti/)
    expect(book).toEqual(before)
    expect(libraryOf(book).canvases[0].graph.nodes[0].title).not.toBe('edited')
  })
  it('conflicting edits of two copies abort the complete Save All', () => {
    let book = saved()
    book = openSavedCanvas(book, libraryOf(book).canvases[0])
    book.tabs[0].graph.nodes[0].title = 'one'
    book.tabs[1].graph.nodes[0].title = 'two'
    const before = structuredClone(book)
    expect(() => saveWorkspace(book)).toThrow(/başka bir sekmeden/)
    expect(book).toEqual(before)
  })
  it('Save As resolves a stale copy without changing the shared record or automation links', () => {
    let book = saved()
    book = saveAutomation(book, { name: 'List', entries: [{ id: 'step', canvasId: book.tabs[0].savedId! }] })
    book = openSavedCanvas(book, libraryOf(book).canvases[0])
    book.tabs[0].graph.nodes[0].title = 'newer'
    book = saveCanvas(book, book.tabs[0].id)
    book.tabs[1].graph.nodes[0].title = 'independent'
    const next = saveCanvasAs(book, book.tabs[1].id, 'Separate')
    expect(libraryOf(next).canvases).toHaveLength(2)
    expect(libraryOf(next).canvases[0].graph.nodes[0].title).toBe('newer')
    expect(libraryOf(next).canvases[1].graph.nodes[0].title).toBe('independent')
    expect(libraryOf(next).automations).toEqual(libraryOf(book).automations)
    expect(next.tabs[1].savedId).not.toBe(next.tabs[0].savedId)
  })
  it('captures an actual open order and unsaved canvases together', () => {
    const book = add(add(empty(), 'First'), 'Second')
    const next = saveOpenSequence({ ...book, tabs: [...book.tabs].reverse() }, 'Production')
    const lib = libraryOf(next)
    expect(lib.canvases.map(c => c.name)).toEqual(['Second', 'First'])
    expect(lib.automations[0].entries.map(e => e.canvasId)).toEqual(next.tabs.map(t => t.savedId))
    expect(book.library!.canvases).toEqual([])
  })
  it('preserves repeated queue steps while storing their canvas only once', () => {
    let book = saved(); book = openSavedCanvas(book, libraryOf(book).canvases[0])
    const next = saveOpenSequence(book, 'Repeat')
    expect(libraryOf(next).canvases).toHaveLength(1)
    expect(libraryOf(next).automations[0].entries.map(e => e.canvasId)).toEqual([book.tabs[0].savedId, book.tabs[0].savedId])
    expect(new Set(libraryOf(next).automations[0].entries.map(e => e.id)).size).toBe(2)
  })
  it('cannot create a partial sequence when its name is invalid', () => {
    const book = add(), before = structuredClone(book)
    expect(() => saveOpenSequence(book, ' ')).toThrow(/adı boş/)
    expect(book).toEqual(before)
    expect(() => saveOpenSequence(empty(), 'Empty')).toThrow(/açık tuval/)
  })
})

describe('isolated crash recovery', () => {
  it('keeps interrupted content out of the catalog and restores its original identity/baseline', () => {
    const book = edit(saved()), source = structuredClone(libraryOf(book))
    const started = startCanvasSession(book)
    expect(libraryOf(started)).toEqual(source)
    expect(started.tabs).toEqual([])
    const restored = restoreCanvasDraft(started, started.recovery![0].id)
    expect(restored.recovery).toEqual([])
    expect(restored.tabs[0].savedId).toBe(book.tabs[0].savedId)
    expect(canvasDirty(restored, restored.tabs[0])).toBe(true)
    expect(libraryOf(saveCanvas(restored, restored.activeId)).canvases).toHaveLength(1)
  })
  it('does not duplicate a recovery entry on repeated startup', () => {
    const book = edit(saved()), started = startCanvasSession(book)
    const again = startCanvasSession({ ...started, tabs: book.tabs })
    expect(again.recovery).toHaveLength(1)
    expect(startCanvasSession(again).recovery).toHaveLength(1)
  })
  it('discarding recovery never deletes the original saved record or other recoveries', () => {
    const book = edit(saved()), started = startCanvasSession(book)
    const next = discardCanvasDraft(started, started.recovery![0].id)
    expect(next.recovery).toEqual([])
    expect(next.library).toBe(started.library)
    expect(() => restoreCanvasDraft(next, 'missing')).toThrow()
  })
  it('keeps an unsaved automation draft and its stale expected version through normalization', () => {
    const book = empty()
    book.automationDraft = { key: 'draft', id: 'group', name: 'Edits', entries: [{ id: 'step', canvasId: 'missing' }],
      expected: { id: 'group', name: 'Before', entries: [{ id: 'step', canvasId: 'missing' }], updatedAt: 1 } }
    expect(normalizeCanvasBook(startCanvasSession(book)).automationDraft).toEqual(book.automationDraft)
    expect(libraryOf(startCanvasSession(book)).automations).toEqual([])
  })
  it('a stale recovered edit cannot overwrite a later saved version', () => {
    const book = edit(saved()), started = startCanvasSession(book)
    started.library!.canvases[0].graph.nodes[0].title = 'later saved version'
    const restored = restoreCanvasDraft(started, started.recovery![0].id), before = structuredClone(restored)
    expect(() => saveCanvas(restored, restored.activeId)).toThrow(/başka bir sekmeden/)
    expect(restored).toEqual(before)
  })
  it('live loop highlights and a zero default cursor do not create false dirty/conflict/recovery states', () => {
    const book = saved(), loop = createNode('loop', 20, 20)
    book.tabs[0].graph.nodes.push(loop)
    const next = saveCanvas(book, book.activeId)
    next.tabs[0].graph.nodes[1].loopIndex = 2
    next.tabs[0].graph.nodes[1].startIndex = 0
    next.tabs[0].graph.nodes[1].templated = true
    expect(canvasDirty(next, next.tabs[0])).toBe(false)
    expect(startCanvasSession(next).recovery).toEqual([])
    expect(() => saveCanvas(next, next.activeId)).not.toThrow()
    next.tabs[0].graph.nodes[1].folder = 'Changed input'
    expect(canvasDirty(next, next.tabs[0])).toBe(true)
  })
})

describe('atomic Electron workspace boundary', () => {
  it('migrates only absent books and rejects malformed books instead of replacing them from a legacy graph', () => {
    const legacy = add().tabs[0].graph
    expect(readWorkspace(undefined, legacy).library!.canvases).toHaveLength(1)
    for (const bad of [null, 'broken', { library: saved().library }, { tabs: 'broken' }]) expect(() => readWorkspace(bad, legacy)).toThrow(/korunuyor/)
    expect(readWorkspace(empty(), legacy).tabs).toEqual([])
  })
  it('writes catalog, drafts and the legacy graph in one store operation while preserving tool branches', () => {
    const book = edit(saved()), set = vi.fn(), latest = { ...book, branches: [{ id: 'new tool branch' }] }
    writeWorkspace({ set }, book, latest)
    expect(set).toHaveBeenCalledTimes(1)
    const payload = set.mock.calls[0][0]
    expect(payload.graph).toEqual(book.tabs[0].graph)
    expect(payload.canvases.library).toEqual(book.library)
    expect(payload.canvases.branches).toEqual(latest.branches)
    writeWorkspace({ set }, { ...book, activeId: '', tabs: [] }, latest)
    expect(set.mock.calls[1][0].graph).toEqual({ nodes: [], edges: [] })
  })
  it('does not acknowledge a write failure or attempt a second partial legacy write', () => {
    const set = vi.fn(() => { throw new Error('disk full') })
    expect(() => writeWorkspace({ set }, saved(), empty())).toThrow('disk full')
    expect(set).toHaveBeenCalledTimes(1)
  })
})
