import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileLibrary } from '../electron/file-library'
import { DEFAULT_FILE_SETUP, fileSetup, fileCanvasKey, type FileRunContext } from '../electron/file-contract'
import { listFileSource, matchesFile } from '../electron/file-list'
import { createNode, normalizeGraph, type AgentGraph, type AgentNode } from '../electron/graph-types'
import { runGraph, type Executor } from '../electron/runner'
import { exportCanvasFile, readCanvasFile } from '../electron/canvas-file'
import { copyZipCanvas, zipCanvasDocument } from '../electron/zip-canvas-document'
import { zipCanvasGraph, zipDocumentFor } from '../electron/zip-workspace'
import { ZipLibraryStorage } from '../electron/zip-library-storage'
import { copyNodes, pasteNodes, packageSelection, unpackPackage, removeNode } from '../src/lib/graph-ops'
import { flowRoots } from '../electron/checkpoint-roots'
import type { CheckpointCursor } from '../electron/checkpoint-types'
import { revealAt } from '../electron/reveal'
import { probeOnce } from '../electron/tool-probe'

let dir = '', lib: FileLibrary
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-files-')); lib = new FileLibrary(path.join(dir, 'Dosyalar')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })
const setup = { ...DEFAULT_FILE_SETUP, inputFilter: '*.glb', tools: false }
const opts = { debug: true, maxSteps: 100, stepDelayMs: 0 }
const edge = (from: AgentNode, to: AgentNode, fromPort = 'next') => ({ id: `e-${from.id}-${to.id}`, from: from.id, fromPort, to: to.id })
const write = (folder: string, name: string, value = name) => fs.writeFileSync(path.join(folder, name), value)
function graph(): AgentGraph { const s = createNode('start', 0, 0), end = createNode('end', 600, 0); s.fileSetup = structuredClone(setup); return { nodes: [s, end], edges: [edge(s, end)] } }
function fake() {
  const typed: string[] = [], checkpoints: CheckpointCursor[] = []
  const ex: Executor = { log: () => {}, step: () => {}, shouldStop: () => false, click: async () => {}, key: async () => {}, exists: async () => true, type: async n => { typed.push(n.text ?? '') }, checkpoint: async (_label, cursor) => { checkpoints.push(structuredClone(cursor)) } }
  return { ex, typed, checkpoints }
}
async function prepare(g = graph()) {
  const input = lib.create('GLB girişleri'); write(input.path, 'Model2.glb'); write(input.path, 'Model10.glb'); write(input.path, 'Rapor.txt')
  const context = await lib.prepare(fileCanvasKey(g), setup, { inputId: input.id, newOutput: true, tools: '' })
  return { g, input, context }
}

describe('real folders and persistent workspace bindings', () => {
  it('creates real folders, keeps stable identity on rename and reload, and forget never deletes bytes', async () => {
    const f = lib.create('Çizimler 2026'); write(f.path, 'Küp.png', 'image')
    expect((await lib.browse(f.id)).entries.map(e => e.name)).toEqual(['Küp.png'])
    lib.rename(f.id, 'Yeni görünen ad')
    const next = new FileLibrary(lib.root).folder(f.id)
    expect(next.path).toBe(f.path); expect(next.name).toBe('Yeni görünen ad')
    lib.forget(f.id); expect(fs.readFileSync(path.join(f.path, 'Küp.png'), 'utf8')).toBe('image')
  })
  it('links an outside folder without making a copy; imported bytes are copied without changing originals', async () => {
    const outside = path.join(dir, 'Dış görseller'); fs.mkdirSync(outside); write(outside, 'image.png', 'pixels')
    const linked = lib.link(outside), managed = lib.create('Kopyalar')
    expect(linked.path).toBe(fs.realpathSync(outside)); expect(lib.link(outside).id).toBe(linked.id)
    await lib.importFiles(managed.id, [path.join(outside, 'image.png')])
    expect(fs.readFileSync(path.join(managed.path, 'image.png'), 'utf8')).toBe('pixels')
    expect(fs.readFileSync(path.join(outside, 'image.png'), 'utf8')).toBe('pixels')
    await expect(lib.importFiles(managed.id, [path.join(outside, 'image.png')])).rejects.toThrow('Aynı ad')
    expect(fs.readFileSync(path.join(managed.path, 'image.png'), 'utf8')).toBe('pixels')
  })
  it('gives independent full runs separate real output and work folders and remembers the selection', async () => {
    const { g, input, context: a } = await prepare()
    const b = await lib.prepare(fileCanvasKey(g), setup, { inputId: input.id, newOutput: true, tools: '' })
    expect(a.output).not.toBe(b.output); expect(a.workRoot).not.toBe(b.workRoot)
    for (const key of setup.workFolders) expect(fs.statSync(b.vars[`calisma.${key}`]).isDirectory()).toBe(true)
    expect(fs.readFileSync(path.join(input.path, 'Model2.glb'), 'utf8')).toBe('Model2.glb')
    expect(new FileLibrary(lib.root).last(fileCanvasKey(g), setup)?.id).toBe(b.id)
    const work = lib.info().folders.find(f => f.role === 'work' && f.path === a.workRoot)!
    expect((await lib.browse(work.id)).entries.some(e => e.name === 'remesh')).toBe(true)
    expect(lib.info().folders.some(f => f.role === 'output' && f.path === b.output)).toBe(true)
    expect(lib.validate(a, fileCanvasKey(g), setup).output).toBe(a.output)
  })
  it('creates output below a chosen existing folder and supports direct existing output', async () => {
    const { g, input } = await prepare(), parent = lib.create('Sonuçlar')
    const a = await lib.prepare(fileCanvasKey(g), setup, { inputId: input.id, outputId: parent.id, newOutput: true, tools: '' })
    expect(path.dirname(a.output)).toBe(parent.path)
    const b = await lib.prepare(fileCanvasKey(g), setup, { inputId: input.id, outputId: parent.id, newOutput: false, tools: '' })
    expect(b.output).toBe(parent.path)
  })
  it('surfaces missing inputs and corrupt catalogs without replacing them with empty state', async () => {
    const input = lib.create('Boş giriş')
    await expect(lib.prepare('flow', setup, { inputId: input.id, newOutput: true, tools: '' })).rejects.toThrow('uygun dosya')
    fs.rmSync(input.path, { recursive: true }); expect(lib.info().folders[0].available).toBe(false)
    fs.writeFileSync(path.join(lib.root, 'Kayitlar', 'klasorler.json'), '{broken')
    expect(() => lib.create('Yeni')).toThrow(); expect(fs.readFileSync(path.join(lib.root, 'Kayitlar', 'klasorler.json'), 'utf8')).toBe('{broken')
  })
})

describe('filtered lists and run-time scope', () => {
  it('filters real file types, sorts naturally and leaves the legacy reader untouched', async () => {
    const { input } = await prepare(); fs.mkdirSync(path.join(input.path, 'Group1')); write(path.join(input.path, 'Group1'), 'Model1.glb')
    expect((await listFileSource(input.path, { kind: 'files', filter: '*.glb' })).map(p => path.basename(p))).toEqual(['Model2.glb', 'Model10.glb'])
    expect((await listFileSource(input.path, { kind: 'folders', filter: '*' })).map(p => path.basename(p))).toEqual(['Group1'])
    expect((await listFileSource(input.path, { kind: 'files', filter: '*.glb', recursive: true })).length).toBe(3)
    expect(matchesFile('Chair.PNG', '*.jpg;*.png')).toBe(true); expect(matchesFile('file(1).glb', 'file(1).glb')).toBe(true)
  })
  it('reads girdi directly at loop entry and sends real unchanged input/output paths across every item', async () => {
    const { g, context } = await prepare(), l = createNode('loop', 200, 0), body = createNode('type', 400, 0)
    l.folder = '{{girdi}}'; l.listSource = { kind: 'files', filter: '*.glb' }; l.items = ['stale.png']; l.members = [body.id]
    body.text = '{{girdi}}|{{cikti}}|{{öğe.ad}}'
    g.nodes.push(l, body); g.edges = [edge(g.nodes[0], l), edge(l, g.nodes[1], 'done')]
    const { ex, typed } = fake(); await runGraph(g, ex, { ...opts, fileVars: context.vars })
    expect(typed).toEqual(['Model2.glb', 'Model10.glb'].map(n => `${context.input}|${context.output}|${n}`))
  })
  it('takes lists after a producer has created groups and after an external rename, rather than using UI cache', async () => {
    const { g, context } = await prepare(), producer = createNode('type', 100, 0), l = createNode('loop', 300, 0), body = createNode('type', 500, 0)
    producer.text = 'GROUP'; l.folder = '{{calisma.remesh}}'; l.listSource = { kind: 'folders', filter: '*' }; l.items = ['/old/group']; l.members = [body.id]; body.text = '{{öğe.ad}}'
    g.nodes.push(producer, l, body); g.edges = [edge(g.nodes[0], producer), edge(producer, l), edge(l, g.nodes[1], 'done')]
    const { ex, typed } = fake(); const orig = ex.type
    ex.type = async n => { if (n.text === 'GROUP') { fs.mkdirSync(path.join(context.vars['calisma.remesh'], '02')); fs.mkdirSync(path.join(context.vars['calisma.remesh'], '01')); fs.renameSync(path.join(context.input, 'Model2.glb'), path.join(context.input, 'Renamed.glb')) } else await orig(n, 0) }
    await runGraph(g, ex, { ...opts, fileVars: context.vars }); expect(typed).toEqual(['01', '02'])
    expect((await listFileSource(context.input, { kind: 'files', filter: '*.glb' })).map(p => path.basename(p))).toEqual(['Model10.glb', 'Renamed.glb'])
  })
  it('empty modern folder is zero items even when count and cached rows are populated', async () => {
    const { g, context } = await prepare(), l = createNode('loop', 200, 0), body = createNode('type', 400, 0)
    l.folder = '{{calisma.remesh}}'; l.listSource = { kind: 'files', filter: '*.glb' }; l.count = 100; l.items = ['old']; l.members = [body.id]; body.text = 'must not run'
    g.nodes.push(l, body); g.edges = [edge(g.nodes[0], l), edge(l, g.nodes[1], 'done')]
    const { ex, typed } = fake(); const result = await runGraph(g, ex, { ...opts, fileVars: context.vars })
    expect(result.failed).toBe(0); expect(typed).toEqual([])
  })
  it('explicit outer references survive inner loops, packages and selected-package entry', async () => {
    const { g, context } = await prepare(), outer = createNode('loop', 100, 0), inner = createNode('loop', 200, 0), pkg = createNode('package', 300, 0), body = createNode('type', 0, 0)
    outer.items = ['account1', 'account2']; outer.members = [inner.id]; inner.items = ['file1', 'file2']; inner.members = [pkg.id]
    body.text = `{{dongu.${outer.id}.ad}}|{{öğe}}|{{cikti}}`; pkg.inner = { nodes: [body], edges: [] }
    g.nodes.push(outer, inner, pkg); g.edges = [edge(g.nodes[0], outer), edge(outer, g.nodes[1], 'done')]
    const { ex, typed } = fake(); await runGraph(g, ex, { ...opts, fileVars: context.vars })
    expect(typed).toEqual(['account1|file1', 'account1|file2', 'account2|file1', 'account2|file2'].map(x => x + '|' + context.output))
    outer.startIndex = 1; inner.startIndex = 1; typed.length = 0
    await runGraph(g, ex, { ...opts, fileVars: context.vars, packagePath: [pkg.id], startId: body.id, resume: true })
    expect(typed[0]).toBe(`account2|file2|${context.output}`)
  })
  it('checkpoint cursor keeps its frozen list despite a new file and a different latest workspace', async () => {
    const { g, input, context: a } = await prepare(), l = createNode('loop', 200, 0), body = createNode('type', 400, 0)
    l.folder = '{{girdi}}'; l.listSource = { kind: 'files', filter: '*.glb' }; l.members = [body.id]; body.text = '{{cikti}}|{{öğe.ad}}'
    g.nodes.push(l, body); g.edges = [edge(g.nodes[0], l), edge(l, g.nodes[1], 'done')]
    const first = fake(); await runGraph(g, first.ex, { ...opts, fileVars: a.vars })
    const cursor = { ...first.checkpoints[1], files: a }; expect(cursor.loops[0].index).toBe(1)
    write(input.path, 'Model0.glb'); const b = await lib.prepare(fileCanvasKey(g), setup, { inputId: input.id, newOutput: true, tools: '' })
    const next = fake(); await runGraph(g, next.ex, { ...opts, startId: body.id, resume: true, checkpointResume: cursor, fileVars: a.vars })
    expect(next.typed).toEqual([`${a.output}|Model10.glb`]); expect(next.typed[0]).not.toContain(b.output)
    const roots = flowRoots(g, cursor).roots
    expect(roots).toContain(a.output); expect(roots).toContain(a.workRoot)
  })
  it('single-step execution uses exactly the supplied workspace', async () => {
    const { g, context } = await prepare(), body = createNode('type', 200, 0); body.text = '{{cikti}}'
    g.nodes.push(body); g.edges = [edge(g.nodes[0], body), edge(body, g.nodes[1])]
    const { ex, typed } = fake(); await probeOnce(g, body.id, ex, { ...opts, fileVars: context.vars })
    expect(typed).toEqual([context.output])
  })
  it('selected package entry loads its modern outside item from disk and never fabricates an item for an empty source', async () => {
    const { g, context } = await prepare(), l = createNode('loop', 200, 0), pkg = createNode('package', 400, 0), body = createNode('type', 0, 0)
    l.folder = '{{girdi}}'; l.listSource = { kind: 'files', filter: '*.glb' }; l.members = [pkg.id]; l.startIndex = 1
    body.text = '{{öğe.ad}}|{{cikti}}'; pkg.inner = { nodes: [body], edges: [] }
    g.nodes.push(l, pkg); g.edges = [edge(g.nodes[0], l), edge(l, g.nodes[1], 'done')]
    const { ex, typed } = fake()
    await runGraph(g, ex, { ...opts, packagePath: [pkg.id], startId: body.id, resume: true, fileVars: context.vars })
    expect(typed).toEqual([`Model10.glb|${context.output}`])
    l.folder = '{{calisma.remesh}}'; l.items = []; typed.length = 0
    await expect(runGraph(g, ex, { ...opts, packagePath: [pkg.id], startId: body.id, resume: true, fileVars: context.vars })).rejects.toThrow('hazır öğe yok')
    expect(typed).toEqual([])
  })
})

describe('document, package and ZIP persistence', () => {
  it('separately saved copies have independent last-workspace identities', async () => {
    const { g, context } = await prepare(), tab = { id: 'original', name: 'Bir', graph: g }
    const firstCopy = zipDocumentFor(tab, true), secondCopy = copyZipCanvas(zipDocumentFor(tab), 'İki')
    expect(fileCanvasKey(firstCopy)).not.toBe(fileCanvasKey(g)); expect(fileCanvasKey(secondCopy)).not.toBe(fileCanvasKey(g))
    expect(lib.last(fileCanvasKey(firstCopy), fileSetup(firstCopy)!)).toBeUndefined()
    expect(lib.last(fileCanvasKey(g), setup)?.id).toBe(context.id)
  })
  it('round-trips feature-aware v2 through JSON, ZIP and normalization; legacy stays v1', () => {
    const g = graph(), tab = { id: 't', name: 'Modern', graph: g }
    const json = exportCanvasFile(tab); expect(json.version).toBe(2)
    const round = readCanvasFile(JSON.parse(JSON.stringify(json)), 'fallback')
    expect(fileSetup(round.graph)).toEqual(setup)
    const storage = new ZipLibraryStorage(path.join(dir, 'ZIP'))
    const doc = zipDocumentFor(tab); storage.importDocuments('Files', [doc])
    const reopened = storage.load().groups[0].canvases[0]
    expect(fileSetup(zipCanvasGraph(reopened))).toEqual(setup); expect(zipCanvasDocument(reopened).version).toBe(2)
    expect(fileSetup(normalizeGraph(round.graph))).toEqual(setup)
    delete g.nodes[0].fileSetup; expect(exportCanvasFile(tab).version).toBe(1)
  })
  it('keeps setup when the start is packaged and restores it after unpacking', () => {
    const g = graph(), key = fileCanvasKey(g), packed = packageSelection(g, g.nodes.map(n => n.id))!
    const normalized = normalizeGraph(packed.graph)
    expect(fileSetup(normalized)).toEqual(setup); expect(fileCanvasKey(normalized)).toBe(key)
    const unpacked = unpackPackage(packed.graph, packed.id)!
    expect(fileSetup(normalizeGraph(unpacked))).toEqual(setup)
    expect(fileSetup(removeNode(g, g.nodes[1].id))).toEqual(setup)
  })
  it('rewrites scoped loop references when copied and pasted', () => {
    const g = graph(), l = createNode('loop', 200, 0), n = createNode('type', 400, 0)
    l.items = ['v1.2']; l.listSource = { kind: 'folders', filter: '*' }; l.members = [n.id]; n.text = `{{dongu.${l.id}.isim}}`
    g.nodes.push(l, n)
    expect(revealAt(g, n.id, n.text).value).toBe('v1.2')
    const pasted = pasteNodes(g, copyNodes(g, [l.id, n.id])!)!
    const newLoop = pasted.graph.nodes.find(x => pasted.ids.includes(x.id) && x.kind === 'loop')!
    const newType = pasted.graph.nodes.find(x => pasted.ids.includes(x.id) && x.kind === 'type')!
    expect(newType.text).toBe(`{{dongu.${newLoop.id}.isim}}`)
    expect(fileSetup(pasted.graph)).toEqual(setup)
  })
})
