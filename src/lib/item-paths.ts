import type { AgentGraph, AgentNode } from '../../electron/graph-types'
import { listItems } from '../../electron/graph-types'
import { walkGraph } from '../../electron/tool-context'

/** Döngü öğesi mutlak yol değilse klasör alanıyla birleştirir; şablonlu/boş klasörde yol çözülemez. */
export function fullItemPath(item: string, folder?: string): string {
  const value = item.trim()
  if (!value || /\{\{/.test(value)) return ''
  if (isAbsolutePath(value)) return value
  const base = cleanFolder((folder ?? '').trim())
  if (!base || /\{\{/.test(base) || !isAbsolutePath(base)) return ''
  return `${base}${/[\\/]$/.test(base) ? '' : '\\'}${value}`
}

export function cleanFolder(value: string): string {
  return /^[a-z]:[\\/]$/i.test(value) ? value : value.replace(/[\\/]+$/, '')
}

/** Sürücü harfli ya da UNC yol. Düz metin bir liste öğesi (ör. "kedi") yol sayılmaz. */
export function isAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

/** Koşudan önce denetlenecek tek bir döngü yolu. */
export type LoopPathCandidate = {
  canvas: string
  node: string
  /** Kullanıcının listeye yazdığı öğe. */
  item: string
  /** Denetlenecek mutlak yol; döngünün klasörü için yol = klasörün kendisi. */
  path: string
  /** '' = yol çözüldü ve denetlenmeli; 'klasör' = döngünün klasör alanı denetleniyor. */
  kind: '' | 'klasör'
}

/** Raporda gösterilen eksik. */
export type LoopPathReport = LoopPathCandidate & { reason: string }

/**
 * Bir koşuda denetlenecek yolları toplar. Gürültüyü önlemek için **yalnız mutlak yol** görünen
 * yerler alınır: düz metin liste öğeleri (metin değişkeni olabilir) ve `{{öğe}}` şablonlu klasörler
 * (o yol ancak koşu sırasında, üst öğeyle çözülür) rapora girmez.
 */
export function collectLoopPaths(canvases: { name: string; graph: AgentGraph }[]): LoopPathCandidate[] {
  const out: LoopPathCandidate[] = []
  const seen = new Set<string>()
  const push = (c: LoopPathCandidate) => {
    const key = `${c.canvas}|${c.node}|${c.path}`
    if (c.path && !seen.has(key)) { seen.add(key); out.push(c) }
  }
  for (const canvas of canvases) {
    walkGraph(canvas.graph, ({ node, loops }) => {
      if (node.kind !== 'loop') return
      const label = [...loops.filter((l) => l.id !== node.id).map((l) => l.title), node.title].join(' › ')
      const folder = (node.folder ?? '').trim()
      if (/\{\{/.test(folder)) return // Runtime regenerates this loop's items from the resolved directory.
      // Klasörün kendisi mutlak ve şablonsuzsa: "klasör yok" en sık arıza, onu da denetle.
      if (folder && !/\{\{/.test(folder) && isAbsolutePath(folder)) {
        push({ canvas: canvas.name, node: label, item: folder, path: cleanFolder(folder), kind: 'klasör' })
      }
      for (const item of listItems(node)) {
        const path = fullItemPath(item, node.folder)
        if (path) push({ canvas: canvas.name, node: label, item, path, kind: '' })
      }
    })
  }
  return out
}

/** `missing` kümesindekileri (main'den gelen "diskte yok" listesi) raporlar. */
export function missingLoopPaths(candidates: LoopPathCandidate[], missing: Set<string>): LoopPathReport[] {
  return candidates
    .filter((c) => missing.has(c.path))
    .map((c) => ({ ...c, reason: c.kind === 'klasör' ? 'klasör bulunamadı' : 'dosya bulunamadı' }))
}

/** Rapor penceresinde gösterilecek kısa satır. */
export function describeLoopPath(r: LoopPathReport): string {
  return `${r.item} — ${r.reason}`
}

/** Test/teşhis için: bir tuvaldeki döngü öğesi sayısı. */
export function loopItemCount(node: AgentNode): number {
  return listItems(node).length
}
