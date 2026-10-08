import { describe, expect, it } from 'vitest'
import { createNode, normalizeCanvasBook, type CanvasBook } from '../electron/graph-types'
import { addCanvasTab, closeCanvasTab, activateCanvasSnapshot, deleteAutomation, deleteSavedCanvas, editAutomationCanvas, exportAutomation, importAutomation, libraryOf, moveCanvasTab, openAutomation, openSavedCanvas, renameAutomation, saveAutomation, saveCanvas } from '../electron/canvas-library'
const graph = () => ({ nodes: [createNode('start', 0, 0), createNode('end', 100, 0)], edges: [] })
const book = (): CanvasBook => normalizeCanvasBook({ activeId: 'b', tabs: [{ id: 'a', name: 'A', graph: graph() }, { id: 'b', name: 'B', graph: graph() }], branches: [{ id: 'keep' }] })

describe('saved canvases and ordered automation snapshots', () => {
  it('migrates old tabs once, preserving active tab, order and branches', () => {
    const b = book()
    expect(b.activeId).toBe('b')
    expect(libraryOf(b).canvases.map(c => c.name)).toEqual(['A', 'B'])
    expect(b.branches).toEqual([{ id: 'keep' }])
    b.tabs[0].graph.nodes[0].title = 'edited'
    expect(libraryOf(b).canvases[0].graph.nodes[0].title).not.toBe('edited')
    expect(normalizeCanvasBook(b).library).toEqual(b.library)
  })
  it('does not resurrect intentionally deleted records on reload', () => {
    let b = book()
    for (const c of libraryOf(b).canvases) b = deleteSavedCanvas(b, c.id)
    expect(normalizeCanvasBook(b).library?.canvases).toEqual([])
    expect(b.tabs.map(t => t.savedId)).toEqual([undefined, undefined])
  })
  it('repairs duplicate record/tab IDs and keeps a valid active tab', () => {
    const b = book(); b.tabs[1].id = 'a'; b.library!.canvases[1].id = 'a'
    const normalized = normalizeCanvasBook(b)
    expect(new Set(normalized.tabs.map(t => t.id)).size).toBe(2)
    expect(new Set(normalized.library!.canvases.map(t => t.id)).size).toBe(2)
    expect(normalized.tabs.some(t => t.id === normalized.activeId)).toBe(true)
  })
  it('save updates the linked record, even with same-name canvases', () => {
    const b = book(); b.tabs[1].name = 'A'; b.tabs[1].graph.nodes[0].title = 'changed'
    const saved = saveCanvas(b, 'b')
    expect(saved.library!.canvases).toHaveLength(2)
    expect(saved.library!.canvases[0].graph.nodes[0].title).not.toBe('changed')
    expect(saved.library!.canvases[1].graph.nodes[0].title).toBe('changed')
    b.tabs[1].graph.nodes[0].title = 'later'
    expect(saved.library!.canvases[1].graph.nodes[0].title).toBe('changed')
    expect(() => saveCanvas(b, 'missing')).toThrow()
  })
  it('opens independent new tabs and can save an unlinked tab as a new record', () => {
    const b = book(); const c = b.library!.canvases[0]
    const first = openSavedCanvas(b, c), second = openSavedCanvas(first, c)
    expect(new Set(second.tabs.map(t => t.id)).size).toBe(4)
    second.tabs[2].graph.nodes[0].title = 'only new tab'
    expect(c.graph.nodes[0].title).not.toBe('only new tab')
    const unlinked = openSavedCanvas(b, c, false)
    expect(unlinked.tabs[2].savedId).toBeUndefined()
    expect(saveCanvas(unlinked, unlinked.activeId).library!.canvases).toHaveLength(3)
  })
  it('removing a saved canvas preserves open tabs and automation snapshots', () => {
    const b = saveAutomation(book(), 'Models'), deleted = deleteSavedCanvas(b, b.library!.canvases[0].id)
    expect(deleted.tabs).toHaveLength(2)
    expect(deleted.library!.automations[0].canvases).toHaveLength(2)
    expect(deleted.branches).toEqual([{ id: 'keep' }])
  })
  it('snapshots left-to-right tab order and graph content, then updates explicitly', () => {
    let b = saveAutomation(book(), 'Models'); const id = b.library!.automations[0].id
    b = moveCanvasTab(b, 'b', -1); b.tabs[0].graph.nodes[0].title = 'new edit'
    expect(b.library!.automations[0].canvases.map(c => c.name)).toEqual(['A', 'B'])
    expect(b.library!.automations[0].canvases[1].graph.nodes[0].title).not.toBe('new edit')
    b = saveAutomation(b, 'Models', id)
    expect(b.library!.automations).toHaveLength(1)
    expect(b.library!.automations[0].canvases.map(c => c.name)).toEqual(['B', 'A'])
    expect(b.activeId).toBe('b')
    expect(() => saveAutomation(b, 'name', 'deleted')).toThrow(/artık yok/)
    expect(() => saveAutomation(b, ' ')).toThrow()
  })
  it('adding and closing tabs cannot erase saved canvases, groups or branches', () => {
    const source = saveAutomation(book(), 'Models')
    const opened = addCanvasTab(source, 'C', graph())
    expect(opened.library).toBe(source.library)
    expect(opened.branches).toBe(source.branches)
    const closed = closeCanvasTab(opened, opened.activeId)
    expect(closed.tabs.map(t => t.name)).toEqual(['A', 'B'])
    expect(closed.library).toBe(source.library)
    expect(closed.branches).toBe(source.branches)
    expect(closed.activeId).toBe('b')
    expect(closeCanvasTab(closed, 'a').activeId).toBe('b')
    expect(closeCanvasTab(closeCanvasTab(closed, 'b'), 'a').tabs).toHaveLength(1)
  })
  it('starting a sequence on the left preserves edits in the previously active right tab', () => {
    const source = saveAutomation(book(), 'Models')
    const changed = { ...source, tabs: source.tabs.map(t => t.id === 'b' ? { ...t, graph: { ...t.graph, nodes: t.graph.nodes.map(n => ({ ...n, title: 'unsaved edit' })) } } : t) }
    const prepared = activateCanvasSnapshot(changed, source.tabs[0])
    expect(prepared.activeId).toBe('a')
    expect(prepared.tabs[1].graph.nodes[0].title).toBe('unsaved edit')
    expect(prepared.library).toBe(source.library)
    expect(prepared.branches).toBe(source.branches)
    expect(() => activateCanvasSnapshot(source, { ...source.tabs[0], id: 'missing' })).toThrow()
  })
  it('tab movement honors boundaries and does not change active ID', () => {
    const b = book()
    expect(moveCanvasTab(b, 'a', -1)).toBe(b)
    expect(moveCanvasTab(b, 'b', 1)).toBe(b)
    expect(moveCanvasTab(b, 'missing', 1)).toBe(b)
    const moved = moveCanvasTab(b, 'a', 1)
    expect(moved.tabs.map(t => t.id)).toEqual(['b', 'a'])
    expect(moved.activeId).toBe('b')
  })
  it('group rename, child reorder/delete, and group delete are scoped', () => {
    const source = saveAutomation(saveAutomation(book(), 'One'), 'Two')
    const a = source.library!.automations[0]
    let b = renameAutomation(source, a.id, ' Renamed ')
    b = editAutomationCanvas(b, a.id, a.canvases[1].id, 'up')
    expect(b.library!.automations[0].name).toBe('Renamed')
    expect(b.library!.automations[0].canvases.map(c => c.name)).toEqual(['B', 'A'])
    b = editAutomationCanvas(b, a.id, a.canvases[0].id, 'delete')
    expect(b.library!.automations[0].canvases.map(c => c.name)).toEqual(['B'])
    expect(b.library!.automations[1].canvases).toHaveLength(2)
    expect(b.tabs).toEqual(source.tabs)
    expect(deleteAutomation(b, a.id).library!.automations.map(a => a.name)).toEqual(['Two'])
  })
  it('opens a group in recorded order using new unlinked tabs', () => {
    const source = saveAutomation(book(), 'Models'), a = source.library!.automations[0]
    const opened = openAutomation(source, a.id)
    expect(opened.tabs.map(t => t.name)).toEqual(['A', 'B'])
    expect(opened.tabs.map(t => t.id)).not.toEqual(source.tabs.map(t => t.id))
    expect(opened.activeId).toBe(opened.tabs[0].id)
    expect(opened.tabs.every(t => !t.savedId)).toBe(true)
    opened.tabs[0].graph.nodes[0].title = 'independent'
    expect(a.canvases[0].graph.nodes[0].title).not.toBe('independent')
    expect(() => openAutomation(source, 'missing')).toThrow()
  })
  it('export/import roundtrip retains content and order without replacing current tabs', () => {
    const source = saveAutomation(book(), 'Models'), a = source.library!.automations[0]
    const file = exportAutomation(source, a.id), imported = importAutomation(source, JSON.parse(JSON.stringify(file)))
    expect(imported.tabs).toBe(source.tabs)
    expect(imported.library!.automations).toHaveLength(2)
    const second = imported.library!.automations[1]
    expect(second.id).not.toBe(a.id)
    expect(second.canvases.map(c => c.name)).toEqual(['A', 'B'])
    expect(second.canvases.map(c => c.graph)).toEqual(a.canvases.map(c => c.graph))
    file.canvases[0].graph.nodes[0].title = 'export edited'
    expect(a.canvases[0].graph.nodes[0].title).not.toBe('export edited')
  })
  it('rejects malformed imports atomically and refuses opening an empty group', () => {
    const source = saveAutomation(book(), 'Models'), before = JSON.stringify(source), id = source.library!.automations[0].id
    for (const raw of [null, {}, { format: 'nubbo-automation', version: 2 }, { ...exportAutomation(source, id), canvases: [{ name: 'x', graph: {} }] }]) expect(() => importAutomation(source, raw)).toThrow()
    expect(JSON.stringify(source)).toBe(before)
    let empty = source
    for (const c of source.library!.automations[0].canvases) empty = editAutomationCanvas(empty, id, c.id, 'delete')
    expect(() => openAutomation(empty, id)).toThrow()
  })
})
