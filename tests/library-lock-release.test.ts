import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { claimLibraryLock, withLibraryLock } from '../electron/library-lock'

const dirs: string[] = []
function tempDir() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-lock-')); dirs.push(dir); return dir }
function lockPath(dir: string) { const file = path.join(fs.realpathSync(dir), '.nubbo-library.lock'); return process.platform === 'win32' ? file.toLowerCase() : file }
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

describe('kütüphane kilidi: kendi kaydını bırakabilmeli', () => {
  it('kendi PID’imizle kalmış eski kilit (çökme) oturumu kilitlemez', () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, '.nubbo-library.lock'), JSON.stringify({ format: 'nubbo-lock', pid: process.pid, nonce: 'eski-cokme' }))
    const lock = claimLibraryLock(dir)
    expect(() => lock.assertOwned()).not.toThrow()
    lock.release()
    expect(fs.existsSync(lockPath(dir))).toBe(false)
  })

  it('withLibraryLock kendi eski kaydını devralır', () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, '.nubbo-library.lock'), JSON.stringify({ format: 'nubbo-lock', pid: process.pid, nonce: 'eski' }))
    expect(withLibraryLock(dir, () => 42)).toBe(42)
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.nubbo-library.lock'))).toEqual([])
  })

  it('unlink EPERM alırsa sınırlı denenir; başarılı bırakma dosyayı siler', () => {
    const dir = tempDir()
    const real = fs.unlinkSync.bind(fs)
    let calls = 0
    vi.spyOn(fs, 'unlinkSync').mockImplementation(((target: fs.PathLike) => {
      if (++calls <= 3) throw Object.assign(new Error('busy'), { code: 'EPERM' })
      return real(target)
    }) as typeof fs.unlinkSync)
    const lock = claimLibraryLock(dir)
    expect(() => lock.release()).not.toThrow()
    expect(calls).toBeGreaterThan(3)
    expect(fs.existsSync(lockPath(dir))).toBe(false)
  })

  it('bırakma kalıcı olarak başarısız olsa da hata fırlatmaz; sonraki sahiplenme kendi kaydını kullanır', () => {
    const dir = tempDir()
    const lock = claimLibraryLock(dir)
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }) })
    expect(() => lock.release()).not.toThrow()
    expect(fs.existsSync(lockPath(dir))).toBe(true)
    vi.restoreAllMocks()
    const again = claimLibraryLock(dir)
    expect(() => again.assertOwned()).not.toThrow()
    again.release()
    expect(fs.existsSync(lockPath(dir))).toBe(false)
  })
})
