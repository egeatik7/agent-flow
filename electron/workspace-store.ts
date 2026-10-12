import { normalizeCanvasBook, type AgentGraph, type CanvasBook, type CanvasLibrary } from './graph-types'
import { toolLayerSave, windowSave } from './tool-branch'

type WorkspaceStore = { set(values: { canvases: CanvasBook; graph: AgentGraph }): void }
export type WorkspaceWriter = 'window' | 'tools' | 'session'
/** One electron-store commit, not two independently acknowledged workspace halves. */
export function writeWorkspace(store: WorkspaceStore, written: CanvasBook, current: CanvasBook, writer: WorkspaceWriter = 'window'): void {
  // Select the writer once, at the final persistence boundary. Applying windowSave to
  // a tool-layer result would silently replace its new branches with the old list.
  const next = writer === 'tools'
    ? normalizeCanvasBook(toolLayerSave(current, written.branches ?? []))
    : windowSave(normalizeCanvasBook(writer === 'session' ? { ...written, library: current.library ?? { schemaVersion: 2, canvases: [], automations: [] } } : written), current)
  const active = next.tabs.find(t => t.id === next.activeId) ?? next.tabs[0]
  store.set({ canvases: next, graph: active?.graph ?? { nodes: [], edges: [] } })
}

/** Only an absent book permits legacy migration; a malformed book is not an empty profile. */
export function readWorkspace(raw: unknown, legacy: AgentGraph, catalog?: CanvasLibrary): CanvasBook {
  if (raw !== undefined) {
    if (!raw || typeof raw !== 'object' || !Array.isArray((raw as CanvasBook).tabs)) throw new Error('Tuval kayıt biçimi okunamadı. Mevcut kayıt dosyası korunuyor.')
    // A migrated profile stores the catalog separately. Its missing library field
    // does not mean these working tabs are legacy saved canvases to import again.
    return normalizeCanvasBook(catalog ? { ...(raw as CanvasBook), library: catalog } : raw)
  }
  return legacy.nodes.length ? normalizeCanvasBook(undefined, legacy) : normalizeCanvasBook({ activeId: '', tabs: [] })
}

/** A rejected catalog save must not bless a draft's new baseline as published. */
export function unpublishedCatalogSession(written: CanvasBook, current: CanvasBook): CanvasBook {
  const library = current.library ?? { schemaVersion: 2 as const, canvases: [], automations: [] }
  const tabs = written.tabs.map(tab => {
    const before = current.tabs.find(t => t.id === tab.id)
    const savedId = tab.savedId ?? before?.savedId
    const record = library.canvases.find(c => c.id === savedId)
    if (!record) return { ...tab, savedId: undefined, baseline: undefined }
    const baseline = before?.savedId === record.id ? before.baseline ?? { name: record.name, graph: record.graph } : { name: record.name, graph: record.graph }
    return { ...tab, savedId: record.id, baseline: structuredClone(baseline) }
  })
  let automationDraft = written.automationDraft
  if (automationDraft) {
    const record = library.automations.find(a => a.id === automationDraft!.id)
    const before = current.automationDraft
    const expected = record ? before?.id === record.id ? before.expected ?? record : record : undefined
    automationDraft = { ...automationDraft, id: record?.id, expected: expected ? structuredClone(expected) : undefined,
      folderId: library.folders?.some(f => f.id === automationDraft!.folderId) ? automationDraft.folderId : undefined }
  }
  return { ...written, tabs, library, automationDraft }
}
