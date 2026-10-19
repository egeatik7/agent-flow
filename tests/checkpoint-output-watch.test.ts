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

/**
 * 1.9.160 — kökler artık ÇAĞIRANdan gelir. `wide` kapalıyken yalnız akış kökleri izlenir;
 * `wide` açıkken keşfedilen disk kökleri eklenir.
 */
async function harness(opts: { wide?: boolean } = {}) {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-output-watch-'))
  let roots = [path.join(base, 'drive-A')]; fs.mkdirSync(roots[0])
  const listeners = new Map<string, (event: string, filename: string | null) => void>()
  const close = vi.fn()
  observer = new CheckpointOutputWatch({
    discover: async () => roots,
    wide: () => opts.wide === true,
    watch: ((folder: string, _opts: unknown, listener: (event: string, filename: string | null) => void) => {
      listeners.set(folder, listener)
      return Object.assign(new EventEmitter(), { close: () => { close(folder); listeners.delete(folder) } })
    }) as unknown as typeof fs.watch,
  })
  await observer.start()
  if (!opts.wide) await observer.setFlowRoots([roots[0]])
  return { observer, listeners, close, root: roots[0], roots: (next: string[]) => { roots = next } }
}

it('TÜM DİSK İZLEME AÇIKKEN yeni algılanan disk eklenir, sökülen disk kapanır', async () => {
  const h = await harness({ wide: true }), interval = cp('one'); h.observer.bind(interval)
  expect(h.observer.monitoring().wideWatch).toBe(true)
  const second = path.join(base, 'drive-B'); fs.mkdirSync(second)
  h.roots([h.root, second]); await h.observer.refresh()
  expect(h.observer.monitoring().roots).toEqual([h.root, second])
  const file = path.join(second, 'new.glb'); fs.writeFileSync(file, 'new'); h.listeners.get(second)!('rename', 'new.glb')
  h.roots([second]); await h.observer.refresh()
  expect(h.close).toHaveBeenCalledWith(h.root)
  await h.observer.drain(); expect(interval.outputs[0].path).toBe(file)
  expect(interval.issues.join()).toContain('sona erdi')
})

it('TÜM DİSK İZLEME KAPALIYKEN disk kökü izlenmez: yalnız akışın verdiği klasör', async () => {
  const h = await harness()
  // discover burada tek bir "disk" (base) bildirir; kapalı olduğu için KULLANILMAMALI.
  expect(h.observer.monitoring().wideWatch).toBe(false)
  expect(h.observer.monitoring().source).toBe('akis')
  expect(h.listeners.has(base)).toBe(false)
  expect(h.observer.monitoring().roots).toEqual([h.root])
})

it('kök değişince eski izleyici kapanır, yenisi açılır (izleme akışı izler)', async () => {
  const h = await harness(), cp1 = cp('one')
  h.observer.bind(cp1)
  const other = path.join(base, 'drive-B'); fs.mkdirSync(other)
  await h.observer.setFlowRoots([other])
  expect(h.close).toHaveBeenCalledWith(h.root)
  expect(h.listeners.has(h.root)).toBe(false)
  expect(h.observer.monitoring().roots).toEqual([other])
})

it('henüz var olmayan klasör: en yakın var olan üst klasör izlenir ve "bekliyor" olarak gösterilir', async () => {
  const h = await harness()
  const yok = path.join(h.root, 'ileride', 'olacak')
  await h.observer.setFlowRoots([yok])
  // İzleme en yakın var olan klasöre bağlanır (h.root), yol "henüz yok" listesinde durur.
  expect(h.observer.monitoring().roots).toEqual([h.root])
  expect(h.observer.monitoring().pendingRoots).toContain(yok)
})

it('hiç kök yoksa başlatma HATA ATMAZ (otomasyon durmaz)', async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-output-watch-'))
  observer = new CheckpointOutputWatch({ discover: async () => [] })
  await expect(observer.start()).resolves.toBeUndefined()
  await observer.setFlowRoots([])
  expect(observer.monitoring().active).toBe(true)
  expect(observer.monitoring().roots).toEqual([])
  expect(observer.monitoring().source).toBe('yok')
  await expect(observer.drain()).resolves.toEqual([])
})

it('aynı dosyanın çok sayıda bildirimini aralık başına birleştirir (checkpoint sahipliği korunur)', async () => {
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

it('yol bildirmeyen ya da yalnız kökü bildiren olay için tüm diski GEZMEZ', async () => {
  const h = await harness(), interval = cp('one'); h.observer.bind(interval)
  const readdir = vi.spyOn(fs.promises, 'readdir')
  h.listeners.get(h.root)!('rename', null); h.listeners.get(h.root)!('rename', '.')
  await h.observer.drain()
  expect(interval.outputs).toHaveLength(0); expect(interval.issues).toHaveLength(2)
  expect(readdir).not.toHaveBeenCalled()
})

it('kalıcı kayıt hatasından sonra kirli checkpoint yeniden denenir', async () => {
  const h = await harness(), interval = cp('one'); h.observer.bind(interval)
  fs.writeFileSync(path.join(h.root, 'one.txt'), 'one'); h.listeners.get(h.root)!('change', 'one.txt')
  const dirty = await h.observer.drain(); expect(dirty).toEqual([interval])
  h.observer.retryPersist(dirty)
  expect(await h.observer.drain()).toEqual([interval])
  expect(await h.observer.drain()).toEqual([])
})
