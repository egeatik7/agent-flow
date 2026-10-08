import { newId, normalizeGraph, type AgentGraph, type CanvasBook, type CanvasLibrary, type CanvasTab, type SavedCanvas, type CanvasAutomation, type AutomationEntry } from './graph-types'

export const libraryOf = (book: CanvasBook): CanvasLibrary => book.library ?? { schemaVersion: 2, canvases: [], automations: [] }
const copy = <T>(value: T): T => structuredClone(value)
const nameOf = (name: string) => name.trim().slice(0, 48)

/** Tab operations keep the library and tool-owned book metadata intact. */
export function addCanvasTab(book: CanvasBook, name: string, graph: AgentGraph): CanvasBook {
  const tab = { id: newId(), name: nameOf(name) || 'Tuval', graph: copy(graph) }
  return { ...book, activeId: tab.id, tabs: [...book.tabs, tab] }
}
export function closeCanvasTab(book: CanvasBook, id: string): CanvasBook {
  const index = book.tabs.findIndex(t => t.id === id)
  if (index < 0 || book.tabs.length < 2) return book
  const tabs = book.tabs.filter(t => t.id !== id)
  return { ...book, activeId: book.activeId === id ? tabs[Math.max(0, index - 1)].id : book.activeId, tabs }
}
export function activateCanvasSnapshot(book: CanvasBook, tab: CanvasTab): CanvasBook {
  if (!book.tabs.some(t => t.id === tab.id)) throw new Error('Sıradaki tuval artık açık değil.')
  return { ...book, activeId: tab.id, tabs: book.tabs.map(t => t.id === tab.id ? copy(tab) : t) }
}

/** Explicit Save updates only the record this tab belongs to, not other same-name flows. */
export function saveCanvas(book: CanvasBook, tabId: string): CanvasBook {
  const tab = book.tabs.find(t => t.id === tabId)
  if (!tab) throw new Error('Kaydedilecek tuval bulunamadı.')
  const lib = libraryOf(book)
  const existing = lib.canvases.find(c => c.id === tab.savedId)
  const id = existing?.id ?? newId()
  const record: SavedCanvas = { id, name: tab.name, graph: copy(tab.graph), updatedAt: Date.now() }
  return { ...book, tabs: book.tabs.map(t => t.id === tabId ? { ...t, savedId: id } : t), library: { ...lib,
    canvases: existing ? lib.canvases.map(c => c.id === id ? record : c) : [...lib.canvases, record] } }
}
export function deleteSavedCanvas(book: CanvasBook, id: string): CanvasBook {
  const lib = libraryOf(book)
  return { ...book, tabs: book.tabs.map(t => t.savedId === id ? { ...t, savedId: undefined } : t),
    library: { ...lib, canvases: lib.canvases.filter(c => c.id !== id), automations: lib.automations.map(a => ({ ...a, entries: a.entries.filter(e => e.canvasId !== id) })) } }
}
export function renameSavedCanvas(book: CanvasBook, id: string, name: string): CanvasBook {
  const clean = nameOf(name), lib = libraryOf(book)
  if (!clean) throw new Error('Tuval adı boş olamaz.')
  if (!lib.canvases.some(c => c.id === id)) throw new Error('Tuval artık depoda yok.')
  return { ...book, tabs: book.tabs.map(t => t.savedId === id ? { ...t, name: clean } : t),
    library: { ...lib, canvases: lib.canvases.map(c => c.id === id ? { ...c, name: clean, updatedAt: Date.now() } : c) } }
}
export function openSavedCanvas(book: CanvasBook, canvas: SavedCanvas): CanvasBook {
  const current = libraryOf(book).canvases.find(c => c.id === canvas.id)
  if (!current) throw new Error('Tuval artık depoda yok.')
  const id = newId()
  return { ...book, activeId: id, tabs: [...book.tabs, { id, name: current.name, graph: copy(current.graph), savedId: current.id }] }
}
export function moveCanvasTab(book: CanvasBook, id: string, delta: -1 | 1): CanvasBook {
  const index = book.tabs.findIndex(t => t.id === id), next = index + delta
  if (index < 0 || next < 0 || next >= book.tabs.length) return book
  const tabs = [...book.tabs]; [tabs[index], tabs[next]] = [tabs[next], tabs[index]]
  return { ...book, tabs }
}
export type AutomationDraft = { id?: string; name: string; entries: AutomationEntry[]; expected?: CanvasAutomation }
export function automationDraftDirty(draft: AutomationDraft): boolean {
  return draft.expected ? draft.name !== draft.expected.name || JSON.stringify(draft.entries) !== JSON.stringify(draft.expected.entries)
    : !!draft.name.trim() || draft.entries.length > 0
}
export function addAutomationEntry(entries: AutomationEntry[], canvasId: string): AutomationEntry[] {
  return entries.some(e => e.canvasId === canvasId) ? entries : [...entries, { id: newId(), canvasId }]
}
export function editAutomationEntries(entries: AutomationEntry[], id: string, action: 'delete' | 'up' | 'down'): AutomationEntry[] {
  if (action === 'delete') return entries.filter(e => e.id !== id)
  const index = entries.findIndex(e => e.id === id), next = index + (action === 'up' ? -1 : 1)
  if (index < 0 || next < 0 || next >= entries.length) return entries
  const moved = [...entries]; [moved[index], moved[next]] = [moved[next], moved[index]]
  return moved
}
/** Save changes membership/order only. Canvas content has exactly one owner: the catalog. */
export function saveAutomation(book: CanvasBook, draft: AutomationDraft): CanvasBook {
  const name = nameOf(draft.name), lib = libraryOf(book)
  if (!name) throw new Error('Otomasyon adı boş olamaz.')
  const existing = lib.automations.find(a => a.id === draft.id)
  if (draft.id && !existing) throw new Error('Güncellenecek otomasyon artık yok.')
  if (existing && (!draft.expected || JSON.stringify(existing) !== JSON.stringify(draft.expected))) throw new Error('Otomasyon kaydı değişti; yeniden yükle ve tekrar düzenle.')
  if (draft.entries.some(e => !lib.canvases.some(c => c.id === e.canvasId))) throw new Error('Listedeki bir tuval artık depoda yok; otomasyon kaydedilmedi.')
  if (new Set(draft.entries.map(e => e.id)).size !== draft.entries.length || draft.entries.some(e => !e.id)) throw new Error('Otomasyon listesinde geçersiz satır kimliği var.')
  const record: CanvasAutomation = { id: existing?.id ?? newId(), name, entries: copy(draft.entries), updatedAt: Date.now() }
  return { ...book, library: { ...lib, automations: existing ? lib.automations.map(a => a.id === record.id ? record : a) : [...lib.automations, record] } }
}
export function deleteAutomation(book: CanvasBook, id: string): CanvasBook {
  const lib = libraryOf(book)
  return { ...book, library: { ...lib, automations: lib.automations.filter(a => a.id !== id) } }
}
export function automationCanvases(book: CanvasBook, id: string): SavedCanvas[] {
  const lib = libraryOf(book), a = lib.automations.find(a => a.id === id)
  if (!a) throw new Error('Otomasyon bulunamadı.')
  return a.entries.map(e => {
    const canvas = lib.canvases.find(c => c.id === e.canvasId)
    if (!canvas) throw new Error('Otomasyondaki bir tuval depoda bulunamadı.')
    return canvas
  })
}
export function openAutomation(book: CanvasBook, id: string): CanvasBook {
  const canvases = automationCanvases(book, id)
  if (!canvases.length) throw new Error('Otomasyon boş.')
  const tabs = canvases.map(c => ({ id: newId(), name: c.name, graph: copy(c.graph), savedId: c.id }))
  return { ...book, activeId: tabs[0].id, tabs }
}
export type AutomationFile = { format: 'nubbo-automation'; version: 2; name: string; canvases: { id: string; name: string; graph: AgentGraph }[]; order: string[] }
export function exportAutomation(book: CanvasBook, id: string): AutomationFile {
  const a = libraryOf(book).automations.find(a => a.id === id)
  if (!a) throw new Error('Otomasyon bulunamadı.')
  const canvases = automationCanvases(book, id)
  return { format: 'nubbo-automation', version: 2, name: a.name,
    canvases: [...new Map(canvases.map(c => [c.id, c])).values()].map(c => ({ id: c.id, name: c.name, graph: copy(c.graph) })), order: canvases.map(c => c.id) }
}
export function importAutomation(book: CanvasBook, raw: unknown): CanvasBook {
  const r = raw as { format?: unknown; version?: unknown; name?: unknown; canvases?: unknown; order?: unknown } | null
  if (!r || r.format !== 'nubbo-automation' || (r.version !== 1 && r.version !== 2) || typeof r.name !== 'string' || !nameOf(r.name) || !Array.isArray(r.canvases)) throw new Error('Geçerli bir Nubbo otomasyon dosyası değil.')
  const lib = libraryOf(book), catalog = [...lib.canvases], mapped = new Map<string, string>()
  const snapshots = r.canvases.map((value, index) => {
    const c = value as { id?: unknown; name?: unknown; graph?: AgentGraph } | null
    if (!c || typeof c.name !== 'string' || !c.name.trim() || !c.graph || !Array.isArray(c.graph.nodes) || !Array.isArray(c.graph.edges)) throw new Error('Otomasyonda bozuk tuval var; içe aktarılmadı.')
    const key = r.version === 2 ? c.id : String(index)
    if (typeof key !== 'string' || !key || mapped.has(key)) throw new Error('Otomasyon dosyasında geçersiz veya tekrarlı tuval kimliği var.')
    const name = nameOf(c.name), graph = normalizeGraph(copy(c.graph))
    let record = catalog.find(c => c.name === name && JSON.stringify(c.graph) === JSON.stringify(graph))
    if (!record) { record = { id: newId(), name, graph, updatedAt: Date.now() }; catalog.push(record) }
    mapped.set(key, record.id)
    return key
  })
  const order = r.version === 2 ? r.order : snapshots
  if (!Array.isArray(order) || order.some(key => typeof key !== 'string' || !mapped.has(key))) throw new Error('Otomasyonun sırası geçersiz; içe aktarılmadı.')
  const entries = order.map(key => ({ id: newId(), canvasId: mapped.get(key as string)! }))
  return { ...book, library: { ...lib, schemaVersion: 2, canvases: catalog, automations: [...lib.automations, { id: newId(), name: nameOf(r.name), entries, updatedAt: Date.now() }] } }
}
