import { saveCanvas } from '../electron/canvas-library'
import { startCanvasSession } from '../electron/canvas-session'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { createNode, normalizeCanvasBook, normalizeGraph, type CanvasBook } from '../electron/graph-types'
import { readWorkspace, writeWorkspace, unpublishedCatalogSession } from '../electron/workspace-store'
import { toolLayerSave } from '../electron/tool-branch'
import { librarySession, isLibraryConflict, LibraryConflictError } from '../electron/library-storage'

// Run the actual main-process persistence functions and registered callbacks, without
// starting Electron or substituting another implementation of the two-writer boundary.
const source = ts.createSourceFile('main.ts', readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const functions = new Map<string, string>()
let toolsSave = '', windowSave = ''
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && ['loadCanvases', 'storeWorkspace'].includes(node.name.text)) functions.set(node.name.text, node.getText(source))
  if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'saveCanvases') toolsSave = node.initializer.getText(source)
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'ipcMain.handle' && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'canvases:save') windowSave = node.arguments[1].getText(source)
  ts.forEachChild(node, visit)
}
visit(source)
if (functions.size !== 2 || !toolsSave || !windowSave) throw Error('Main persistence callbacks were not found.')
const compiled = ts.transpileModule(`${[...functions.values()].join('\n')}\n({ toolsSave: ${toolsSave}, windowSave: ${windowSave}, loadCanvases });`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

it('main tool saves survive subsequent calls and stale window saves without modifying current canvases or drafts', () => {
  const graph = { nodes: [createNode('start', 0, 0)], edges: [] }
  let disk = normalizeCanvasBook({ activeId: 'tab', tabs: [{ id: 'tab', name: 'Window work', savedId: 'saved', graph, baseline: { name: 'Window work', graph: structuredClone(graph) } }], library: { canvases: [{ id: 'saved', name: 'Window work', graph: structuredClone(graph), updatedAt: 1 }], automations: [] }, branches: [] })
  disk.tabs[0].graph.nodes[0].x = 77
  disk.automationDraft = { key: 'draft', name: 'Window draft', entries: [] }
  const original = structuredClone(disk)
  const store = {
    get: (key: string) => key === 'canvases' ? structuredClone(librarySession(disk)) : key === 'graph' ? disk.tabs[0]?.graph : key === 'libraryMigrated' ? true : undefined,
    set: (values: { canvases: CanvasBook }) => { disk = structuredClone(values.canvases) },
  }
  const callbacks = runInNewContext(compiled, {
    store, structuredClone, normalizeGraph, readWorkspace, writeWorkspace, toolLayerSave, librarySession, isLibraryConflict, unpublishedCatalogSession,
    savedLibrary: structuredClone(original.library), libraryStorage: { save: () => {} }, viewerState: { setBook: () => {} },
  }) as { toolsSave(book: CanvasBook): void; windowSave(event: unknown, book: CanvasBook): void; loadCanvases(): CanvasBook }
  for (const branches of [[{ id: 'created', groups: [] }], [{ id: 'created', groups: [{ id: 'edited' }] }], []]) {
    callbacks.toolsSave({ ...original, tabs: [], activeId: '', branches })
    let loaded = callbacks.loadCanvases()
    expect(loaded.branches ?? []).toEqual(branches)
    expect(loaded.tabs).toEqual(original.tabs)
    expect(loaded.automationDraft).toEqual(original.automationDraft)
    callbacks.windowSave(undefined, { ...original, branches: [{ id: 'obsolete renderer copy' }] })
    loaded = callbacks.loadCanvases()
    expect(loaded.branches ?? []).toEqual(branches)
    expect(loaded.library).toEqual(original.library)
  }
})

it('session-only saves and tool saves never publish a stale catalog, but preserve drafts and tool branches', () => {
  const graph = { nodes: [createNode('start', 0, 0)], edges: [] }
  const catalog = { schemaVersion: 2 as const, canvases: [{ id: 'saved', name: 'Current', graph, updatedAt: 1 }], automations: [] }
  let disk = normalizeCanvasBook({ activeId: 'tab', tabs: [{ id: 'tab', name: 'Current', graph }], library: catalog })
  const save = vi.fn(), views: CanvasBook[] = []
  const callbacks = runInNewContext(compiled, {
    store: { get: (key: string) => key === 'canvases' ? librarySession(disk) : key === 'libraryMigrated' ? true : undefined,
      set: (value: { canvases: CanvasBook }) => { disk = value.canvases } },
    structuredClone, normalizeGraph, readWorkspace, writeWorkspace, toolLayerSave, librarySession, isLibraryConflict, unpublishedCatalogSession,
    savedLibrary: structuredClone(catalog), libraryStorage: { save }, viewerState: { setBook: (book: CanvasBook) => views.push(book) },
  }) as { windowSave(e: unknown, b: CanvasBook, options?: { catalog?: boolean }): { conflict: boolean }; toolsSave(b: CanvasBook): void; loadCanvases(): CanvasBook }
  const stale = normalizeCanvasBook({ ...disk, library: { canvases: [], automations: [] } })
  stale.tabs[0].graph.nodes[0].title = 'Draft edit'
  callbacks.windowSave(undefined, stale, { catalog: false })
  expect(save).not.toHaveBeenCalled(); expect(callbacks.loadCanvases().library).toEqual(catalog)
  expect(callbacks.loadCanvases().tabs[0].graph.nodes[0].title).toBe('Draft edit')
  expect(views.at(-1)!.library).toEqual(catalog)
  callbacks.toolsSave({ ...stale, branches: [{ id: 'tools' }] })
  expect(save).not.toHaveBeenCalled(); expect(callbacks.loadCanvases().branches).toEqual([{ id: 'tools' }])
})

it('a rejected catalog update keeps the previous save baseline so an edited draft is recoverable after restart', () => {
  const graph = { nodes: [createNode('start', 0, 0)], edges: [] }
  const catalog = { schemaVersion: 2 as const, canvases: [{ id: 'saved', name: 'Current', graph, updatedAt: 1 }], automations: [] }
  let disk = normalizeCanvasBook({ activeId: 'tab', tabs: [{ id: 'tab', savedId: 'saved', name: 'Current', graph, baseline: { name: 'Current', graph } }], library: catalog })
  const callbacks = runInNewContext(compiled, {
    store: { get: (key: string) => key === 'canvases' ? librarySession(disk) : key === 'libraryMigrated' ? true : undefined,
      set: (value: { canvases: CanvasBook }) => { disk = value.canvases } },
    structuredClone, normalizeGraph, readWorkspace, writeWorkspace, toolLayerSave, librarySession, isLibraryConflict, unpublishedCatalogSession,
    savedLibrary: structuredClone(catalog), libraryStorage: { save: () => { throw new LibraryConflictError('external change') } }, viewerState: { setBook: () => {} },
  }) as { windowSave(e: unknown, b: CanvasBook): { conflict: boolean }; loadCanvases(): CanvasBook }
  const incoming = structuredClone(callbacks.loadCanvases())
  incoming.tabs[0].graph.nodes[0].title = 'Unpublished edit'
  const published = saveCanvas(incoming, 'tab')
  expect(callbacks.windowSave(undefined, published).conflict).toBe(true)
  const loaded = callbacks.loadCanvases()
  expect(loaded.library).toEqual(catalog)
  expect(loaded.tabs[0].baseline!.graph.nodes[0].title).not.toBe('Unpublished edit')
  expect(startCanvasSession(loaded).recovery![0].graph.nodes[0].title).toBe('Unpublished edit')
})

it('a catalog IO error still preserves the edited session baseline before reporting failure', () => {
  const graph = { nodes: [createNode('start', 0, 0)], edges: [] }
  const catalog = { schemaVersion: 2 as const, canvases: [{ id: 'saved', name: 'Current', graph, updatedAt: 1 }], automations: [] }
  let disk = normalizeCanvasBook({ activeId: 'tab', tabs: [{ id: 'tab', savedId: 'saved', name: 'Current', graph, baseline: { name: 'Current', graph } }], library: catalog })
  const callbacks = runInNewContext(compiled, {
    store: { get: (key: string) => key === 'canvases' ? librarySession(disk) : key === 'libraryMigrated' ? true : undefined,
      set: (value: { canvases: CanvasBook }) => { disk = value.canvases } },
    structuredClone, normalizeGraph, readWorkspace, writeWorkspace, toolLayerSave, librarySession, isLibraryConflict, unpublishedCatalogSession,
    savedLibrary: structuredClone(catalog), libraryStorage: { save: () => { throw new Error('disk full') } }, viewerState: { setBook: () => {} },
  }) as { windowSave(e: unknown, b: CanvasBook): { conflict: boolean; libraryError?: string }; loadCanvases(): CanvasBook }
  const incoming = structuredClone(callbacks.loadCanvases()); incoming.tabs[0].graph.nodes[0].title = 'Retained draft'
  // Birleşik sözleşme (1.9.99): katalog yazımı başarısız olduğunda hata YÜKSELTİLMEZ. Oturum yine yazılır,
  // çağırana `libraryError` döner (IPC sarmalı olmayan net mesaj + sekme kirli kalır) ve taban korunur.
  expect(callbacks.windowSave(undefined, saveCanvas(incoming, 'tab'))).toEqual({ conflict: false, libraryError: 'disk full' })
  expect(startCanvasSession(callbacks.loadCanvases()).recovery![0].graph.nodes[0].title).toBe('Retained draft')
})

it('a session-only call cannot migrate tabs into a missing catalog',()=>{
 const current:CanvasBook={activeId:'',tabs:[]},written:CanvasBook={activeId:'tab',tabs:[{id:'tab',name:'Draft',graph:{nodes:[],edges:[]}}]}
 const set=vi.fn();writeWorkspace({set},written,current,'session')
 expect(set.mock.calls[0][0].canvases.library.canvases).toEqual([])
 expect(set.mock.calls[0][0].canvases.tabs[0].savedId).toBeUndefined()
})
