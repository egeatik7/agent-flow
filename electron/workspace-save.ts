import { automationDraftDirty, libraryOf, saveAutomation, saveCanvas, type AutomationDraft } from './canvas-library'
import { canvasDirty } from './canvas-session'
import { newId, type CanvasBook } from './graph-types'

/** Pure preparation: one conflict aborts the entire Save All before anything reaches disk. */
export function saveWorkspace(book: CanvasBook): CanvasBook {
  let next = book
  for (const tab of book.tabs) if (!tab.savedId || canvasDirty(book, tab)) next = saveCanvas(next, tab.id)
  const draft = next.automationDraft
  if (draft && automationDraftDirty(draft)) {
    next = saveAutomation(next, draft)
    const automations = libraryOf(next).automations
    const saved = automations.find(a => a.id === draft.id) ?? automations[automations.length - 1]
    next = { ...next, automationDraft: { ...saved, key: draft.key, expected: structuredClone(saved) } }
  }
  return next
}

/** Capture the actual open order, including repeated canvases, in one explicit save. */
export function saveOpenSequence(book: CanvasBook, name: string): CanvasBook {
  if (!book.tabs.length) throw new Error('Kaydedilecek açık tuval sırası yok.')
  let next = book
  for (const tab of book.tabs) if (!tab.savedId || canvasDirty(book, tab)) next = saveCanvas(next, tab.id)
  const draft: AutomationDraft = { name, entries: next.tabs.map(t => ({ id: newId(), canvasId: t.savedId! })) }
  next = saveAutomation(next, draft)
  return next
}
