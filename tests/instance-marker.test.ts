import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clearInstanceMarker, instanceMarkerAlive, instanceMarkerPath, writeInstanceMarker } from '../electron/instance-marker'

const dirs: string[] = []
function tempDir() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-marker-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

describe('çalışan örnek işareti', () => {
  it('yazılır, canlı okunur, silinir', () => {
    const dir = tempDir()
    writeInstanceMarker(dir, process.pid)
    expect(fs.readFileSync(instanceMarkerPath(dir), 'utf8')).toBe(String(process.pid))
    expect(instanceMarkerAlive(dir)).toBe(true)
    clearInstanceMarker(dir)
    expect(fs.existsSync(instanceMarkerPath(dir))).toBe(false)
    expect(instanceMarkerAlive(dir)).toBe(false)
  })

  it('ölü PID canlı sayılmaz (yarım kalmış klasör temizlenebilir)', () => {
    const dir = tempDir()
    writeInstanceMarker(dir, 999_999)
    expect(instanceMarkerAlive(dir, (pid) => pid === process.pid)).toBe(false)
  })

  it('bozuk işaret "canlı" sayılmaz; salt-okunur klasör hata fırlatmaz', () => {
    const dir = tempDir()
    fs.writeFileSync(instanceMarkerPath(dir), 'abc')
    expect(instanceMarkerAlive(dir)).toBe(false)
    expect(() => writeInstanceMarker(path.join(dir, 'yok-boyle-klasor'))).not.toThrow()
  })
})
