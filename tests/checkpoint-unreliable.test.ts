import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Checkpoints, UNRELIABLE_NAME } from '../electron/checkpoints'
import type { CheckpointDetail } from '../electron/checkpoint-types'

const id = '00000000-0000-4000-8000-000000000001'
const detail: CheckpointDetail = {
  id, runId: 'run', ordinal: 1, canvasId: 'c', canvasName: 'Tuval', label: 'tur 1',
  at: 1, outputCount: 0, status: 'closed', roots: [], issues: [], outputs: [],
}

describe('checkpoint kesinti işareti', () => {
  it('yazım kesintisi panelde "devam güvenilir değil" olarak görünür', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-unreliable-'))
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(detail))
    fs.writeFileSync(path.join(dir, UNRELIABLE_NAME), JSON.stringify({ at: Date.now(), reason: 'EPERM: rename' }))
    const store = new Checkpoints(dir, () => {}, { discover: async () => [] })
    const cp = await store.detail(id)
    expect(cp.issues[0]).toContain('kesintiye uğradı')
    expect(cp.issues[0]).toContain('EPERM')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('yeni koşu başlarken eski işaret temizlenir', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-unreliable-'))
    fs.writeFileSync(path.join(dir, UNRELIABLE_NAME), JSON.stringify({ at: Date.now(), reason: 'eski' }))
    const store = new Checkpoints(dir, () => {}, { discover: async () => [] })
    await store.begin('run-2', 'c', 'Tuval')
    expect(fs.existsSync(path.join(dir, UNRELIABLE_NAME))).toBe(false)
    await store.finish('stopped')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
