import { newId, normalizeGraph, type AgentGraph, type CanvasBook, type CanvasTab, type SavedCanvas } from './graph-types'
import { libraryOf, openSavedCanvas } from './canvas-library'
import { sameCanvasContent } from './canvas-content'
import { CanvasIdentityConflictError } from './canvas-identity'

/** Top-level nodes/edges stay compatible with older Nubbo imports and external tooling. */
export type CanvasFile = AgentGraph & { format: 'nubbo-canvas'; version: 1; canvasId: string; name: string }
export type CanvasDocument = { id?: string; name: string; graph: AgentGraph }
export function exportCanvasFile(canvas: SavedCanvas | CanvasTab): CanvasFile {
  const working = canvas as CanvasTab
  const id = working.savedId || working.canvasId || canvas.id
  return { ...structuredClone(canvas.graph), format: 'nubbo-canvas', version: 1, canvasId: id, name: canvas.name }
}
export function readCanvasFile(raw: unknown, fallbackName: string): CanvasDocument {
  const r = raw as Partial<CanvasFile> | null
  if (!r || !Array.isArray(r.nodes) || !Array.isArray(r.edges)) throw new Error('Geçerli bir tuval JSON dosyası değil.')
  const name = (r.format === 'nubbo-canvas' && typeof r.name === 'string' ? r.name : fallbackName).trim().slice(0, 48) || 'Tuval'
  if (r.format === 'nubbo-canvas') {
    if (r.version !== 1 || typeof r.canvasId !== 'string' || !r.canvasId.trim() || r.canvasId.length > 200 || /[\x00-\x1f]/.test(r.canvasId)) throw new Error('Tuval dosyasında kimlik veya sürüm geçersiz; içe aktarılmadı.')
    return { id: r.canvasId, name, graph: normalizeGraph(r) }
  }
  return { name, graph: normalizeGraph(r) }
}
export function importCanvasFile(book: CanvasBook, document: CanvasDocument, copyName?: string): CanvasBook {
  const lib = libraryOf(book), name = (copyName ?? document.name).trim().slice(0, 48)
  if (!name) throw new Error('Tuval adı boş olamaz.')
  const id = copyName === undefined ? document.id ?? newId() : newId()
  const existing = lib.canvases.find(c => c.id === id)
  if (existing && (existing.name !== name || !sameCanvasContent(existing.graph, document.graph))) throw new CanvasIdentityConflictError(id, name)
  const record = existing ?? { id, name, graph: structuredClone(document.graph), updatedAt: Date.now() }
  const next = existing ? book : { ...book, library: { ...lib, canvases: [...lib.canvases, record] } }
  const cleanTab = next.tabs.find(t => t.savedId === id && t.name === record.name && sameCanvasContent(t.graph, record.graph))
  return cleanTab ? { ...next, activeId: cleanTab.id } : openSavedCanvas(next, record)
}
