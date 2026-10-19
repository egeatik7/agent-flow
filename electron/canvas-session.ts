import { zipCanvasDirty } from './zip-workspace'
import { newId, type CanvasBook, type CanvasTab } from './graph-types'

export type SaveDecision = 'save' | 'discard' | 'cancel'

export function canvasDirty(book: CanvasBook, tab: CanvasTab): boolean {
  return zipCanvasDirty(book, tab)
}

export function emptyCanvasSession(book: CanvasBook): CanvasBook {
  return { ...book, activeId: '', tabs: [] }
}

/** Aynı tuvalin taslağı kimliğiyle (kayıtlıysa savedId, değilse adı) tanınır. */
const draftKey = (tab: CanvasTab): string => tab.savedId || tab.name

/** Kurtarma taslakları: aynı tuval için tek kayıt, en yeni 20 taslak (sınırsız birikme yok). */
export const MAX_RECOVERY_DRAFTS = 20

/** Start with no open editor. Recovery never silently publishes a working copy. */
export function startCanvasSession(book: CanvasBook): CanvasBook {
  const recovery = [...(book.recovery ?? [])]
  for (const tab of book.tabs) {
    if (!canvasDirty(book, tab)) continue
    const record = { ...structuredClone(tab), recoveredAt: Date.now() }
    // Her açılışta yeni tab id'si üretildiği için aynı tuvalin kopyaları birikiyordu.
    const found = recovery.findIndex(r => r.id === tab.id || draftKey(r) === draftKey(tab))
    if (found < 0) recovery.push(record)
    else recovery[found] = record
  }
  const kept = recovery
    .sort((a, b) => (b.recoveredAt ?? 0) - (a.recoveredAt ?? 0))
    .slice(0, MAX_RECOVERY_DRAFTS)
  return emptyCanvasSession({ ...book, recovery: kept })
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
