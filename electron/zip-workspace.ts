import { newId, normalizeGraph, type CanvasBook, type CanvasTab } from './graph-types'
import type { ZipLibrarySnapshot, ZipCanvasGroup } from './zip-library-storage'
import type { ZipCanvasDocument } from './zip-canvas-document'
import { sameCanvasContent } from './canvas-content'

export const emptyZipLibrary = (): ZipLibrarySnapshot => ({ directory: '', groups: [] })
export const zipLibraryOf = (book: CanvasBook): ZipLibrarySnapshot => book.zipLibrary ?? emptyZipLibrary()
export function zipCanvasOf(book: CanvasBook, id?: string): ZipCanvasDocument | undefined {
  if (!id) return
  return zipLibraryOf(book).groups.filter(g => !g.problem).flatMap(g => g.canvases).find(c => c.canvasId === id)
}
export function zipCanvasGraph(canvas: ZipCanvasDocument) { return { nodes: structuredClone(canvas.nodes), edges: structuredClone(canvas.edges) } }
export function zipDocumentFor(tab: CanvasTab, copy = false): ZipCanvasDocument {
  return { ...normalizeGraph(tab.graph), format: 'nubbo-canvas', version: 1, canvasId: copy ? newId() : tab.savedId ?? tab.canvasId ?? tab.id, name: tab.name }
}
export function openedZipCanvas(canvas: ZipCanvasDocument): CanvasTab {
  const graph = zipCanvasGraph(canvas)
  return { id: newId(), canvasId: canvas.canvasId, savedId: canvas.canvasId, name: canvas.name, graph, baseline: { name: canvas.name, graph: structuredClone(graph) } }
}
export function openZipCanvas(book: CanvasBook, id: string): CanvasBook {
  const canvas = zipCanvasOf(book, id)
  if (!canvas) throw new Error('Tuval ZIP kütüphanesinde bulunamadı.')
  const tab = openedZipCanvas(canvas)
  return { ...book, activeId: tab.id, tabs: [...book.tabs, tab] }
}
/** A ZIP's visible top-to-bottom order becomes left-to-right tab order. */
export function openZipGroup(book: CanvasBook, group: ZipCanvasGroup): CanvasBook {
  if (group.problem) throw new Error(group.problem)
  if (!group.canvases.length) throw new Error('ZIP grubu boş.')
  const tabs = group.canvases.map(openedZipCanvas)
  return { ...book, activeId: tabs[0].id, tabs }
}
export function zipCanvasDirty(book: CanvasBook, tab: CanvasTab): boolean {
  const canvas = zipCanvasOf(book, tab.savedId)
  if (tab.savedId && !canvas) return true
  const baseline = tab.baseline ?? (canvas ? { name: canvas.name, graph: zipCanvasGraph(canvas) } : undefined)
  return !baseline || baseline.name !== tab.name || !sameCanvasContent(baseline.graph, tab.graph)
}
export function adoptZipLibrary(book: CanvasBook, library: ZipLibrarySnapshot): CanvasBook {
  const ids = new Set(library.groups.filter(g => !g.problem).flatMap(g => g.canvases.map(c => c.canvasId)))
  const tabs = book.tabs.map(t => t.savedId && !ids.has(t.savedId) ? { ...t, savedId: undefined, baseline: undefined } : t)
  return { ...book, workspaceVersion: 3, tabs, zipLibrary: library }
}
export function savedZipTab(book: CanvasBook, tabId: string, canvas: ZipCanvasDocument, library: ZipLibrarySnapshot): CanvasBook {
  const adopted = adoptZipLibrary(book, library)
  return { ...adopted, tabs: adopted.tabs.map(t => t.id === tabId ? { ...t, name: canvas.name, savedId: canvas.canvasId, canvasId: canvas.canvasId, baseline: { name: canvas.name, graph: zipCanvasGraph(canvas) } } : t) }
}

/** Only a successful explicit rename may advance the name baseline, never a reload. */
export function adoptZipCanvasRename(book: CanvasBook, library: ZipLibrarySnapshot, canvasId: string): CanvasBook {
  const before = zipCanvasOf(book, canvasId)
  const adopted = adoptZipLibrary(book, library)
  const after = zipCanvasOf(adopted, canvasId)
  if (!before || !after || !sameCanvasContent(zipCanvasGraph(before), zipCanvasGraph(after))) return adopted
  return { ...adopted, tabs: adopted.tabs.map(tab => {
    if (tab.savedId !== canvasId || !tab.baseline || tab.baseline.name !== before.name || !sameCanvasContent(tab.baseline.graph, zipCanvasGraph(before))) return tab
    // Preserve a local unsaved name and every graph edit.
    return { ...tab, name: tab.name === before.name ? after.name : tab.name, baseline: { ...tab.baseline, name: after.name } }
  }) }
}
