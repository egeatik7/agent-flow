import { hasFileFeatures } from './file-contract'
import { normalizeGraph, type AgentGraph, type CanvasTab } from './graph-types'

/** Top-level nodes/edges stay compatible with older Nubbo imports and external tooling. */
export type CanvasFile = AgentGraph & { format: 'nubbo-canvas'; version: 1 | 2; canvasId: string; name: string }
export type CanvasDocument = { id?: string; name: string; graph: AgentGraph }
export function exportCanvasFile(canvas: CanvasTab): CanvasFile {
  const working = canvas as CanvasTab
  const id = working.savedId || working.canvasId || canvas.id
  return { ...structuredClone(canvas.graph), format: 'nubbo-canvas', version: hasFileFeatures(canvas.graph) ? 2 : 1, canvasId: id, name: canvas.name }
}
export function readCanvasFile(raw: unknown, fallbackName: string): CanvasDocument {
  const r = raw as Partial<CanvasFile> | null
  if (!r || !Array.isArray(r.nodes) || !Array.isArray(r.edges)) throw new Error('Geçerli bir tuval JSON dosyası değil.')
  const name = (r.format === 'nubbo-canvas' && typeof r.name === 'string' ? r.name : fallbackName).trim().slice(0, 160) || 'Tuval'
  if (r.format === 'nubbo-canvas') {
    if ((r.version !== 1 && r.version !== 2) || typeof r.canvasId !== 'string' || !r.canvasId.trim() || r.canvasId.length > 200 || /[\x00-\x1f]/.test(r.canvasId)) throw new Error('Tuval dosyasında kimlik veya sürüm geçersiz; içe aktarılmadı.')
    return { id: r.canvasId, name, graph: normalizeGraph(r) }
  }
  return { name, graph: normalizeGraph(r) }
}
