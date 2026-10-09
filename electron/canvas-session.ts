import { libraryOf, saveCanvas } from './canvas-library'
import { newId, type CanvasBook, type CanvasTab } from './graph-types'

export type SaveDecision = 'save' | 'discard' | 'cancel'

export function canvasDirty(book: CanvasBook, tab: CanvasTab): boolean {
  const saved = libraryOf(book).canvases.find(c => c.id === tab.savedId)
  // Deleting the saved record makes an open working copy unsaved again.
  if (tab.savedId && !saved) return true
  const baseline = tab.baseline ?? saved
  return !baseline || baseline.name !== tab.name || JSON.stringify(baseline.graph) !== JSON.stringify(tab.graph)
}

export function emptyCanvasSession(book: CanvasBook): CanvasBook {
  return { ...book, activeId: '', tabs: [] }
}

/** Start with no open editor. Preserve interrupted/legacy unsaved work in the depot. */
export function startCanvasSession(book: CanvasBook): CanvasBook {
  let next = book
  for (const tab of book.tabs) {
    if (!canvasDirty(book, tab)) continue
    const lib = libraryOf(next)
    if (lib.canvases.some(c => c.name === tab.name && JSON.stringify(c.graph) === JSON.stringify(tab.graph))) continue
    const record = { id: newId(), name: tab.savedId ? `${tab.name.slice(0, 35)} (Kurtarılan)` : tab.name, graph: structuredClone(tab.graph), updatedAt: Date.now() }
    next = { ...next, library: { ...lib, canvases: [...lib.canvases, record] } }
  }
  return emptyCanvasSession(next)
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
