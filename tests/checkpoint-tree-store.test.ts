import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { expect, it } from 'vitest'
import { Checkpoints } from '../electron/checkpoints'
import { createNode } from '../electron/graph-types'
import type { CheckpointLoop } from '../electron/checkpoint-types'

it('persists nested lap states and binds delayed stat work to event-time context, not the last checkpoint label', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-tree-')), output = path.join(dir, 'outputs'), history = path.join(dir, 'history')
  fs.mkdirSync(output)
  let listener: (event: string, file: string) => void = () => {}
  const store = new Checkpoints(history, () => {}, { discover: async () => [], watch: ((_root: string, _opts: unknown, cb: typeof listener) => { listener = cb; return Object.assign(new EventEmitter(), { close() {} }) }) as unknown as typeof fs.watch })
  const outer = { ...createNode('loop', 0, 0), id: 'outer', title: 'Accounts', folder: output }, inner = { ...createNode('loop', 0, 0), id: 'inner', title: 'Images' }
  const graph = { nodes: [outer, inner], edges: [] }
  const frame = (id: string): CheckpointLoop => ({ id, keys: ['same.glb'], index: 0, isList: true, outerVars: {}, visitId: id })
  try {
    await store.begin('run', 'canvas', 'Canvas')
    await store.mark('Canvas start', { graph, cursor: { packagePath: [], loops: [], scopes: [] } }, { canvasStart: true })
    const a = frame('outer'), b = frame('inner')
    await store.mark('Outer', { graph, cursor: { packagePath: [], loops: [a], scopes: [] } })
    const innerId = await store.mark('Inner', { graph, cursor: { packagePath: [], loops: [a, b], scopes: [] } })
    const event = (name: string) => { fs.writeFileSync(path.join(output, name), 'x'); listener('rename', name) }
    event('inner.glb')
    event('shared.glb')
    store.context([a, b], 'completed')
    store.context([a]); event('outer.glb'); event('shared.glb')
    store.context([a], 'completed'); store.context([]); event('canvas.glb')
    await store.finish('completed')
    const reloaded = new Checkpoints(history)
    const rows = await reloaded.list(), laps = rows.flatMap(r => r.activity ?? [])
    expect(laps).toHaveLength(2); expect(laps.every(l => l.status === 'completed')).toBe(true)
    const details = await reloaded.detail(innerId)
    const key = (id: string) => laps.find(l => l.loopId === id)!.key
    expect(details.outputs.map(o => [path.basename(o.path), o.lapKey])).toEqual([['inner.glb', key('inner')], ['shared.glb', key('inner')], ['outer.glb', key('outer')], ['shared.glb', key('outer')], ['canvas.glb', undefined]])
    expect(details.outputScopes).toEqual({ [key('inner')]: 2, [key('outer')]: 2, '': 1 })
    expect(laps.find(l => l.loopId === 'inner')?.checkpointId).toBe(innerId)
  } finally { await store.finish('stopped'); fs.rmSync(dir, { recursive: true, force: true }) }
})

it('reports persisted open laps as interrupted after restart and does not create phantom laps for a resumed canvas-start record', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-tree-restart-')), store = new Checkpoints(dir)
  const node = createNode('loop', 0, 0), graph = { nodes: [node], edges: [] }
  const cursor = { packagePath: [], scopes: [], loops: [{ id: node.id, keys: ['a'], index: 0, isList: true, outerVars: {}, visitId: 'old' }] }
  try {
    await store.begin('one', 'canvas', 'Canvas')
    await store.mark('lap', { graph, cursor })
    expect((await new Checkpoints(dir).list()).flatMap(r => r.activity ?? [])[0].status).toBe('interrupted')
    await store.finish('stopped')
    await store.begin('two', 'canvas', 'Canvas')
    await store.mark('Resume', { graph, cursor }, { canvasStart: true })
    await store.finish('stopped')
    expect((await store.list()).filter(r => r.runId === 'two').flatMap(r => r.activity ?? [])).toEqual([])
  } finally { await store.finish('stopped'); fs.rmSync(dir, { recursive: true, force: true }) }
})

it('keeps pending frozen inner loops in the resume snapshot without pretending they are currently executing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-pending-')), store = new Checkpoints(dir)
  const graph = { nodes: [createNode('loop', 0, 0)], edges: [] }
  const frame = (id: string): CheckpointLoop => ({ id, keys: ['a'], index: 0, isList: true, outerVars: {}, visitId: id })
  try {
    await store.begin('run', 'canvas', 'Canvas')
    store.context([frame('outer')])
    const id = await store.mark('outer', { graph, cursor: { loops: [frame('outer'), frame('pending-inner')], packagePath: [], scopes: [] } }, { useCurrentContext: true })
    expect((await store.list()).flatMap(r => r.activity ?? []).map(l => l.loopId)).toEqual(['outer'])
    expect((await store.snapshot(id)).cursor.loops).toHaveLength(2)
    await store.finish('completed')
    const file = fs.readdirSync(dir).find(name => name.endsWith('.activity.jsonl'))!
    fs.appendFileSync(path.join(dir, file), '{"truncated":')
    const rows = await store.list()
    expect(rows.flatMap(r => r.activity ?? [])).toHaveLength(1)
    expect(rows[0].issues.join()).toContain('bozuk satır')
  } finally { await store.finish('stopped'); fs.rmSync(dir, { recursive: true, force: true }) }
})
