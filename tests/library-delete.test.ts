import { describe, expect, it } from 'vitest'
import { normalizeCanvasBook, type CanvasBook } from '../electron/graph-types'
import { deleteLibraryItems, libraryDeletionPlan } from '../electron/library-delete'
import { startCanvasSession } from '../electron/canvas-session'
const book = (): CanvasBook => normalizeCanvasBook({ activeId: 'tab', tabs: [{ id: 'tab', savedId: 'a', name: 'A', graph: { nodes: [], edges: [] } }],
  library: { folders: [{ id: 'parent', name: 'Parent', section: 'canvas' }, { id: 'child', name: 'Child', parentId: 'parent', section: 'canvas' }],
    canvases: [{ id: 'a', name: 'A', folderId: 'parent', graph: { nodes: [], edges: [] }, updatedAt: 1 }, { id: 'b', name: 'B', folderId: 'child', graph: { nodes: [], edges: [] }, updatedAt: 1 }, { id: 'keep', name: 'Keep', graph: { nodes: [], edges: [] }, updatedAt: 1 }],
    automations: [{ id: 'run', name: 'Run', entries: [{ id: 'one', canvasId: 'a' }, { id: 'two', canvasId: 'b' }, { id: 'three', canvasId: 'keep' }], updatedAt: 1 }] } })
describe('atomic library selection deletion', () => {
  it('deletes all selected canvases once, preserves working tabs, and removes only their automation links', () => {
    const initial = book(), before = structuredClone(initial)
    const next = deleteLibraryItems(initial, [{ kind: 'canvas', id: 'a' }, { kind: 'canvas', id: 'b' }, { kind: 'canvas', id: 'a' }])
    expect(next.library!.canvases.map(c => c.id)).toEqual(['keep'])
    expect(next.library!.automations[0].entries.map(e => e.canvasId)).toEqual(['keep'])
    expect(next.tabs).toHaveLength(1); expect(next.tabs[0].savedId).toBeUndefined(); expect(next.tabs[0].graph).toEqual(before.tabs[0].graph)
    expect(initial).toEqual(before)
    const restarted = startCanvasSession(next)
    expect(restarted.library!.canvases.map(c => c.id)).toEqual(['keep'])
    expect(restarted.recovery).toHaveLength(1)
  })
  it('expands a selected folder recursively and deduplicates its selected descendants', () => {
    const initial = book(), refs = [{ kind: 'folder' as const, id: 'parent' }, { kind: 'canvas' as const, id: 'b' }]
    const plan = libraryDeletionPlan(initial.library!, refs)
    expect(plan.folders).toHaveLength(2); expect(plan.canvases).toHaveLength(2)
    const next = deleteLibraryItems(initial, refs, plan.fingerprint)
    expect(next.library!.folders).toEqual([]); expect(next.library!.canvases.map(c => c.id)).toEqual(['keep'])
  })
  it('rejects a changed deletion set after confirmation without partially modifying the library', () => {
    const initial = book(), refs = [{ kind: 'folder' as const, id: 'parent' }], expected = libraryDeletionPlan(initial.library!, refs).fingerprint
    initial.library!.canvases.push({ id: 'new', name: 'New', folderId: 'child', graph: { nodes: [], edges: [] }, updatedAt: 1 })
    const before = structuredClone(initial)
    expect(() => deleteLibraryItems(initial, refs, expected)).toThrow('onay sırasında değişti'); expect(initial).toEqual(before)
  })
  it('deletes mixed canvas/automation selection without deleting unselected canvases', () => {
    const next = deleteLibraryItems(book(), [{ kind: 'canvas', id: 'a' }, { kind: 'automation', id: 'run' }])
    expect(next.library!.automations).toEqual([]); expect(next.library!.canvases.map(c => c.id)).toEqual(['b', 'keep'])
  })
})
