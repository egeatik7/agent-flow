import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pruneEvidence, EVIDENCE_KEEP } from '../electron/send-log'

const dirs: string[] = []
function tempDir() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-evidence-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

describe('tanılama kanıtı saklama', () => {
  it('en yeni klasörleri tutar, eskileri siler', () => {
    const root = tempDir()
    const now = Date.now()
    for (let n = 1; n <= 5; n++) {
      const dir = path.join(root, `istek-${n}`)
      fs.mkdirSync(dir)
      fs.writeFileSync(path.join(dir, 'ozet.txt'), 'x')
      const at = new Date(now - (10 - n) * 60_000)
      fs.utimesSync(dir, at, at)
    }
    expect(pruneEvidence(root, now, 2)).toBe(3)
    const left = fs.readdirSync(root).sort()
    expect(left).toEqual(['istek-4', 'istek-5'])
  })

  it('yaş sınırını aşan kayıt silinir', () => {
    const root = tempDir()
    const now = Date.now()
    const old = path.join(root, 'eski'); fs.mkdirSync(old)
    const young = path.join(root, 'yeni'); fs.mkdirSync(young)
    const long = new Date(now - 30 * 24 * 60 * 60 * 1000)
    fs.utimesSync(old, long, long)
    expect(pruneEvidence(root, now, 100)).toBe(1)
    expect(fs.existsSync(old)).toBe(false)
    expect(fs.existsSync(young)).toBe(true)
    expect(EVIDENCE_KEEP).toBeGreaterThan(0)
  })

  it('klasör yoksa hata fırlatmaz; dosyalara dokunmaz', () => {
    expect(pruneEvidence(path.join(tempDir(), 'yok'), Date.now(), 1)).toBe(0)
    const root = tempDir(); fs.writeFileSync(path.join(root, 'not.txt'), 'x')
    expect(pruneEvidence(root, Date.now(), 0)).toBe(0)
    expect(fs.existsSync(path.join(root, 'not.txt'))).toBe(true)
  })
})
