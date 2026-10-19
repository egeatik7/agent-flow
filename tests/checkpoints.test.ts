import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Checkpoints } from '../electron/checkpoints'
import type { CheckpointSnapshot } from '../electron/checkpoint-types'
const snapshot: CheckpointSnapshot = { graph: { nodes: [], edges: [] }, cursor: { packagePath: [], loops: [], scopes: [] } }
let base: string, root: string, other: string, store: Checkpoints
let roots: string[], callbacks: Map<string, (event: string, filename: string | null) => void>
let watchers: Map<string, EventEmitter & { close: () => void }>
const event = (p: string, name = 'change', watchRoot = root) => callbacks.get(watchRoot)?.(name, path.relative(watchRoot, p))
function makeStore(exclude: string[] = []) {
  return new Checkpoints(path.join(base, 'history'), () => {}, { discover: async () => roots, exclude, watch: ((folder: string, _options: unknown, listener: (event: string, filename: string | null) => void) => {
    const watcher = Object.assign(new EventEmitter(), { close: vi.fn(() => callbacks.delete(folder)) })
    callbacks.set(folder, listener); watchers.set(folder, watcher)
    return watcher
  }) as unknown as typeof fs.watch })
}
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-auto-checkpoint-')); root = path.join(base, 'drive-C'); other = path.join(base, 'drive-D')
  fs.mkdirSync(root); fs.mkdirSync(other)
  roots = [root, other]; callbacks = new Map(); watchers = new Map(); store = makeStore()
})
afterEach(async () => { await store.finish('stopped'); fs.rmSync(base, { recursive: true, force: true }); vi.restoreAllMocks() })

describe('automatic disk monitoring, no selected folders', () => {
  it('starts all discovered roots automatically; records outside the usual download folders without scanning existing files', async () => {
    fs.writeFileSync(path.join(root, 'untouched.blend'), 'old')
    const readdir = vi.spyOn(fs.promises, 'readdir')
    await store.begin('run', 'canvas', 'Blender'); const id = await store.mark('start', snapshot)
    expect(store.monitoring().roots).toEqual([root, other])
    expect(readdir).not.toHaveBeenCalled() // No whole-volume baseline or directory discovery scan.
    const file = path.join(other, 'arbitrary.glb'); fs.writeFileSync(file, 'glb'); event(file, 'rename', other)
    await store.finish('completed')
    expect((await store.detail(id)).outputs).toEqual([expect.objectContaining({ path: file, change: 'observed', present: true })])
  })
  it('assigns queued asynchronous file events to the checkpoint when received, not when stat completes', async () => {
    await store.begin('run', 'canvas', 'Blender'); const a = await store.mark('first', snapshot)
    const file = path.join(root, 'first.blend'); fs.writeFileSync(file, 'A'); event(file, 'rename')
    const b = await store.mark('second', snapshot)
    fs.writeFileSync(file, 'changed file'); event(file)
    await store.finish('failed')
    const first = await store.detail(a), second = await store.detail(b)
    expect(first.outputs.map(o => o.path)).toEqual([file]); expect(second.outputs.map(o => o.path)).toEqual([file])
    expect(first.endedAt).toBe(second.at); expect(second.status).toBe('failed')
    fs.unlinkSync(file); expect((await store.detail(a)).outputs[0].present).toBe(false)
    expect((await new Checkpoints(path.join(base, 'history')).list()).map(cp => cp.id)).toEqual([a, b])
  })
  it('ignores idle time; closes watchers and creates a new linked run', async () => {
    await store.begin('run', 'canvas', 'A'); const a = await store.mark('start', snapshot)
    await store.finish('completed')
    expect([...watchers.values()].every(w => (w.close as any).mock.calls.length === 1)).toBe(true)
    fs.writeFileSync(path.join(root, 'idle.txt'), 'idle')
    await store.begin('retry', 'canvas', 'Retry', a); const b = await store.mark('start', snapshot)
    const output = path.join(other, 'retry.blend'); fs.writeFileSync(output, 'retry'); event(output, 'rename', other)
    await store.finish('stopped')
    expect((await store.detail(a)).outputs).toEqual([])
    expect((await store.detail(b)).outputs.map(o => o.path)).toEqual([output]); expect((await store.detail(b)).parentId).toBe(a)
  })
  it('captures children of a renamed populated folder and does not follow symlink cycles', async () => {
    await store.begin('run', 'canvas', 'A'); const id = await store.mark('start', snapshot)
    const batch = path.join(root, 'batch'); fs.mkdirSync(batch); const child = path.join(batch, 'one.glb'); fs.writeFileSync(child, 'glb')
    try { fs.symlinkSync(batch, path.join(batch, 'cycle')) } catch (e) { if (process.platform !== 'win32' || (e as NodeJS.ErrnoException).code !== 'EPERM') throw e }
    event(batch, 'rename'); await store.finish('completed')
    const outputs = (await store.detail(id)).outputs.map(o => o.path)
    expect(outputs).toContain(batch); expect(outputs).toContain(child); expect(outputs.length).toBeLessThan(5)
  })
  it('does not record its own journal, excluded system locations, recycle bin or events outside the notified root', async () => {
    roots = [base]
    store = makeStore([path.join(root, 'Windows')]); await store.begin('run', 'canvas', 'A'); const id = await store.mark('start', snapshot)
    for (const p of [path.join(base, 'history', 'own.json'), path.join(root, 'Windows', 'system.log'), path.join(root, '$Recycle.Bin', 'deleted'), path.join(base, '..', 'outside.txt')]) event(p, 'rename', base)
    await store.finish('completed'); expect((await store.detail(id)).outputs).toEqual([])
  })
  it('shows missing-filename/watcher errors as incomplete monitoring instead of a successful empty result', async () => {
    await store.begin('run', 'canvas', 'A'); const id = await store.mark('start', snapshot)
    callbacks.get(root)!('change', null)
    watchers.get(other)!.emit('error', new Error('volume disconnected'))
    await store.finish('failed')
    const detail = await store.detail(id)
    expect(detail.issues.join()).toContain('yolunu bildirmedi'); expect(detail.issues.join()).toContain('volume disconnected')
  })
  it('refuses to start when no automatic roots can be watched; never asks for manual roots', async () => {
    roots = []
    await expect(store.begin('run', 'canvas', 'A')).rejects.toThrow('Otomatik çıktı izleme başlatılamadı')
    expect(store.monitoring().active).toBe(false)
    expect('configure' in store).toBe(false)
    await expect(store.snapshot('../bad')).rejects.toThrow('Geçersiz')
  })
  it('detects an interrupted persisted run and records a path which vanished before metadata could be read', async () => {
    await store.begin('run', 'canvas', 'A'); const id = await store.mark('start', snapshot)
    event(path.join(root, 'gone.blend'), 'rename')
    const b = await store.mark('next', snapshot)
    expect((await store.detail(id)).outputs[0]).toMatchObject({ kind: 'unknown', present: false, change: 'observed' })
    expect((await new Checkpoints(path.join(base, 'history')).list()).find(cp => cp.id === b)?.status).toBe('interrupted')
  })
})

it('receives real native filesystem events without a configured output folder or baseline scan', async () => {
  store = new Checkpoints(path.join(base, 'history'), () => {}, { discover: async () => [root] })
  await store.begin('real', 'canvas', 'Native watch')
  const id = await store.mark('start', snapshot)
  const folder = path.join(root, 'new-batch'); fs.mkdirSync(folder)
  const file = path.join(folder, 'one.blend'); fs.writeFileSync(file, 'blend')
  await expect.poll(async () => (await store.detail(id)).outputs.map(o => o.path), { timeout: 5000 }).toContain(file)
  await store.finish('completed')
  expect((await store.detail(id)).outputs).toContainEqual(expect.objectContaining({ path: file, present: true }))
})
