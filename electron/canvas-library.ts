import { newId, type AgentGraph, type CanvasBook, type CanvasTab } from './graph-types'
const copy = <T>(value:T):T => structuredClone(value)
const nameOf = (name:string) => name.trim().slice(0,160)

/** Tab operations keep the library and tool-owned book metadata intact. */
export function addCanvasTab(book: CanvasBook, name: string, graph: AgentGraph): CanvasBook {
  const clean = nameOf(name) || 'Tuval'
  const id = newId()
  const tab = { id, canvasId: id, name: clean, graph: copy(graph), baseline: { name: clean, graph: copy(graph) } }
  return { ...book, activeId: tab.id, tabs: [...book.tabs, tab] }
}
export function closeCanvasTab(book: CanvasBook, id: string): CanvasBook {
  const index = book.tabs.findIndex(t => t.id === id)
  if (index < 0) return book
  const tabs = book.tabs.filter(t => t.id !== id)
  return { ...book, activeId: book.activeId === id ? tabs[Math.max(0, index - 1)]?.id ?? '' : book.activeId, tabs }
}
export function activateCanvasSnapshot(book: CanvasBook, tab: CanvasTab): CanvasBook {
  if (!book.tabs.some(t => t.id === tab.id)) throw new Error('Sıradaki tuval artık açık değil.')
  return { ...book, activeId: tab.id, tabs: book.tabs.map(t => t.id === tab.id ? copy(tab) : t) }
}

export function moveCanvasTab(book: CanvasBook, id: string, delta: -1 | 1): CanvasBook {
  const index = book.tabs.findIndex(t => t.id === id), next = index + delta
  if (index < 0 || next < 0 || next >= book.tabs.length) return book
  const tabs = [...book.tabs]; [tabs[index], tabs[next]] = [tabs[next], tabs[index]]
  return { ...book, tabs }
}
export function reorderCanvasTab(book:CanvasBook,id:string,targetId:string,after=false):CanvasBook{
 if(id===targetId)return book
 const moved=book.tabs.find(t=>t.id===id);if(!moved||!book.tabs.some(t=>t.id===targetId))return book
 const tabs=book.tabs.filter(t=>t.id!==id),at=tabs.findIndex(t=>t.id===targetId);tabs.splice(at+(after?1:0),0,moved)
 return {...book,tabs}
}
