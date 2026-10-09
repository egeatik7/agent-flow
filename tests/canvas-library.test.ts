import { describe, expect, it } from 'vitest'
import { createNode, normalizeCanvasBook, type CanvasBook } from '../electron/graph-types'
import { activateCanvasSnapshot, addAutomationEntry, addCanvasTab, automationCanvases, automationDraftDirty, closeCanvasTab, deleteAutomation, deleteSavedCanvas, editAutomationEntries, exportAutomation, importAutomation, libraryOf, moveCanvasTab, openAutomation, openSavedCanvas, renameSavedCanvas, saveAutomation, saveCanvas } from '../electron/canvas-library'
const graph = () => ({ nodes: [createNode('start', 0, 0), createNode('end', 100, 0)], edges: [] })
const book = (): CanvasBook => normalizeCanvasBook({ activeId: 'b', tabs: [{ id: 'a', name: 'A', graph: graph() }, { id: 'b', name: 'B', graph: graph() }], branches: [{ id: 'keep' }] })
const group = (b: CanvasBook, name = 'Models', ids = ['a', 'b']) => saveAutomation(b, { name, entries: ids.map((id, i) => ({ id: `entry-${i}`, canvasId: id })) })
const names = (b: CanvasBook, id = b.library!.automations[0].id) => automationCanvases(b, id).map(c => c.name)

describe('one canonical canvas catalog with ordered automation references', () => {
  it('migrates old open tabs once and preserves branches, active tab and order', () => {
    const b = book()
    expect(b.activeId).toBe('b'); expect(b.library!.schemaVersion).toBe(2)
    expect(b.library!.canvases.map(c => c.name)).toEqual(['A', 'B'])
    expect(b.branches).toEqual([{ id: 'keep' }])
    b.tabs[0].graph.nodes[0].title = 'edited'
    expect(b.library!.canvases[0].graph.nodes[0].title).not.toBe('edited')
    expect(normalizeCanvasBook(b).library).toEqual(b.library)
  })
  it('promotes legacy snapshots without overwriting a different saved canvas', () => {
    const old = book(), saved = old.library!.canvases[0], changed = structuredClone(saved)
    changed.graph.nodes[0].title = 'old automation version'
    const migrated = normalizeCanvasBook({ ...old, library: { canvases: old.library!.canvases, automations: [{ id: 'old', name: 'Old', canvases: [saved, changed], updatedAt: 1 }] } })
    expect(migrated.library!.canvases).toHaveLength(3)
    const a = migrated.library!.automations[0]
    expect(a).not.toHaveProperty('canvases')
    expect(a.entries).toHaveLength(2)
    expect(a.entries[0].canvasId).toBe(saved.id)
    expect(a.entries[1].canvasId).not.toBe(saved.id)
    expect(automationCanvases(migrated, a.id)[1].graph.nodes[0].title).toBe('old automation version')
    expect(migrated.library!.canvases[0].graph.nodes[0].title).not.toBe('old automation version')
    expect(normalizeCanvasBook(migrated).library).toEqual(migrated.library)
  })
  it('reattaches an already-open legacy group copy to the canonical migrated record', () => {
    const b = book(), snapshot = structuredClone(b.library!.canvases[0])
    snapshot.graph.nodes[0].title = 'legacy version'
    const migrated = normalizeCanvasBook({ activeId: 'open-copy', tabs: [{ id: 'open-copy', name: snapshot.name, graph: snapshot.graph }], library: { canvases: b.library!.canvases, automations: [{ id: 'old', name: 'Old', canvases: [snapshot], updatedAt: 0 }] } })
    const member = migrated.library!.automations[0].entries[0].canvasId
    expect(migrated.tabs[0].savedId).toBe(member)
    migrated.tabs[0].graph.nodes[0].title = 'saved from open tab'
    const saved = saveCanvas(migrated, 'open-copy')
    expect(automationCanvases(saved, 'old')[0].graph.nodes[0].title).toBe('saved from open tab')
    expect(saved.library!.canvases).toHaveLength(3)
  })
  it('preserves repeated legacy steps while deduplicating identical canvas content', () => {
    const b = book(), c = b.library!.canvases[0]
    const migrated = normalizeCanvasBook({ ...b, library: { canvases: b.library!.canvases, automations: [{ id: 'old', name: 'Repeat', canvases: [c, { ...c, id: 'other' }], updatedAt: 0 }] } })
    expect(migrated.library!.canvases).toHaveLength(2)
    expect(migrated.library!.automations[0].entries.map(e => e.canvasId)).toEqual(['a', 'a'])
    expect(new Set(migrated.library!.automations[0].entries.map(e => e.id)).size).toBe(2)
  })
  it('never resurrects deleted records on reload or preserves dangling group references', () => {
    let b = group(book())
    for (const c of libraryOf(b).canvases) b = deleteSavedCanvas(b, c.id)
    const reloaded = normalizeCanvasBook(b)
    expect(reloaded.library!.canvases).toEqual([])
    expect(reloaded.library!.automations[0].entries).toEqual([])
    expect(b.tabs.map(t => t.savedId)).toEqual([undefined, undefined])
  })
  it('repairs duplicate IDs and drops invalid references from corrupt stored records', () => {
    const b = group(book()), id = b.library!.automations[0].id
    b.tabs[1].id = 'a'; b.library!.canvases[1].id = 'a'
    b.library!.automations[0].entries.push({ id: 'entry-0', canvasId: 'a' }, { id: 'missing', canvasId: 'missing' })
    const n = normalizeCanvasBook(b)
    expect(new Set(n.tabs.map(t => t.id)).size).toBe(2)
    expect(new Set(n.library!.canvases.map(t => t.id)).size).toBe(2)
    expect(n.library!.automations[0].entries.some(e => e.canvasId === 'missing')).toBe(false)
    expect(new Set(n.library!.automations[0].entries.map(e => e.id)).size).toBe(n.library!.automations[0].entries.length)
    expect(automationCanvases(n, id)).toBeDefined()
  })
  it('updates only the linked saved record even with same-name canvases', () => {
    const b = group(book()); b.tabs[1].name = 'A'; b.tabs[1].graph.nodes[0].title = 'changed'
    const saved = saveCanvas(b, 'b')
    expect(saved.library!.canvases).toHaveLength(2)
    expect(saved.library!.canvases[0].graph.nodes[0].title).not.toBe('changed')
    expect(automationCanvases(saved, saved.library!.automations[0].id)[1].graph.nodes[0].title).toBe('changed')
    b.tabs[1].graph.nodes[0].title = 'later'
    expect(saved.library!.canvases[1].graph.nodes[0].title).toBe('changed')
    expect(() => saveCanvas(b, 'missing')).toThrow()
  })
  it('a saved edit is visible to all groups using the same record', () => {
    const b = group(group(book(), 'One'), 'Two')
    b.tabs[0].graph.nodes[0].title = 'current'
    const saved = saveCanvas(b, 'a')
    for (const a of saved.library!.automations) expect(automationCanvases(saved, a.id)[0].graph.nodes[0].title).toBe('current')
    expect(saved.library!.automations).toEqual(b.library!.automations)
  })
  it('renames the catalog entry, its open tabs and its appearances in every group', () => {
    const b = group(group(book(), 'One'), 'Two'), renamed = renameSavedCanvas(b, 'a', ' Renamed ')
    expect(renamed.tabs[0].name).toBe('Renamed')
    expect(renamed.library!.canvases[0].name).toBe('Renamed')
    for (const a of renamed.library!.automations) expect(names(renamed, a.id)[0]).toBe('Renamed')
    expect(() => renameSavedCanvas(b, 'missing', 'X')).toThrow()
    expect(() => renameSavedCanvas(b, 'a', ' ')).toThrow()
  })
  it('opens linked independent working tabs using the latest canonical graph, not a stale object', () => {
    const b = book(), stale = structuredClone(b.library!.canvases[0])
    b.tabs[0].graph.nodes[0].title = 'latest'
    const saved = saveCanvas(b, 'a'), first = openSavedCanvas(saved, stale), second = openSavedCanvas(first, stale)
    expect(new Set(second.tabs.map(t => t.id)).size).toBe(4)
    expect(second.tabs[2].savedId).toBe('a')
    expect(second.tabs[2].graph.nodes[0].title).toBe('latest')
    second.tabs[2].graph.nodes[0].title = 'local only'
    expect(saved.library!.canvases[0].graph.nodes[0].title).toBe('latest')
    expect(second.tabs[3].graph.nodes[0].title).toBe('latest')
    expect(() => openSavedCanvas(deleteSavedCanvas(saved, 'a'), stale)).toThrow()
  })
  it('global deletion removes every reference, but keeps open working copies and other records', () => {
    const b = group(group(book(), 'One'), 'Two'), deleted = deleteSavedCanvas(b, 'a')
    expect(deleted.tabs).toHaveLength(2)
    expect(deleted.tabs[0].savedId).toBeUndefined()
    expect(deleted.library!.canvases.map(c => c.id)).toEqual(['b'])
    for (const a of deleted.library!.automations) expect(names(deleted, a.id)).toEqual(['B'])
    expect(deleted.branches).toEqual([{ id: 'keep' }])
  })
  it('can add an existing depot canvas that was not already a member', () => {
    const b = group(book(), 'Only A', ['a']), a = b.library!.automations[0]
    const entries = addAutomationEntry(a.entries, 'b')
    expect(entries.map(e => e.canvasId)).toEqual(['a', 'b'])
    expect(addAutomationEntry(entries, 'b')).toBe(entries)
    const saved = saveAutomation(b, { id: a.id, name: a.name, entries, expected: a })
    expect(names(saved)).toEqual(['A', 'B'])
    expect(saved.library!.canvases).toBe(b.library!.canvases)
  })
  it('edits a draft without changing the stored list until Save', () => {
    const b = group(book()), a = b.library!.automations[0]
    const entries = editAutomationEntries(a.entries, a.entries[1].id, 'up')
    expect(names(b)).toEqual(['A', 'B'])
    const draft = { id: a.id, name: 'Renamed Group', entries, expected: a }
    expect(automationDraftDirty(draft)).toBe(true)
    const saved = saveAutomation(b, draft)
    expect(saved.library!.automations[0].name).toBe('Renamed Group')
    expect(names(saved)).toEqual(['B', 'A'])
    expect(saved.tabs).toBe(b.tabs)
    const next = saved.library!.automations[0]
    expect(automationDraftDirty({ ...next, expected: next })).toBe(false)
    expect(automationDraftDirty({ name: '', entries: [] })).toBe(false)
  })
  it('removing a group member cannot delete the canvas from the depot or other groups', () => {
    const b = group(group(book(), 'One'), 'Two'), a = b.library!.automations[0]
    const saved = saveAutomation(b, { ...a, entries: editAutomationEntries(a.entries, a.entries[0].id, 'delete'), expected: a })
    expect(names(saved, a.id)).toEqual(['B'])
    expect(names(saved, saved.library!.automations[1].id)).toEqual(['A', 'B'])
    expect(saved.library!.canvases).toHaveLength(2)
    expect(saved.tabs).toBe(b.tabs)
  })
  it('rejects a stale/deleted group or invalid member without overwriting newer data', () => {
    const b = group(book()), a = b.library!.automations[0]
    const newer = saveAutomation(b, { ...a, name: 'Newer', expected: a }), before = JSON.stringify(newer)
    expect(() => saveAutomation(newer, { ...a, name: 'Stale', expected: a })).toThrow(/değişti/)
    expect(JSON.stringify(newer)).toBe(before)
    expect(() => saveAutomation(deleteAutomation(b, a.id), { ...a, expected: a })).toThrow(/artık yok/)
    expect(() => saveAutomation(b, { name: 'X', entries: [{ id: 'x', canvasId: 'missing' }] })).toThrow(/depoda yok/)
    expect(() => saveAutomation(b, { name: 'X', entries: [{ id: 'x', canvasId: 'a' }, { id: 'x', canvasId: 'b' }] })).toThrow(/kimliği/)
  })
  it('adding and closing tabs preserve the depot, groups and branches', () => {
    const b = group(book()), opened = addCanvasTab(b, 'C', graph()), closed = closeCanvasTab(opened, opened.activeId)
    expect(closed.tabs.map(t => t.name)).toEqual(['A', 'B'])
    expect(closed.library).toBe(b.library); expect(closed.branches).toBe(b.branches)
    expect(closed.activeId).toBe('b')
    expect(closeCanvasTab(closeCanvasTab(closed, 'b'), 'a').tabs).toHaveLength(0)
  })
  it('starting on the left preserves edits in the previously active right tab', () => {
    const b = group(book()), changed = { ...b, tabs: b.tabs.map(t => t.id === 'b' ? { ...t, graph: { ...t.graph, nodes: t.graph.nodes.map(n => ({ ...n, title: 'unsaved edit' })) } } : t) }
    const prepared = activateCanvasSnapshot(changed, b.tabs[0])
    expect(prepared.activeId).toBe('a'); expect(prepared.tabs[1].graph.nodes[0].title).toBe('unsaved edit')
    expect(prepared.library).toBe(b.library); expect(prepared.branches).toBe(b.branches)
  })
  it('tab and draft movement honor boundaries and leave source order intact', () => {
    const b = group(book()), e = b.library!.automations[0].entries
    expect(moveCanvasTab(b, 'a', -1)).toBe(b); expect(moveCanvasTab(b, 'b', 1)).toBe(b)
    expect(moveCanvasTab(b, 'a', 1).tabs.map(t => t.id)).toEqual(['b', 'a'])
    expect(editAutomationEntries(e, e[0].id, 'up')).toBe(e)
    expect(editAutomationEntries(e, e[1].id, 'down')).toBe(e)
    expect(editAutomationEntries(e, 'missing', 'down')).toBe(e)
    expect(e.map(e => e.canvasId)).toEqual(['a', 'b'])
  })
  it('opens an automation from the latest shared records with linked, independent tabs', () => {
    const b = group(book()), a = b.library!.automations[0]
    const opened = openAutomation(renameSavedCanvas(b, 'b', 'New B'), a.id)
    expect(opened.tabs.map(t => t.name)).toEqual(['A', 'New B'])
    expect(opened.tabs.map(t => t.savedId)).toEqual(['a', 'b'])
    expect(opened.activeId).toBe(opened.tabs[0].id)
    opened.tabs[0].graph.nodes[0].title = 'unsaved'
    expect(b.library!.canvases[0].graph.nodes[0].title).not.toBe('unsaved')
  })
  it('V2 export/import roundtrip reuses matching depot entries and preserves order', () => {
    const b = group(book()), a = b.library!.automations[0], file = exportAutomation(b, a.id)
    expect(file.version).toBe(2); expect(file.order).toEqual(['a', 'b'])
    const imported = importAutomation(b, JSON.parse(JSON.stringify(file)))
    expect(imported.library!.canvases).toHaveLength(2)
    expect(imported.tabs).toBe(b.tabs)
    expect(imported.library!.automations).toHaveLength(2)
    const added = imported.library!.automations[1]
    expect(added.id).not.toBe(a.id); expect(names(imported, added.id)).toEqual(['A', 'B'])
    file.canvases[0].graph.nodes[0].title = 'edited export'
    expect(b.library!.canvases[0].graph.nodes[0].title).not.toBe('edited export')
  })
  it('imports V1 files into the same depot without overwriting a different version', () => {
    const b = book(), changed = structuredClone(b.library!.canvases[0].graph); changed.nodes[0].title = 'imported old version'
    const imported = importAutomation(b, { format: 'nubbo-automation', version: 1, name: 'Old file', canvases: [{ name: 'A', graph: changed }] })
    expect(imported.library!.canvases).toHaveLength(3)
    expect(imported.library!.canvases[0].graph.nodes[0].title).not.toBe('imported old version')
    expect(automationCanvases(imported, imported.library!.automations[0].id)[0].graph.nodes[0].title).toBe('imported old version')
  })
  it('preserves repeated steps across export/import while storing just one record', () => {
    const b = saveAutomation(book(), { name: 'Repeat', entries: [{ id: 'one', canvasId: 'a' }, { id: 'two', canvasId: 'a' }] }), a = b.library!.automations[0]
    const file = exportAutomation(b, a.id)
    expect(file.canvases).toHaveLength(1); expect(file.order).toEqual(['a', 'a'])
    const imported = importAutomation(b, file)
    expect(names(imported, imported.library!.automations[1].id)).toEqual(['A', 'A'])
  })
  it('rejects malformed imports atomically', () => {
    const b = group(book()), before = JSON.stringify(b), file = exportAutomation(b, b.library!.automations[0].id)
    for (const raw of [null, {}, { ...file, version: 3 }, { ...file, order: ['missing'] }, { ...file, canvases: [file.canvases[0], file.canvases[0]] }, { ...file, canvases: [{ id: 'x', name: 'x', graph: {} }] }]) expect(() => importAutomation(b, raw)).toThrow()
    expect(JSON.stringify(b)).toBe(before)
  })
  it('supports saved empty groups, but cannot open them as a running tab list', () => {
    const b = saveAutomation(book(), { name: 'Empty', entries: [] }), a = b.library!.automations[0]
    expect(() => openAutomation(b, a.id)).toThrow(/boş/)
    const imported = importAutomation(b, exportAutomation(b, a.id))
    expect(imported.library!.automations[1].entries).toEqual([])
    expect(() => saveAutomation(b, { name: ' ', entries: [] })).toThrow()
  })
})
