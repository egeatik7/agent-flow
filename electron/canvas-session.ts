import { zipCanvasDirty } from './zip-workspace'
import { newId, type CanvasBook, type CanvasTab } from './graph-types'

export type SaveDecision = 'save' | 'discard' | 'cancel'

export function canvasDirty(book: CanvasBook, tab: CanvasTab): boolean {
  return zipCanvasDirty(book, tab)
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
