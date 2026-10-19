import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Checkpoints } from '../electron/checkpoints'
import { createNode, type AgentGraph } from '../electron/graph-types'
import type { CheckpointSnapshot } from '../electron/checkpoint-types'
let base: string, root: string, other: string, store: Checkpoints
let roots: string[], callbacks: Map<string, (event: string, filename: string | null) => void>
let watchers: Map<string, EventEmitter & { close: () => void }>
const event = (p: string, name = 'change', watchRoot = root) => callbacks.get(watchRoot)?.(name, path.relative(watchRoot, p))

/**
 * 1.9.160 — KAPSAM AKIŞTAN GELİR.
 * İzlenecek kökler checkpoint'in grafından/imlecinden hesaplanır; tüm disk izleme isteğe bağlıdır.
 * Kök bulunamaması koşuyu DURDURMAZ (eskiden durduruyordu).
 */
const baglam = (...yollar: string[]): CheckpointSnapshot => {
  const nodes = [
    Object.assign(createNode('loop', 0, 0), { title: 'Grup', folder: yollar[0] ?? root }),
    ...yollar.map(y => Object.assign(createNode('type', 0, 0), { text: y })),
  ]
  return { graph: { nodes, edges: [] } as AgentGraph, cursor: { packagePath: [], loops: [], scopes: [] } }
}
const bos: CheckpointSnapshot = { graph: { nodes: [], edges: [] }, cursor: { packagePath: [], loops: [], scopes: [] } }

function makeStore(exclude: string[] = [], wide = false) {
  return new Checkpoints(path.join(base, 'history'), () => {}, {
    discover: async () => roots,
    wide: () => wide,
    exclude,
    watch: ((folder: string, _options: unknown, listener: (event: string, filename: string | null) => void) => {
      const watcher = Object.assign(new EventEmitter(), { close: vi.fn(() => callbacks.delete(folder)) })
      callbacks.set(folder, listener); watchers.set(folder, watcher)
      return watcher
    }) as unknown as typeof fs.watch,
  })
}
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-auto-checkpoint-')); root = path.join(base, 'drive-C'); other = path.join(base, 'drive-D')
  fs.mkdirSync(root); fs.mkdirSync(other)
  roots = [root, other]; callbacks = new Map(); watchers = new Map(); store = makeStore()
})
afterEach(async () => { await store.finish('stopped'); fs.rmSync(base, { recursive: true, force: true }); vi.restoreAllMocks() })

describe('kapsam: akıştaki klasörler izlenir', () => {
  it('akışın bildirdiği kökleri izler; tüm disk envanteri/taraması yapmaz', async () => {
    fs.writeFileSync(path.join(root, 'untouched.blend'), 'old')
    const readdir = vi.spyOn(fs.promises, 'readdir')
    await store.begin('run', 'canvas', 'Blender'); const id = await store.mark('start', baglam(root, other))
    // discover iki "disk" bildirse de wide KAPALI: yalnız akış kökleri izlenir.
    expect(store.monitoring().roots).toEqual([root, other])
    expect(store.monitoring().wideWatch).toBe(false)
    expect(readdir).not.toHaveBeenCalled() // baseline tarama yok
    const file = path.join(other, 'arbitrary.glb'); fs.writeFileSync(file, 'glb'); event(file, 'rename', other)
    await store.finish('completed')
    expect((await store.detail(id)).outputs).toEqual([expect.objectContaining({ path: file, change: 'observed', present: true })])
  })

  it('izleme kökü değişince eski izleyici kapanır (her checkpoint kendi aralığını korur)', async () => {
    await store.begin('run', 'canvas', 'A'); const a = await store.mark('start', baglam(root))
    expect(callbacks.has(root)).toBe(true)
    const b = await store.mark('next', baglam(other))
    expect(callbacks.has(root)).toBe(false)
    expect(callbacks.has(other)).toBe(true)
    expect((await store.detail(a)).outputs).toEqual([])
    expect(b).toBeTruthy()
  })

  it('TÜM DİSK İZLEME açıksa akışta yazmayan klasörler de listelenir (opt-in)', async () => {
    store = makeStore([], true)
    await store.begin('run', 'canvas', 'A'); const id = await store.mark('start', baglam(root))
    expect(store.monitoring().wideWatch).toBe(true)
    expect(store.monitoring().source).toBe('disk')
    const file = path.join(other, 'baska-program.glb'); fs.writeFileSync(file, 'x'); event(file, 'rename', other)
    await store.finish('completed')
    expect((await store.detail(id)).outputs.map(o => o.path)).toContain(file)
  })

  it('olayları ALINDIĞI ANDA checkpointe bağlar (gecikmiş stat sonraki aralığa sızmaz)', async () => {
    await store.begin('run', 'canvas', 'Blender'); const a = await store.mark('first', baglam(root, other))
    const file = path.join(root, 'first.blend'); fs.writeFileSync(file, 'A'); event(file, 'rename')
    const b = await store.mark('second', baglam(root, other))
    fs.writeFileSync(file, 'changed file'); event(file)
    await store.finish('failed')
    const first = await store.detail(a), second = await store.detail(b)
    expect(first.outputs.map(o => o.path)).toEqual([file]); expect(second.outputs.map(o => o.path)).toEqual([file])
    expect(first.endedAt).toBe(second.at); expect(second.status).toBe('failed')
    fs.unlinkSync(file); expect((await store.detail(a)).outputs[0].present).toBe(false)
    expect((await new Checkpoints(path.join(base, 'history')).list()).map(cp => cp.id)).toEqual([a, b])
  })

  it('boşta geçen süreyi eklemez; izleyicileri kapatır ve yeni koşuyu bağlar', async () => {
    await store.begin('run', 'canvas', 'A'); const a = await store.mark('start', baglam(root, other))
    await store.finish('completed')
    expect([...watchers.values()].every(w => (w.close as any).mock.calls.length === 1)).toBe(true)
    fs.writeFileSync(path.join(root, 'idle.txt'), 'idle')
    await store.begin('retry', 'canvas', 'Retry', a); const b = await store.mark('start', baglam(root, other))
    const output = path.join(other, 'retry.blend'); fs.writeFileSync(output, 'retry'); event(output, 'rename', other)
    await store.finish('stopped')
    expect((await store.detail(a)).outputs).toEqual([])
    expect((await store.detail(b)).outputs.map(o => o.path)).toEqual([output]); expect((await store.detail(b)).parentId).toBe(a)
  })

  it('yeniden adlandırılmış dolu klasörün çocuklarını gezer, symlink döngüsüne girmez', async () => {
    await store.begin('run', 'canvas', 'A'); const id = await store.mark('start', baglam(root, other))
    const batch = path.join(root, 'batch'); fs.mkdirSync(batch); const child = path.join(batch, 'one.glb'); fs.writeFileSync(child, 'glb')
    try { fs.symlinkSync(batch, path.join(batch, 'cycle')) } catch (e) { if (process.platform !== 'win32' || (e as NodeJS.ErrnoException).code !== 'EPERM') throw e }
    event(batch, 'rename'); await store.finish('completed')
    const outputs = (await store.detail(id)).outputs.map(o => o.path)
    expect(outputs).toContain(batch); expect(outputs).toContain(child); expect(outputs.length).toBeLessThan(5)
  })

  it('kendi kaydını, hariç tutulan sistem klasörünü, geri dönüşüm kutusunu ve kök dışı olayı kaydetmez', async () => {
    roots = [base]
    store = makeStore([path.join(root, 'Windows')]); await store.begin('run', 'canvas', 'A'); const id = await store.mark('start', baglam(base))
    for (const p of [path.join(base, 'history', 'own.json'), path.join(root, 'Windows', 'system.log'), path.join(root, '$Recycle.Bin', 'deleted'), path.join(base, '..', 'outside.txt')]) event(p, 'rename', base)
    await store.finish('completed'); expect((await store.detail(id)).outputs).toEqual([])
  })

  it('eksik dosya adı/izleyici hatalarını "başarılı boş sonuç" gibi sunmaz', async () => {
    await store.begin('run', 'canvas', 'A'); const id = await store.mark('start', baglam(root, other))
    callbacks.get(root)!('change', null)
    watchers.get(other)!.emit('error', new Error('volume disconnected'))
    await store.finish('failed')
    const detail = await store.detail(id)
    expect(detail.issues.join()).toContain('yolunu bildirmedi'); expect(detail.issues.join()).toContain('volume disconnected')
  })

  it('hiçbir kök yoksa koşu DURMAZ: izleme boş kalır ve durum açıkça yazılır', async () => {
    await expect(store.begin('run', 'canvas', 'A')).resolves.toBeUndefined()
    const id = await store.mark('start', bos)
    expect(store.monitoring().roots).toEqual([])
    expect(store.monitoring().source).toBe('yok')
    expect((await store.detail(id)).outputs).toEqual([])
    // Geçersiz kimlik yine reddedilir.
    await expect(store.snapshot('../bad')).rejects.toThrow('Geçersiz')
  })

  it('kesilmiş koşuyu algılar ve metadata okunmadan kaybolan yolu kaydeder', async () => {
    await store.begin('run', 'canvas', 'A'); const id = await store.mark('start', baglam(root, other))
    event(path.join(root, 'gone.blend'), 'rename')
    const b = await store.mark('next', baglam(root, other))
    expect((await store.detail(id)).outputs[0]).toMatchObject({ kind: 'unknown', present: false, change: 'observed' })
    expect((await new Checkpoints(path.join(base, 'history')).list()).find(cp => cp.id === b)?.status).toBe('interrupted')
  })
})

it('gerçek yerel dosya sistemi olaylarını akış kökünden alır (manuel klasör/baseline yok)', async () => {
  store = new Checkpoints(path.join(base, 'history'), () => {}, { discover: async () => [] })
  await store.begin('real', 'canvas', 'Native watch')
  const id = await store.mark('start', baglam(root))
  const folder = path.join(root, 'new-batch'); fs.mkdirSync(folder)
  const file = path.join(folder, 'one.blend'); fs.writeFileSync(file, 'blend')
  await expect.poll(async () => (await store.detail(id)).outputs.map(o => o.path), { timeout: 5000 }).toContain(file)
  await store.finish('completed')
  expect((await store.detail(id)).outputs).toContainEqual(expect.objectContaining({ path: file, present: true }))
})
