import { ancestors } from './groups'
import {
  hasTemplate,
  itemVars,
  listItems,
  loopStartIndex,
  renderTemplate,
  type AgentGraph,
} from './graph-types'

export type VarReveal = { value: string; where: string }

/** What a template name is at this spot on the canvas: the nearest box, its ticked row. */
export function revealAt(graph: AgentGraph, nodeId: string, token: string): VarReveal {
  const raw = token.trim().replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '')
  const boxes = ancestors(graph, nodeId)
  const inner = boxes[0]
  if (raw.toLowerCase().startsWith('dosya')) {
    return {
      value: 'henüz yok',
      where: 'Dosyayı Bekle çalışınca inen dosyanın yolu. Tuvalde duran bir değer yok.',
    }
  }
  if (!inner) {
    return { value: 'boş', where: 'Bu node bir Her Öğe İçin kutusunun içinde değil.' }
  }
  const items = listItems(inner)
  if (!items.length && hasTemplate(inner.folder)) {
    const outer = boxes[1]
    let addr = inner.folder?.trim() ?? ''
    if (outer) {
      const outerItems = listItems(outer)
      const total = outerItems.length || Math.max(1, outer.count ?? 1)
      const oi = loopStartIndex(outer, total, true)
      const sample = outerItems[oi] ?? String(oi + 1)
      addr = renderTemplate(addr, itemVars(sample, oi, total)) ?? addr
    }
    return {
      value: 'çalışırken dolar',
      where: `“${inner.title}” adresi: ${addr}. Liste akış bu kutuya gelince kurulur.`,
    }
  }
  if (!items.length) {
    const total = Math.max(1, inner.count ?? 1)
    const i = loopStartIndex(inner, total, true)
    const shown = renderTemplate(`{{${raw}}}`, itemVars(String(i + 1), i, total)) ?? '—'
    return {
      value: shown.includes('{{') ? '—' : shown,
      where: `“${inner.title}” listesiz, ${total} tur. İşaretli tur ${i + 1}.`,
    }
  }
  const i = loopStartIndex(inner, items.length, true)
  const shown = renderTemplate(`{{${raw}}}`, itemVars(items[i], i, items.length)) ?? '—'
  return {
    value: shown.includes('{{') ? '—' : shown,
    where: `“${inner.title}”, işaretli satır ${i + 1}/${items.length}. Her tur bir sonraki satır olur.`,
  }
}
