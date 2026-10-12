import type { CanvasBook, CanvasLibrary } from './graph-types'
import { libraryOf } from './canvas-library'
import { validateLibrary, type LibraryRef } from './library-tree'

/** Expand selected folders once. Overlapping selections never delete or count an item twice. */
export function libraryDeletionPlan(lib: CanvasLibrary, selection: LibraryRef[]) {
  const folders = new Set<string>(), canvases = new Set<string>(), automations = new Set<string>()
  for (const ref of selection) {
    const rows = ref.kind === 'folder' ? lib.folders ?? [] : ref.kind === 'canvas' ? lib.canvases : lib.automations
    if (!rows.some(row => row.id === ref.id)) throw new Error('Seçilen öğe artık kütüphanede yok; seçimi yenile.')
    ;(ref.kind === 'folder' ? folders : ref.kind === 'canvas' ? canvases : automations).add(ref.id)
  }
  let grew = true
  while (grew) { grew = false; for (const f of lib.folders ?? []) if (f.parentId && folders.has(f.parentId) && !folders.has(f.id)) { folders.add(f.id); grew = true } }
  for (const c of lib.canvases) if (c.folderId && folders.has(c.folderId)) canvases.add(c.id)
  for (const a of lib.automations) if (a.folderId && folders.has(a.folderId)) automations.add(a.id)
  const records = { folders: (lib.folders ?? []).filter(f => folders.has(f.id)), canvases: lib.canvases.filter(c => canvases.has(c.id)), automations: lib.automations.filter(a => automations.has(a.id)) }
  return { ...records, fingerprint: JSON.stringify(records) }
}
/** One catalog mutation and one disk save; working tabs remain independent drafts. */
export function deleteLibraryItems(book: CanvasBook, selection: LibraryRef[], expected?: string): CanvasBook {
  const lib = libraryOf(book), plan = libraryDeletionPlan(lib, selection)
  if (expected !== undefined && expected !== plan.fingerprint) throw new Error('Silinecek öğeler onay sırasında değişti; seçimi yeniden incele.')
  const folders = new Set(plan.folders.map(f => f.id)), canvases = new Set(plan.canvases.map(c => c.id)), automations = new Set(plan.automations.map(a => a.id))
  const library = { ...lib, folders: lib.folders?.filter(f => !folders.has(f.id)), canvases: lib.canvases.filter(c => !canvases.has(c.id)),
    automations: lib.automations.filter(a => !automations.has(a.id)).map(a => ({ ...a, entries: a.entries.filter(e => !canvases.has(e.canvasId)) })) }
  validateLibrary(library)
  const tabs = book.tabs.map(t => t.savedId && canvases.has(t.savedId) ? { ...t, savedId: undefined, baseline: undefined } : t)
  // Dirty automation editors remain drafts; their missing references are visible to the existing conflict UI.
  const automationDraft = book.automationDraft?.folderId && folders.has(book.automationDraft.folderId) ? { ...book.automationDraft, folderId: undefined } : book.automationDraft
  return { ...book, tabs, library, automationDraft }
}
