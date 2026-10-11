import { normalizeCanvasBook, type AgentGraph, type CanvasBook } from './graph-types'
import { windowSave } from './tool-branch'

type WorkspaceStore = { set(values: { canvases: CanvasBook; graph: AgentGraph }): void }
/** One electron-store commit, not two independently acknowledged workspace halves. */
export function writeWorkspace(store: WorkspaceStore, written: CanvasBook, current: CanvasBook): void {
  const next = windowSave(normalizeCanvasBook(written), current)
  const active = next.tabs.find(t => t.id === next.activeId) ?? next.tabs[0]
  store.set({ canvases: next, graph: active?.graph ?? { nodes: [], edges: [] } })
}

/** Only an absent book permits legacy migration; a malformed book is not an empty profile. */
export function readWorkspace(raw: unknown, legacy: AgentGraph): CanvasBook {
  if (raw !== undefined) {
    if (!raw || typeof raw !== 'object' || !Array.isArray((raw as CanvasBook).tabs)) throw new Error('Tuval kayıt biçimi okunamadı. Mevcut kayıt dosyası korunuyor.')
    return normalizeCanvasBook(raw)
  }
  return legacy.nodes.length ? normalizeCanvasBook(undefined, legacy) : normalizeCanvasBook({ activeId: '', tabs: [] })
}
