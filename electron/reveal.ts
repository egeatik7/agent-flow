import { enclosingLoop } from './enclosing'
import { itemVars, listItems, loopStartIndex, renderTemplate, type AgentGraph } from './graph-types'

export type VarReveal = { value: string; where: string; resolved: boolean }

/** Read-only preview of the nearest loop's marked row, including ancestors outside packages. */
export function revealAt(root: AgentGraph, nodeId: string, token: string, seen = new Set<string>()): VarReveal {
  const loop = enclosingLoop(root, nodeId)
  if (!loop || seen.has(loop.id)) {
    const value = renderTemplate(token, { sira: '1' }) ?? token
    return { value: value === token ? 'Döngü dışında' : value, resolved: value !== token,
      where: 'Bu node bir Her Öğe İçin kutusunun içinde değil.' }
  }
  const items = listItems(loop)
  if (!items.length && loop.folder?.trim()) {
    const nextSeen = new Set(seen).add(loop.id)
    const address = loop.folder.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, raw => {
      const outer = revealAt(root, loop.id, raw, nextSeen)
      return outer.resolved ? outer.value : raw
    })
    return { value: 'Çalışırken belli olacak', resolved: false,
      where: `“${loop.title}” klasörü: ${address}. Liste henüz alınmadı; tam öğe ve toplam bilinmiyor.` }
  }
  const total = items.length || Math.max(1, loop.count ?? 1)
  const index = loopStartIndex(loop, total, true)
  const value = renderTemplate(token, itemVars(items[index] ?? String(index + 1), index, total)) ?? token
  return { value: value === token ? 'Bilinmeyen değişken' : value, resolved: value !== token,
    where: `“${loop.title}”, işaretli ${items.length ? 'öğe' : 'tur'} ${index + 1}/${total}. Bu değer işaretli konum içindir; döngü ilerledikçe değişir.` }
}
export function revealTip(token: string, reveal: VarReveal): string {
  return `${reveal.resolved ? 'Tam karşılığı' : 'Durum'}:\n${reveal.value}\n\n${reveal.where}\n\nAkışta ${token} saklanır.`
}
