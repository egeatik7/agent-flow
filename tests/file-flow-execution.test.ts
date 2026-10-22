import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileLibrary } from '../electron/file-library'
import { fileCanvasKey, fileSetup } from '../electron/file-contract'
import { listFileSource } from '../electron/file-list'
import { normalizeGraph, type AgentGraph, type AgentNode } from '../electron/graph-types'
import { inspectRunStructure } from '../electron/run-structure'
import { runGraph, type Executor } from '../electron/runner'

let dir = ''
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-flow-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })
function nodes(g: AgentGraph): AgentNode[] { return g.nodes.flatMap(n => [n, ...(n.inner ? nodes(n.inner) : [])]) }
function read(name: string) {
  const raw = JSON.parse(fs.readFileSync(new URL(`../examples/file-flows/${name}.json`, import.meta.url), 'utf8'))
  return normalizeGraph(raw)
}

/** Real runner + real temporary files. ONLY the external GUIs/LLM are simulated.
 * This proves wiring/list lifetimes/path propagation, not live Windows tool behavior. */
function toolSimulation(g: AgentGraph) {
  const fields: Record<string, string> = {}, saved: string[] = [], profiles: string[] = []
  let exe = '', renameSource = '', blendFolder = ''
  const convertPath = (s: string) => s.replace(/\\/g, path.sep)
  for (const n of nodes(g)) {
    if (n.kind === 'wait') n.ms = 0
    for (const f of ['text', 'folder', 'source'] as const) if (n[f]) n[f] = convertPath(n[f]!)
  }
  const ex: Executor = {
    log: () => {}, step: () => {}, shouldStop: () => false,
    key: async () => {}, exists: async () => true, initiative: async () => true,
    type: async n => {
      const text = n.text ?? ''
      expect(text).not.toMatch(/\{\{(?:girdi|cikti|calisma|araclar|öğe|dongu)/)
      if (n.id.endsWith('_exe') || n.id === 's2_mv3rh4uqcsrbvajd') { exe = text; for (const k of Object.keys(fields)) delete fields[k] }
      const field = n.id.match(/_(source|target|size|limit|filter)$/)?.[1]
      if (field) fields[field] = text
      if (n.id === 's2_mv3rh4uq6pvt8nhp') renameSource = text
      if (n.id.endsWith('five_download_output')) { fs.writeFileSync(text, 'simulated GLB bytes'); saved.push(text) }
      if (n.id.endsWith('save_initial_005')) blendFolder = text
      if (n.id.endsWith('save_initial_008')) { const p = path.join(blendFolder, text); fs.writeFileSync(p, 'simulated Blend bytes'); saved.push(p) }
    },
    click: async n => {
      if (n.id.endsWith('hy20_profile_choose')) profiles.push(n.prompt ?? '')
      if (n.id === 's2_mv3rh4uqberz2gzj') {
        const paths = await listFileSource(renameSource, { kind: 'files', filter: '*.png;*.jpg;*.jpeg;*.webp' })
        for (let i = 0; i < paths.length; i++) fs.renameSync(paths[i], path.join(renameSource, `Named${String(i + 1).padStart(3, '0')}${path.extname(paths[i])}`))
      }
      if (!n.id.endsWith('_go')) return
      const files = await listFileSource(fields.source, { kind: 'files', filter: fields.filter, recursive: /FileCollector/.test(exe) && !n.id.startsWith('s3_') })
      fs.mkdirSync(fields.target, { recursive: true })
      if (/FolderBatcher/.test(exe)) {
        const size = Number(fields.size), limit = Number(fields.limit) || files.length
        for (let i = 0; i < Math.min(limit, files.length); i++) {
          const folder = path.join(fields.target, String(Math.floor(i / size) + 1).padStart(2, '0'))
          fs.mkdirSync(folder, { recursive: true }); fs.copyFileSync(files[i], path.join(folder, path.basename(files[i])))
        }
      } else if (/FileCollector/.test(exe)) for (const file of files) fs.copyFileSync(file, path.join(fields.target, path.basename(file)))
      else throw new Error(`Unexpected external tool: ${exe}`)
    },
  }
  return { ex, saved, profiles }
}

describe('delivered independent automation graphs', () => {
  for (const filename of ['Image-Isimlendir-Hunyuan-GLB', 'GLB-Remesh-Blend']) {
    it(`${filename}: complete graph, unique identities, v2 setup, no fixed Windows paths or removed node types`, () => {
      const g = read(filename), all = nodes(g)
      expect(inspectRunStructure(g, { requireEnd: true })).toEqual([])
      expect(new Set(all.map(n => n.id)).size).toBe(all.length)
      expect(fileSetup(g)).toBeDefined()
      expect(JSON.stringify(g)).not.toMatch(/[A-Za-z]:\\/)
      expect(all.filter(n => ['moveFile', 'waitFile', 'browser'].includes(n.kind))).toEqual([])
      expect(all.filter(n => n.kind === 'loop').every(n => !!n.listSource && !!n.folder)).toBe(true)
    })
  }
  it('18 images traverse naming, 16+2 account groups and 8+8+2 batches into 18 GLB outputs; input bytes and names remain intact', async () => {
    const g = read('Image-Isimlendir-Hunyuan-GLB'), lib = new FileLibrary(path.join(dir, 'Library')), input = lib.create('Görseller'), tools = path.join(dir, 'Tools')
    fs.mkdirSync(tools)
    for (let i = 1; i <= 18; i++) fs.writeFileSync(path.join(input.path, `Image${i}.png`), 'pixels-' + i)
    const context = await lib.prepare(fileCanvasKey(g), fileSetup(g)!, { inputId: input.id, newOutput: true, tools })
    const { ex, saved, profiles } = toolSimulation(g)
    const result = await runGraph(g, ex, { debug: true, maxSteps: 2000, stepDelayMs: 0, fileVars: context.vars, reportEnd: true })
    expect(result.failed).toBe(0); expect(result.reachedEnd).toBe(true)
    expect(saved).toHaveLength(18); expect(new Set(saved).size).toBe(18)
    expect(fs.readdirSync(context.output)).toHaveLength(18)
    expect(fs.readdirSync(input.path)).toHaveLength(18); expect(fs.readFileSync(path.join(input.path, 'Image1.png'), 'utf8')).toBe('pixels-1')
    expect(fs.readdirSync(context.vars['calisma.hesaplar'])).toEqual(['01', '02'])
    expect(profiles).toHaveLength(2); expect(profiles[0]).toContain('1.'); expect(profiles[1]).toContain('2.')
    expect(saved.every(p => path.dirname(p) === context.vars['calisma.indirme'])).toBe(true)
    expect(nodes(g).some(n => n.title.includes('Blender'))).toBe(false)
  })
  it('31 independent GLBs traverse 15+15+1 groups into three unique Blend files without moving the source', async () => {
    const g = read('GLB-Remesh-Blend'), lib = new FileLibrary(path.join(dir, 'Library')), input = lib.create('GLB giriş'), tools = path.join(dir, 'Tools')
    fs.mkdirSync(tools)
    for (let i = 1; i <= 31; i++) fs.writeFileSync(path.join(input.path, `Model${i}.glb`), 'glb-' + i)
    const context = await lib.prepare(fileCanvasKey(g), fileSetup(g)!, { inputId: input.id, newOutput: true, tools })
    const { ex, saved } = toolSimulation(g)
    const result = await runGraph(g, ex, { debug: true, maxSteps: 2000, stepDelayMs: 0, fileVars: context.vars, reportEnd: true })
    expect(result.failed).toBe(0); expect(result.reachedEnd).toBe(true)
    expect(saved).toHaveLength(3); expect(new Set(saved).size).toBe(3)
    expect(saved.every(p => path.dirname(p) === context.output && path.basename(p).startsWith(context.vars['calisma.kod']))).toBe(true)
    expect(fs.readdirSync(input.path)).toHaveLength(31)
    const groupRoot = context.vars['calisma.remesh']
    expect(fs.readdirSync(groupRoot).map(n => fs.readdirSync(path.join(groupRoot, n)).length)).toEqual([15, 15, 1])
    expect(nodes(g).some(n => /Hunyuan|OldGLBs|OldBlends/.test(n.title))).toBe(false)
  })
})
