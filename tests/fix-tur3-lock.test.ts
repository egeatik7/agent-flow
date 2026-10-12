import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { LibraryStorage } from '../electron/library-storage'
import { initializeLibraryDatabase } from '../electron/library-database'
import { claimLibraryLock, withLibraryLock } from '../electron/library-lock'
import type { CanvasLibrary } from '../electron/graph-types'

const dirs: string[] = []
const claims: LibraryStorage[] = []
const lib = (folders: NonNullable<CanvasLibrary['folders']>): CanvasLibrary => ({ folders, canvases: [], automations: [] })
const empty = (): CanvasLibrary => lib([])
const oneFolder = (): CanvasLibrary => lib([{ id: 'fix-tur3', name: 'Fix Tur 3', section: 'canvas' }])
const folderIds = (library: CanvasLibrary) => (library.folders ?? []).map(folder => folder.id)
const lockPath = (directory: string) => path.join(directory, '.nubbo-library.lock')
const foreign = (nonce: string) => JSON.stringify({ format: 'nubbo-lock', pid: process.pid, nonce })
const make = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-lock-fix3-')); dirs.push(d)
  const storage = new LibraryStorage(d); storage.load(empty()); claims.push(storage); return storage
}
const bare = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-lock-fix3-')); dirs.push(d); return d }
beforeAll(initializeLibraryDatabase)
afterEach(() => {
  for (const storage of claims.splice(0)) storage.release()
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

it('withLibraryLock re-owns the directory after the lock file is deleted from outside', () => {
  const directory = bare(), file = lockPath(directory)
  const handle = claimLibraryLock(directory)
  handle.assertOwned()
  fs.unlinkSync(file)
  expect(withLibraryLock(directory, () => 'written')).toBe('written')
  expect(fs.existsSync(file)).toBe(true)
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ format: 'nubbo-lock', pid: process.pid })
  expect(withLibraryLock(directory, () => 'again')).toBe('again')
  handle.release()
})

it('withLibraryLock re-owns the directory after the lock file is renamed away', () => {
  const directory = bare(), file = lockPath(directory)
  claimLibraryLock(directory)
  fs.renameSync(file, `${file}.moved`)
  expect(withLibraryLock(directory, () => 42)).toBe(42)
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ format: 'nubbo-lock', pid: process.pid })
})

it('save() re-owns the directory and keeps writing after the lock file is deleted', () => {
  const storage = make(), file = lockPath(storage.directory)
  storage.claim()
  fs.unlinkSync(file)
  storage.save(oneFolder())
  expect(fs.existsSync(file)).toBe(true)
  const reader = new LibraryStorage(storage.directory)
  expect(folderIds(reader.load())).toContain('fix-tur3')
  storage.load()
  storage.save(empty())
})

it('claim() re-owns the directory and save() keeps working afterwards', () => {
  const storage = make(), file = lockPath(storage.directory)
  storage.claim()
  fs.unlinkSync(file)
  storage.claim()
  storage.save(oneFolder())
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ format: 'nubbo-lock', pid: process.pid })
  expect(folderIds(new LibraryStorage(storage.directory).load())).toContain('fix-tur3')
})

it('commitment lost mid-session still reports lost() from the handle and never writes', () => {
  const directory = bare(), file = lockPath(directory)
  const handle = claimLibraryLock(directory)
  const other = foreign('replacement')
  fs.writeFileSync(file, other)
  expect(() => handle.assertOwned()).toThrow(/sahipliği kayboldu/)
  handle.release()
  expect(fs.readFileSync(file, 'utf8')).toBe(other)
})

it('a live foreign lock answers busy() to withLibraryLock, claim() and save() and is never deleted', () => {
  const storage = make(), file = lockPath(storage.directory)
  storage.claim()
  const other = foreign('foreign-live')
  fs.writeFileSync(file, other)
  expect(() => withLibraryLock(storage.directory, () => 'nope')).toThrow(/başka bir Nubbo/)
  expect(() => storage.claim()).toThrow(/başka bir Nubbo/)
  expect(() => storage.save(oneFolder())).toThrow(/başka bir Nubbo/)
  storage.release()
  expect(fs.readFileSync(file, 'utf8')).toBe(other)
  expect(folderIds(new LibraryStorage(storage.directory).load())).toHaveLength(0)
})

it('a fresh claim is refused by a live foreign lock and leaves the file untouched', () => {
  const directory = bare(), file = lockPath(directory)
  const other = foreign('foreign-fresh')
  fs.writeFileSync(file, other)
  expect(() => claimLibraryLock(directory)).toThrow(/başka bir Nubbo/)
  expect(() => withLibraryLock(directory, () => 'nope')).toThrow(/başka bir Nubbo/)
  expect(fs.readFileSync(file, 'utf8')).toBe(other)
})

it('two handles keep the lock until the last release after a re-claim', () => {
  const first = make(), second = new LibraryStorage(first.directory); claims.push(second); second.load()
  const file = lockPath(first.directory)
  first.claim(); second.claim()
  fs.unlinkSync(file)
  first.claim()
  second.claim()
  expect(fs.existsSync(file)).toBe(true)
  first.load(); second.load()
  first.release()
  expect(fs.existsSync(file)).toBe(true)
  second.release()
  expect(fs.existsSync(file)).toBe(false)
})
