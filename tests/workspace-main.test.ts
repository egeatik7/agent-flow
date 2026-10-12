import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { createNode, normalizeCanvasBook, normalizeGraph, type CanvasBook } from '../electron/graph-types'
import { readWorkspace, writeWorkspace } from '../electron/workspace-store'
import { toolLayerSave } from '../electron/tool-branch'
import { librarySession, isLibraryConflict } from '../electron/library-storage'

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
    store, structuredClone, normalizeGraph, readWorkspace, writeWorkspace, toolLayerSave, librarySession, isLibraryConflict,
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
