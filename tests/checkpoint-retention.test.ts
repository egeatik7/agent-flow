import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Checkpoints, pruneCheckpoints, renameWithRetry, CHECKPOINT_KEEP } from '../electron/checkpoints'
import type { CheckpointDetail } from '../electron/checkpoint-types'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const detail = (n: number, at = n): CheckpointDetail => ({
  id: id(n), runId: 'run', ordinal: n, canvasId: 'canvas', canvasName: 'Tuval', label: `adım ${n}`,
  at, outputCount: 0, status: 'closed', roots: [], issues: [], outputs: [],
})

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-checkpoint-')) }

describe('checkpoint saklama ve dayanıklılık', () => {
  it('en yeni kayıtları tutar, eski çiftleri ve bayat .tmp artıklarını siler', async () => {
    const dir = tempDir()
    const now = Date.now()
    for (let n = 1; n <= 5; n++) {
      const at = new Date(now - (10 - n) * 60_000)
      fs.writeFileSync(path.join(dir, `${id(n)}.json`), JSON.stringify(detail(n)))
      fs.writeFileSync(path.join(dir, `${id(n)}.snapshot.json`), JSON.stringify({ graph: { nodes: [], edges: [] }, cursor: { packagePath: [], loops: [], scopes: [] } }))
      fs.utimesSync(path.join(dir, `${id(n)}.json`), at, at)
      fs.utimesSync(path.join(dir, `${id(n)}.snapshot.json`), at, at)
    }
    // Yarım kalmış yazım: yalnız .tmp, bir günden eski.
    const orphan = path.join(dir, `${id(9)}.json.tmp`)
    fs.writeFileSync(orphan, '{}')
    const old = new Date(now - 2 * 24 * 60 * 60 * 1000)
    fs.utimesSync(orphan, old, old)

    const result = await pruneCheckpoints(dir, now, 2)

    expect(result.removed).toBeGreaterThanOrEqual(7)
    expect(fs.existsSync(path.join(dir, `${id(5)}.json`))).toBe(true)
    expect(fs.existsSync(path.join(dir, `${id(4)}.json`))).toBe(true)
    expect(fs.existsSync(path.join(dir, `${id(3)}.json`))).toBe(false)
    expect(fs.existsSync(path.join(dir, `${id(3)}.snapshot.json`))).toBe(false)
    expect(fs.existsSync(orphan)).toBe(false)
    // Varsayılan sınır bir sayıdır; gelecekte sınırsıza dönülmesin.
    expect(CHECKPOINT_KEEP).toBeGreaterThan(0)
  })

  it('budama boş/olmayan klasörde hata fırlatmaz', async () => {
    await expect(pruneCheckpoints(path.join(tempDir(), 'yok'), Date.now(), 5)).resolves.toEqual({ removed: 0 })
  })

  it('rename EPERM/EBUSY alırsa sınırlı sayıda yeniden dener', async () => {
    let calls = 0
    const flaky = { platform: 'win32', pause: async () => {}, rename: async () => { calls++; if (calls < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' }) } }
    await renameWithRetry('a', 'b', flaky)
    expect(calls).toBe(3)

    let always = 0
    const broken = { platform: 'win32', pause: async () => {}, rename: async () => { always++; throw Object.assign(new Error('denied'), { code: 'EPERM' }) } }
    await expect(renameWithRetry('a', 'b', broken)).rejects.toThrow('denied')
    expect(always).toBe(12)
  })

  it('rename başka bir kodda hemen yüzeye çıkar (retry yok)', async () => {
    let calls = 0
    const missing = { platform: 'win32', pause: async () => {}, rename: async () => { calls++; throw Object.assign(new Error('yok'), { code: 'ENOENT' }) } }
    await expect(renameWithRetry('a', 'b', missing)).rejects.toThrow('yok')
    expect(calls).toBe(1)
  })

  it('bozuk ya da kilitli tek dosya listeyi düşürmez; diğer kayıtlar görünür', async () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, `${id(1)}.json`), JSON.stringify(detail(1)))
    fs.writeFileSync(path.join(dir, `${id(2)}.json`), '{"id": "yarim')
    const warnings: string[] = []
    const store = new Checkpoints(dir, (message) => warnings.push(message), { discover: async () => [] })
    const rows = await store.list()
    expect(rows.map((row) => row.id)).toEqual([id(1)])
    expect(warnings.filter((message) => message.includes('Checkpoint okunamadı')).length).toBe(1)
    await expect(store.detail(id(2))).rejects.toThrow(/Checkpoint dosyası okunamadı/)
  })
})

describe('��kt� dosyalar� (NDJSON) saklama', () => {
  it('budama .outputs.jsonl dosyas�n� da siler; tutulan checkpoint ��kt�s� kal�r', async () => {
    const fs = await import('node:fs')
    const dir = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'nubbo-ckpt-out-'))
    const now = Date.now()
    for (const n of [1, 2]) {
      fs.writeFileSync(require('node:path').join(dir, id(n) + '.json'), JSON.stringify(detail(n)))
      fs.writeFileSync(require('node:path').join(dir, id(n) + '.outputs.jsonl'), '{"path":"a"}\n')
      const at = new Date(now - (3 - n) * 60_000)
      fs.utimesSync(require('node:path').join(dir, id(n) + '.json'), at, at)
    }
    await pruneCheckpoints(dir, now, 1)
    expect(fs.existsSync(require('node:path').join(dir, id(2) + '.outputs.jsonl'))).toBe(true)
    expect(fs.existsSync(require('node:path').join(dir, id(1) + '.outputs.jsonl'))).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
