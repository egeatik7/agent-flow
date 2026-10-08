import { newId, normalizeGraph, type AgentGraph, type CanvasBook, type CanvasLibrary, type CanvasTab, type SavedCanvas } from './graph-types'

export const libraryOf = (book: CanvasBook): CanvasLibrary => book.library ?? { canvases: [], automations: [] }
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
    library: { ...lib, canvases: lib.canvases.filter(c => c.id !== id) } }
}
export function openSavedCanvas(book: CanvasBook, canvas: SavedCanvas, link = true): CanvasBook {
  const id = newId()
  return { ...book, activeId: id, tabs: [...book.tabs, { id, name: canvas.name, graph: copy(canvas.graph),
    ...(link && libraryOf(book).canvases.some(c => c.id === canvas.id) ? { savedId: canvas.id } : {}) }] }
}
export function moveCanvasTab(book: CanvasBook, id: string, delta: -1 | 1): CanvasBook {
  const index = book.tabs.findIndex(t => t.id === id), next = index + delta
  if (index < 0 || next < 0 || next >= book.tabs.length) return book
  const tabs = [...book.tabs]; [tabs[index], tabs[next]] = [tabs[next], tabs[index]]
  return { ...book, tabs }
}
export function saveAutomation(book: CanvasBook, name: string, id?: string): CanvasBook {
  const clean = nameOf(name)
  if (!clean) throw new Error('Otomasyon adı boş olamaz.')
  if (!book.tabs.length) throw new Error('Otomasyon için en az bir tuval aç.')
  const lib = libraryOf(book)
  if (id !== undefined && !lib.automations.some(a => a.id === id)) throw new Error('Güncellenecek otomasyon artık yok.')
  const record = { id: id ?? newId(), name: clean, updatedAt: Date.now(), canvases: book.tabs.map(t => ({ id: t.id, name: t.name, graph: copy(t.graph), updatedAt: Date.now() })) }
  return { ...book, library: { ...lib, automations: lib.automations.some(a => a.id === id)
    ? lib.automations.map(a => a.id === id ? record : a) : [...lib.automations, record] } }
}
export function renameAutomation(book: CanvasBook, id: string, name: string): CanvasBook {
  const clean = nameOf(name)
  if (!clean) return book
  const lib = libraryOf(book)
  return { ...book, library: { ...lib, automations: lib.automations.map(a => a.id === id ? { ...a, name: clean } : a) } }
}
export function deleteAutomation(book: CanvasBook, id: string): CanvasBook {
  const lib = libraryOf(book)
  return { ...book, library: { ...lib, automations: lib.automations.filter(a => a.id !== id) } }
}
export function editAutomationCanvas(book: CanvasBook, automationId: string, canvasId: string, action: 'delete' | 'up' | 'down'): CanvasBook {
  const lib = libraryOf(book)
  return { ...book, library: { ...lib, automations: lib.automations.map(a => {
    if (a.id !== automationId) return a
    if (action === 'delete') return { ...a, canvases: a.canvases.filter(c => c.id !== canvasId) }
    const index = a.canvases.findIndex(c => c.id === canvasId), next = index + (action === 'up' ? -1 : 1)
    if (index < 0 || next < 0 || next >= a.canvases.length) return a
    const canvases = [...a.canvases]; [canvases[index], canvases[next]] = [canvases[next], canvases[index]]
    return { ...a, canvases }
  }) } }
}
export function openAutomation(book: CanvasBook, id: string): CanvasBook {
  const a = libraryOf(book).automations.find(a => a.id === id)
  if (!a?.canvases.length) throw new Error('Otomasyon boş veya bulunamadı.')
  const tabs = a.canvases.map(c => ({ id: newId(), name: c.name, graph: copy(c.graph) }))
  return { ...book, activeId: tabs[0].id, tabs }
}
export type AutomationFile = { format: 'nubbo-automation'; version: 1; name: string; canvases: { name: string; graph: AgentGraph }[] }
export function exportAutomation(book: CanvasBook, id: string): AutomationFile {
  const a = libraryOf(book).automations.find(a => a.id === id)
  if (!a) throw new Error('Otomasyon bulunamadı.')
  return { format: 'nubbo-automation', version: 1, name: a.name, canvases: a.canvases.map(c => ({ name: c.name, graph: copy(c.graph) })) }
}
export function importAutomation(book: CanvasBook, raw: unknown): CanvasBook {
  const r = raw as Partial<AutomationFile> | null
  if (!r || r.format !== 'nubbo-automation' || r.version !== 1 || typeof r.name !== 'string' || !nameOf(r.name) || !Array.isArray(r.canvases) || !r.canvases.length) throw new Error('Geçerli bir Nubbo otomasyon dosyası değil.')
  const canvases = r.canvases.map(c => {
    if (!c || typeof c.name !== 'string' || !c.name.trim() || !c.graph || !Array.isArray(c.graph.nodes) || !Array.isArray(c.graph.edges)) throw new Error('Otomasyonda bozuk tuval var; içe aktarılmadı.')
    return { id: newId(), name: nameOf(c.name), graph: normalizeGraph(copy(c.graph)), updatedAt: Date.now() }
  })
  const lib = libraryOf(book)
  return { ...book, library: { ...lib, automations: [...lib.automations, { id: newId(), name: nameOf(r.name), canvases, updatedAt: Date.now() }] } }
}
