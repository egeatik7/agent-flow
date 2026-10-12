import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { LibraryStorage } from '../electron/library-storage'
import { initializeLibraryDatabase } from '../electron/library-database'
import { withLibraryLock } from '../electron/library-lock'

const dirs: string[] = []
const claims: LibraryStorage[] = []
const empty = () => ({ folders: [], canvases: [], automations: [] })
const lockPath = (storage: LibraryStorage) => path.join(storage.directory, '.nubbo-library.lock')
const make = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-lock-test-')); dirs.push(d)
  const storage = new LibraryStorage(d); storage.load(empty()); claims.push(storage); return storage
}
const old = (file: string, raw: string) => { fs.writeFileSync(file, raw); const at = new Date(Date.now() - 120_000); fs.utimesSync(file, at, at) }
const dead = 2_000_000_001
const noProcess = () => Object.assign(Error('no process'), { code: 'ESRCH' })
beforeAll(initializeLibraryDatabase)
afterEach(() => {
  vi.restoreAllMocks()
  for (const storage of claims.splice(0)) storage.release()
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

it.each(['', '{', '{}', 'null', '[]', '{"format":"nubbo-lock","pid":0}'])('repairs an old malformed lock %j without changing the catalog', raw => {
  const storage = make(), before = fs.readFileSync(storage.file), file = lockPath(storage)
  old(file, raw)
  storage.claim()
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ format: 'nubbo-lock', pid: process.pid })
  storage.save(empty())
  expect(fs.readFileSync(storage.file)).toEqual(before)
  storage.release(); expect(fs.existsSync(file)).toBe(false)
})
it('keeps a fresh malformed lock and gives a recoverable message instead of SyntaxError', () => {
  const storage = make(), file = lockPath(storage); fs.writeFileSync(file, '')
  expect(() => storage.claim()).toThrow(/bir dakika/i)
  expect(() => storage.save(empty())).toThrow(/bir dakika/i)
  expect(fs.readFileSync(file, 'utf8')).toBe('')
})
it('does not repair even an old malformed record when it identifies a live PID', () => {
  const storage = make(), file = lockPath(storage), raw = JSON.stringify({ format: 'broken', pid: process.pid })
  old(file, raw)
  expect(() => storage.claim()).toThrow(/başka bir Nubbo/)
  expect(fs.readFileSync(file, 'utf8')).toBe(raw)
})
it.each(['write', 'fsync', 'link'])('a failed lock %s leaves no partial lock or temp file and permits a retry', failure => {
  const storage = make(), file = lockPath(storage), before = fs.readFileSync(storage.file)
  const method = failure === 'write' ? 'writeFileSync' : failure === 'fsync' ? 'fsyncSync' : 'linkSync'
  const spy = vi.spyOn(fs, method).mockImplementationOnce(() => { throw Error(`injected ${failure} failure`) })
  expect(() => storage.claim()).toThrow(`injected ${failure} failure`)
  spy.mockRestore()
  expect(fs.existsSync(file)).toBe(false)
  expect(fs.readdirSync(storage.directory).some(name => name.endsWith('.tmp'))).toBe(false)
  expect(fs.readFileSync(storage.file)).toEqual(before)
  storage.claim(); storage.save(empty())
})
it('publishes the complete owner record before the lock name becomes visible', () => {
  const storage = make(), file = lockPath(storage), link = fs.linkSync
  const spy = vi.spyOn(fs, 'linkSync').mockImplementation((from, to) => {
    if (String(to) === file) {
      expect(fs.existsSync(file)).toBe(false)
      expect(JSON.parse(fs.readFileSync(from, 'utf8'))).toMatchObject({ format: 'nubbo-lock', pid: process.pid, nonce: expect.any(String) })
    }
    link(from, to)
  })
  storage.claim(); expect(spy).toHaveBeenCalled(); spy.mockRestore()
})
it('a temp-name cleanup failure after publication does not orphan the live claim', () => {
  const storage = make(), unlink = fs.unlinkSync
  const spy = vi.spyOn(fs, 'unlinkSync').mockImplementation(file => {
    if (String(file).endsWith('.tmp')) throw Error('temp cleanup failed')
    unlink(file)
  })
  storage.claim(); storage.save(empty()); storage.release()
  expect(fs.existsSync(lockPath(storage))).toBe(false)
  spy.mockRestore()
})
it('an unsupported filesystem fails without creating a partial lock or changing the catalog', () => {
  const storage = make(), before = fs.readFileSync(storage.file)
  vi.spyOn(fs, 'linkSync').mockImplementation(() => { throw Object.assign(Error('unsupported'), { code: 'ENOTSUP' }) })
  expect(() => storage.claim()).toThrow(/başka bir klasör seç/)
  expect(fs.existsSync(lockPath(storage))).toBe(false)
  expect(fs.readdirSync(storage.directory).some(name => name.endsWith('.tmp'))).toBe(false)
  expect(fs.readFileSync(storage.file)).toEqual(before)
})
it('directory-specific claims remain usable when a second catalog is claimed and released', () => {
  const first = make(), second = make()
  first.claim(); second.claim()
  first.save(empty()); second.save(empty())
  second.release(); first.save(empty())
  expect(fs.existsSync(lockPath(first))).toBe(true)
})
it('two instances sharing one catalog retain the claim until the last reference releases it', () => {
  const first = make(), second = new LibraryStorage(first.directory); claims.push(second); second.load()
  first.claim(); second.claim(); first.release()
  expect(fs.existsSync(lockPath(second))).toBe(true)
  second.save(empty()); second.release()
  expect(fs.existsSync(lockPath(second))).toBe(false)
})
it('never deletes a new live owner after an old-owner liveness check races with another claim', () => {
  const loser = make(), winner = new LibraryStorage(loser.directory); claims.push(winner)
  winner.load()
  old(lockPath(loser), JSON.stringify({ format: 'nubbo-lock', pid: dead, nonce: 'old' }))
  const kill = process.kill.bind(process); let once = true
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (pid === dead) {
      if (once) { once = false; winner.claim() }
      throw noProcess()
    }
    return kill(pid, signal)
  })
  expect(() => loser.claim()).toThrow(/başka bir Nubbo/)
  winner.save(empty())
  expect(JSON.parse(fs.readFileSync(lockPath(winner), 'utf8')).pid).toBe(process.pid)
})
it('can recover after a recovery-ticket owner dies, without deleting its ticket', () => {
  const storage = make(), file = lockPath(storage), raw = JSON.stringify({ format: 'nubbo-lock', pid: dead, nonce: 'old' })
  old(file, raw)
  const ticket = `${file}.recover-${createHash('sha256').update(raw).digest('hex')}`
  const ticketRaw = JSON.stringify({ format: 'nubbo-lock', pid: dead, nonce: 'crashed-recovery' }); old(ticket, ticketRaw)
  const kill = process.kill.bind(process)
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => { if (pid === dead) throw noProcess(); return kill(pid, signal) })
  storage.claim(); storage.save(empty())
  expect(fs.readFileSync(ticket, 'utf8')).toBe(ticketRaw)
  expect(fs.readdirSync(storage.directory).filter(name => name.includes('.recover-'))).toHaveLength(1)
})
it('rejoins the root election if a dead recovery ticket was removed during its liveness check', () => {
  const storage = make(), file = lockPath(storage), raw = JSON.stringify({ format: 'nubbo-lock', pid: dead, nonce: 'old' })
  old(file, raw)
  const ticket = `${file}.recover-${createHash('sha256').update(raw).digest('hex')}`
  old(ticket, JSON.stringify({ format: 'nubbo-lock', pid: dead, nonce: 'former-recovery' }))
  const kill = process.kill.bind(process); let checks = 0
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (pid === dead) { if (++checks === 2) fs.unlinkSync(ticket); throw noProcess() }
    return kill(pid, signal)
  })
  storage.claim(); storage.save(empty())
  expect(fs.existsSync(ticket)).toBe(false)
})
it('does not use a descendant recovery ticket when a new live root owner replaced its parent', () => {
  const storage = make(), file = lockPath(storage), raw = JSON.stringify({ format: 'nubbo-lock', pid: dead, nonce: 'old' })
  old(file, raw)
  const ticket = `${file}.recover-${createHash('sha256').update(raw).digest('hex')}`
  old(ticket, JSON.stringify({ format: 'nubbo-lock', pid: dead, nonce: 'former-recovery' }))
  const replacement = JSON.stringify({ format: 'nubbo-lock', pid: process.pid, nonce: 'new-root' })
  const kill = process.kill.bind(process); let checks = 0
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (pid === dead) { if (++checks === 2) fs.writeFileSync(ticket, replacement); throw noProcess() }
    return kill(pid, signal)
  })
  expect(() => storage.claim()).toThrow(/başka bir Nubbo/)
  expect(fs.readFileSync(file, 'utf8')).toBe(raw)
  expect(fs.readFileSync(ticket, 'utf8')).toBe(replacement)
})
it('detects ownership loss and leaves the replacement owner and catalog untouched on release', () => {
  const storage = make(), file = lockPath(storage), before = fs.readFileSync(storage.file)
  storage.claim()
  const other = JSON.stringify({ format: 'nubbo-lock', pid: process.pid, nonce: 'replacement' }); fs.writeFileSync(file, other)
  expect(() => storage.save(empty())).toThrow(/sahipliği kayboldu/)
  expect(() => storage.claim()).toThrow(/sahipliği kayboldu/)
  storage.release()
  expect(fs.readFileSync(file, 'utf8')).toBe(other)
  expect(fs.readFileSync(storage.file)).toEqual(before)
})
it('treats uncertain process liveness as busy instead of stealing the lock', () => {
  const storage = make(), file = lockPath(storage)
  old(file, JSON.stringify({ format: 'nubbo-lock', pid: dead, nonce: 'permission-denied' }))
  vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(Error('denied'), { code: 'EPERM' }) })
  expect(() => storage.claim()).toThrow(/başka bir Nubbo/)
})
it('releases a temporary claim even when the protected operation throws', () => {
  const storage = make()
  expect(() => withLibraryLock(storage.directory, () => { throw Error('operation failed') })).toThrow('operation failed')
  expect(fs.existsSync(lockPath(storage))).toBe(false)
  storage.claim()
})
