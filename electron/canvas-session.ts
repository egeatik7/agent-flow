import { libraryOf, saveCanvas } from './canvas-library'
import { newId, type CanvasBook, type CanvasTab } from './graph-types'
import { sameCanvasContent } from './canvas-content'

export type SaveDecision = 'save' | 'discard' | 'cancel'

export function canvasDirty(book: CanvasBook, tab: CanvasTab): boolean {
  const saved = libraryOf(book).canvases.find(c => c.id === tab.savedId)
  // Deleting the saved record makes an open working copy unsaved again.
  if (tab.savedId && !saved) return true
  const baseline = tab.baseline ?? saved
  return !baseline || baseline.name !== tab.name || !sameCanvasContent(baseline.graph, tab.graph)
}

export function emptyCanvasSession(book: CanvasBook): CanvasBook {
  return { ...book, activeId: '', tabs: [] }
}

/** Start with no open editor. Recovery never silently publishes a working copy. */
export function startCanvasSession(book: CanvasBook): CanvasBook {
  const recovery = [...(book.recovery ?? [])]
  for (const tab of book.tabs) {
    if (!canvasDirty(book, tab)) continue
    const record = { ...structuredClone(tab), recoveredAt: Date.now() }
    const found = recovery.findIndex(r => r.id === tab.id)
    if (found < 0) recovery.push(record)
    else recovery[found] = record
  }
  return emptyCanvasSession({ ...book, recovery })
}

export function restoreCanvasDraft(book: CanvasBook, id: string): CanvasBook {
  const recovered = book.recovery?.find(r => r.id === id)
  if (!recovered) throw new Error('Kurtarılacak tuval artık yok.')
  const { recoveredAt: _at, ...tab } = structuredClone(recovered)
  tab.id = newId()
  return { ...book, activeId: tab.id, tabs: [...book.tabs, tab], recovery: book.recovery!.filter(r => r.id !== id) }
}
export function discardCanvasDraft(book: CanvasBook, id: string): CanvasBook {
  return { ...book, recovery: (book.recovery ?? []).filter(r => r.id !== id) }
}

/** Persist each accepted Save before asking about the next canvas. Cancel keeps tabs open. */
export async function settleCanvasChanges(
  read: () => CanvasBook,
  ask: (tab: CanvasTab) => Promise<SaveDecision>,
  persist: (book: CanvasBook) => Promise<boolean>,
  ids = read().tabs.map(t => t.id),
): Promise<boolean> {
  for (const id of ids) {
    const book = read(), tab = book.tabs.find(t => t.id === id)
    if (!tab || !canvasDirty(book, tab)) continue
    const answer = await ask(tab)
    if (answer === 'cancel') return false
    if (answer === 'save' && !await persist(saveCanvas(read(), id))) return false
  }
  return true
}
