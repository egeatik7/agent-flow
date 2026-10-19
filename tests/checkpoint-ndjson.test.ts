import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Checkpoints } from '../electron/checkpoints'
import { createNode, type AgentGraph } from '../electron/graph-types'

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-ndjson-')) }

describe('checkpoint yazımı: meta JSON + append-only NDJSON', () => {
  it('çıktılar JSON içine gömülmez; NDJSON satırı olarak yazılır', async () => {
    const dir = tempDir()
    const root = path.join(dir, 'Image Folder')
    fs.mkdirSync(root, { recursive: true })
    let listener: ((event: string, filename: string | null) => void) | undefined
    const store = new Checkpoints(path.join(dir, 'checkpoints'), () => {}, {
      discover: async () => [],
      watch: ((folder: string, _options: unknown, cb: (event: string, filename: string | null) => void) => {
        listener = cb
        return Object.assign(new EventEmitterLike(), { close: () => {} })
      }) as unknown as typeof fs.watch,
    })
    const loop = createNode('loop', 0, 0); loop.folder = root; loop.members = []
    const graph: AgentGraph = { nodes: [loop], edges: [] }
    await store.begin('run', 'canvas', 'Tuval')
    const id = await store.mark('başlangıç', { graph, cursor: { packagePath: [], loops: [], scopes: [] } })
    const file = path.join(root, 'sonuc.glb')
    fs.writeFileSync(file, 'glb')
    listener?.('rename', 'sonuc.glb')
    await store.finish('completed')

    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'checkpoints', `${id}.json`), 'utf8'))
    expect(meta.outputs).toEqual([])
    expect(meta.outputCount).toBeGreaterThan(0)
    const lines = fs.readFileSync(path.join(dir, 'checkpoints', `${id}.outputs.jsonl`), 'utf8').split('\n').filter(Boolean)
    expect(lines.length).toBe(meta.outputCount)
    expect(JSON.parse(lines[0]).path).toBe(file)

    const detail = await store.detail(id)
    expect(detail.outputs.map((o: { path: string }) => o.path)).toEqual([file])
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

class EventEmitterLike {
  private handlers: Record<string, ((...args: unknown[]) => void)[]> = {}
  on(event: string, handler: (...args: unknown[]) => void) { (this.handlers[event] ??= []).push(handler); return this }
  emit(event: string, ...args: unknown[]) { for (const h of this.handlers[event] ?? []) h(...args) }
}
