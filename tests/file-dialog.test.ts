import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import RunFilesDialog from '../src/components/RunFilesDialog'
import FilesPanel from '../src/components/FilesPanel'
import { FileLibrary } from '../electron/file-library'
import { fileCanvasKey, fileSetup, DEFAULT_FILE_SETUP, type FileRunContext } from '../electron/file-contract'
import { listFileSource } from '../electron/file-list'
import { createNode, type XpAgentApi, type AgentGraph } from '../src/types'

let renderer: ReactTestRenderer | undefined, dir = ''
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; if (dir) fs.rmSync(dir, { recursive: true, force: true }) })
function fixture() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-dialog-'))
  const lib = new FileLibrary(path.join(dir, 'Data')), folder = lib.create('GLB modelleri')
  fs.writeFileSync(path.join(folder.path, 'Chair.glb'), 'bytes')
  const start = createNode('start', 0, 0); start.fileSetup = { ...DEFAULT_FILE_SETUP, inputFilter: '*.glb', tools: false }
  const graph: AgentGraph = { nodes: [start], edges: [] }
  const api = {
    fileInfo: async () => lib.info(), fileDefaults: async (g: AgentGraph) => lib.defaults(fileCanvasKey(g)),
    prepareFiles: (g: AgentGraph, s: Parameters<FileLibrary['prepare']>[2]) => lib.prepare(fileCanvasKey(g), fileSetup(g)!, s),
    listFileSource, fileBrowse: (id: string, rel: string) => lib.browse(id, rel),
    fileAction: async (a: any) => { if (a.kind === 'create') lib.create(a.name, a.id, a.relative); else if (a.kind === 'import') await lib.importFiles(a.id, a.paths, a.relative); else if (a.kind === 'forget') lib.forget(a.id); return lib.info() },
  } as unknown as XpAgentApi
  return { lib, folder, graph, api }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 25))
it('the actual start dialog selects a Nubbo folder and creates a real output/workspace on Başlat', async () => {
  const { api, folder, graph } = fixture(), answer = vi.fn<(c: FileRunContext | null) => void>()
  await act(async () => { renderer = create(React.createElement(RunFilesDialog, { api, graph, resume: false, onAnswer: answer })); await settle() })
  await act(async () => { renderer!.root.findAllByType('select')[0].props.onChange({ target: { value: folder.id } }); await settle() })
  const start = renderer!.root.findAllByType('button').find(b => b.children.join('') === 'Başlat')!
  expect(start.props.disabled).toBeFalsy()
  await act(async () => { start.props.onClick(); await settle() })
  expect(answer).toHaveBeenCalledTimes(1)
  const c = answer.mock.calls[0][0]!
  expect(c.input).toBe(folder.path); expect(fs.statSync(c.output).isDirectory()).toBe(true)
  expect(fs.statSync(c.vars['calisma.remesh']).isDirectory()).toBe(true)
})
it('resume action hands back the saved context without allocating a second workspace', async () => {
  const { api, lib, folder, graph } = fixture()
  const old = await lib.prepare(fileCanvasKey(graph), fileSetup(graph)!, { inputId: folder.id, newOutput: true, tools: '' })
  const answer = vi.fn()
  await act(async () => { renderer = create(React.createElement(RunFilesDialog, { api, graph, resume: true, onAnswer: answer })); await settle() })
  const button = renderer!.root.findAllByType('button').find(b => b.children.join('') === 'Aynı klasörlerle devam et')!
  await act(async () => { button.props.onClick() })
  expect(answer.mock.calls[0][0].id).toBe(old.id)
  expect(fs.readdirSync(path.join(lib.root, 'Calismalar'))).toEqual([old.id])
})
it('the actual files panel creates real folders and removes only its catalog entry', async () => {
  const { api, lib, folder } = fixture()
  await act(async () => { renderer = create(React.createElement(FilesPanel, { api, onClose: () => {} })); await settle() })
  const name = renderer!.root.findByProps({ 'aria-label': 'Yeni klasör veya yeni ad' })
  await act(async () => { name.props.onChange({ target: { value: 'Yeni iş' } }) })
  const createButton = renderer!.root.findAllByType('button').find(b => b.children.join('') === 'Yeni klasör')!
  await act(async () => { createButton.props.onClick(); await settle() })
  const f = lib.info().folders.find(f => f.name === 'Yeni iş')!
  expect(fs.statSync(f.path).isDirectory()).toBe(true)
  const forget = renderer!.root.findAllByType('button').find(b => b.children.join('') === 'Listeden kaldır')!
  await act(async () => { forget.props.onClick(); await settle() })
  expect(lib.info().folders.map(f => f.id)).toEqual([folder.id]); expect(fs.existsSync(f.path)).toBe(true)
})
