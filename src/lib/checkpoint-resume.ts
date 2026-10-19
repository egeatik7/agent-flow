import { activateCanvasSnapshot, addCanvasTab } from '../../electron/canvas-library'
import type { CanvasBook } from '../../electron/graph-types'
import type { CheckpointInfo, CheckpointSnapshot } from '../../electron/checkpoint-types'

/** Restore into the matching canvas. Keep its current draft to the LEFT so it cannot run as a successor. */
export function restoreCheckpointTab(book: CanvasBook, info: CheckpointInfo, snapshot: CheckpointSnapshot): CanvasBook {
  const index = book.tabs.findIndex(t => (t.savedId ?? `tab:${t.id}`) === info.canvasId)
  if (index < 0) return addCanvasTab(book, info.canvasName, snapshot.graph)
  const original = book.tabs[index]
  const added = addCanvasTab(book, `${original.name} · checkpoint öncesi`, original.graph)
  const backup = added.tabs[added.tabs.length - 1]
  const tabs = added.tabs.filter(t => t.id !== backup.id)
  tabs.splice(index, 0, backup)
  return activateCanvasSnapshot({ ...added, tabs }, { ...original, graph: structuredClone(snapshot.graph) })
}
