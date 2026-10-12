import { randomUUID } from 'node:crypto'
import { normalizeGraph, type AgentGraph } from './graph-types'

/** Each canvas owns its content and identity; the ZIP is only its containing group. */
export type ZipCanvasDocument = AgentGraph & {
  format: 'nubbo-canvas'
  version: 1
  canvasId: string
  name: string
}

export function zipCanvasDocument(raw: unknown, fallbackName?: string): ZipCanvasDocument {
  const value = raw as Partial<ZipCanvasDocument> | null
  if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error('JSON geçerli bir tuval içermiyor.')
  const name = (typeof value.name === 'string' ? value.name : fallbackName ?? '').trim()
  if (!name || name.length > 160 || /[\x00-\x1f]/.test(name)) throw new Error('Tuval adı geçersiz.')
  if (value.format !== undefined && value.format !== 'nubbo-canvas') throw new Error('JSON tuval dosyası değil.')
  if (value.format === 'nubbo-canvas' && value.version !== 1) throw new Error('Tuval dosyası sürümü desteklenmiyor.')
  const id = value.canvasId
  if (value.format === 'nubbo-canvas' && id === undefined) throw new Error('Tuval dosyasında kimlik eksik.')
  if (id !== undefined && (typeof id !== 'string' || !id.trim() || id !== id.trim() || id.length > 200 || /[\x00-\x1f]/.test(id))) throw new Error('Tuval kimliği geçersiz.')
  if (id === undefined && fallbackName === undefined) throw new Error('Kütüphanedeki tuval JSON’unda kimlik eksik; dosya kendiliğinden değiştirilmedi.')
  const nodes = value.nodes, edges = value.edges
  const ids = new Set(nodes.map(n => n?.id))
  if (ids.size !== nodes.length || nodes.some(n => typeof n?.id !== 'string' || !n.id.trim())) throw new Error('Tuvalde geçersiz veya tekrarlı node kimliği var.')
  const edgeIds = new Set<string>()
  for (const edge of edges) {
    if (!edge?.id || edgeIds.has(edge.id) || !ids.has(edge.from) || !ids.has(edge.to)) throw new Error('Tuval bağlantıları geçersiz; kayıp bağlantı sessizce kaldırılmadı.')
    edgeIds.add(edge.id)
  }
  return { ...normalizeGraph({ nodes, edges }), format: 'nubbo-canvas', version: 1, canvasId: id ?? randomUUID(), name }
}

export function copyZipCanvas(document: ZipCanvasDocument, name = document.name): ZipCanvasDocument {
  return zipCanvasDocument({ ...structuredClone(document), canvasId: randomUUID(), name })
}
