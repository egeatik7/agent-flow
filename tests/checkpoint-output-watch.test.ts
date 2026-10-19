import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { CheckpointOutputWatch } from '../electron/checkpoint-output-watch'
import type { CheckpointDetail } from '../electron/checkpoint-types'
let base = '', observer: CheckpointOutputWatch | undefined
const cp = (id: string): CheckpointDetail => ({ id, runId: 'run', ordinal: 1, canvasId: 'canvas', canvasName: 'A', label: 'lap', at: Date.now(), status: 'running', outputCount: 0, outputs: [], roots: [], issues: [] })
afterEach(() => { observer?.stop(); observer = undefined; if (base) fs.rmSync(base, { recursive: true, force: true }); base = ''; vi.restoreAllMocks() })
async function harness() {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-output-watch-'))
  let roots = [path.join(base, 'drive-A')]; fs.mkdirSync(roots[0])
  const listeners = new Map<string, (event: string, filename: string | null) => void>()
  const close = vi.fn()
  observer = new CheckpointOutputWatch({ discover: async () => roots, watch: ((folder: string, _opts: unknown, listener: (event: string, filename: string | null) => void) => {
    listeners.set(folder, listener)
    return Object.assign(new EventEmitter(), { close: () => { close(folder); listeners.delete(folder) } })
  }) as unknown as typeof fs.watch })
  await observer.start()
  return { observer, listeners, close, root: roots[0], roots: (next: string[]) => { roots = next } }
}
it('adds newly detected disks and closes removed disks without resetting checkpoint ownership', async () => {
  const h = await harness(), interval = cp('one'); h.observer.bind(interval)
  const second = path.join(base, 'drive-B'); fs.mkdirSync(second)
  h.roots([h.root, second]); await h.observer.refresh()
  expect(h.observer.monitoring().roots).toEqual([h.root, second])
  const file = path.join(second, 'new.glb'); fs.writeFileSync(file, 'new'); h.listeners.get(second)!('rename', 'new.glb')
  h.roots([second]); await h.observer.refresh()
  expect(h.close).toHaveBeenCalledWith(h.root)
  await h.observer.drain(); expect(interval.outputs[0].path).toBe(file)
  expect(interval.issues.join()).toContain('sona erdi')
})
it('coalesces repeated file notifications within each interval, preserving old and new checkpoint ownership', async () => {
  const h = await harness(), first = cp('first'), second = cp('second')
  const file = path.join(h.root, 'same.blend'); fs.writeFileSync(file, 'model')
  h.observer.bind(first)
  for (let i = 0; i < 1000; i++) h.listeners.get(h.root)!('change', 'same.blend')
  h.observer.bind(second); h.listeners.get(h.root)!('change', 'same.blend')
  const dirty = await h.observer.drain()
  expect(dirty).toContain(first); expect(dirty).toContain(second)
  expect(first.outputs).toHaveLength(1); expect(second.outputs).toHaveLength(1)
  expect(first.outputs[0].path).toBe(second.outputs[0].path)
})
it('never walks a whole drive for an empty or root-only notification', async () => {
  const h = await harness(), interval = cp('one'); h.observer.bind(interval)
  const readdir = vi.spyOn(fs.promises, 'readdir')
  h.listeners.get(h.root)!('rename', null); h.listeners.get(h.root)!('rename', '.')
  await h.observer.drain()
  expect(interval.outputs).toHaveLength(0); expect(interval.issues).toHaveLength(2)
  expect(readdir).not.toHaveBeenCalled()
})
it('retains dirty checkpoint updates for retry after a journal write failure', async () => {
  const h = await harness(), interval = cp('one'); h.observer.bind(interval)
  fs.writeFileSync(path.join(h.root, 'one.txt'), 'one'); h.listeners.get(h.root)!('change', 'one.txt')
  const dirty = await h.observer.drain(); expect(dirty).toEqual([interval])
  h.observer.retryPersist(dirty)
  expect(await h.observer.drain()).toEqual([interval])
  expect(await h.observer.drain()).toEqual([])
})
