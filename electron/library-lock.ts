import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

type Owner = { format: 'nubbo-lock'; pid: number; nonce: string }
type Snapshot = { raw: Buffer; stat: fs.Stats }
type Held = { owner: Owner; refs: number }
export type LibraryLock = { assertOwned(): void; release(): void }
const held = new Map<string, Held>()
// Legacy versions can leave an empty file while writing. Do not repair a fresh
// malformed lock, or a malformed record that still identifies a live process.
const CORRUPT_GRACE_MS = 60_000
const busy = () => Error('Kütüphane şu anda başka bir Nubbo tarafından kullanılıyor. Tekrar dene.')
const lost = () => Error('Kütüphane kilidi değişti; kayıt sahipliği kayboldu. Mevcut dosyalar korunuyor.')
const code = (e: unknown) => (e as NodeJS.ErrnoException).code

function lockFile(directory: string): string {
  fs.mkdirSync(directory, { recursive: true })
  const canonical = path.join(fs.realpathSync(directory), '.nubbo-library.lock')
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}
function snapshot(file: string): Snapshot | undefined {
  let fd: number
  try { fd = fs.openSync(file, 'r') } catch (e) { if (code(e) === 'ENOENT') return; throw e }
  try { return { raw: fs.readFileSync(fd), stat: fs.fstatSync(fd) } } finally { fs.closeSync(fd) }
}
function parsed(s: Snapshot): Partial<Owner> | undefined {
  try { const value: unknown = JSON.parse(s.raw.toString('utf8')); return value && typeof value === 'object' ? value as Partial<Owner> : undefined } catch { return }
}
function ownerOf(s: Snapshot): Owner | undefined {
  const o = parsed(s)
  return o?.format === 'nubbo-lock' && Number.isInteger(o.pid) && o.pid! > 0 && typeof o.nonce === 'string' && !!o.nonce ? o as Owner : undefined
}
function live(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (e) { return code(e) !== 'ESRCH' }
}
function mayRecover(s: Snapshot): void {
  const o = parsed(s)
  // KENDİ PID'imiz canlı görünse de bizim olmayan bir kayıt (çökme/yarım kalmış bırakma) kilitli
  // kalmamalı: aynı süreçte ikinci bir sahip yoktur, `held` bunu zaten yönetir.
  if (Number.isInteger(o?.pid) && o!.pid! > 0 && o!.pid! !== process.pid && live(o!.pid!)) throw busy()
  if (!ownerOf(s) && Date.now() - s.stat.mtimeMs < CORRUPT_GRACE_MS) {
    throw Error('Kütüphane kilidi henüz yazılıyor olabilir. Bir dakika sonra tekrar dene; mevcut dosyalar korunuyor.')
  }
}
function same(a: Snapshot, b: Snapshot): boolean {
  return a.raw.equals(b.raw) && a.stat.dev === b.stat.dev && a.stat.ino === b.stat.ino && a.stat.mtimeMs === b.stat.mtimeMs
}

/** Publish a complete, fsynced record exclusively. rename would overwrite an owner. */
function publish(file: string, owner: Owner): void {
  const temp = path.join(path.dirname(file), `.nubbo-lock-${process.pid}-${randomUUID()}.tmp`)
  let fd: number | undefined
  let published = false
  try {
    fd = fs.openSync(temp, 'wx')
    fs.writeFileSync(fd, JSON.stringify(owner))
    fs.fsyncSync(fd)
    fs.closeSync(fd); fd = undefined
    // NTFS and local Unix filesystems publish this name atomically, with EEXIST
    // if another process won. Unsupported filesystems fail without unsafe fallback.
    try { fs.linkSync(temp, file) } catch (e) {
      if (['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV'].includes(code(e) ?? '')) {
        throw Error('Bu klasör güvenli kütüphane kilidini desteklemiyor. Yerel diskte başka bir klasör seç; mevcut dosyalar korunuyor.')
      }
      throw e
    }
    published = true
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    // Once ownership is visible, a cleanup error must not orphan our live lock
    // by telling the caller acquisition failed. A remaining temp name is harmless.
    try { fs.unlinkSync(temp) } catch (e) { if (code(e) !== 'ENOENT' && !published) throw e }
  }
}
function removeOwned(file: string, owner: Owner): boolean {
  const current = snapshot(file)
  if (!(current && ownerOf(current)?.nonce === owner.nonce && ownerOf(current)?.pid === owner.pid)) return false
  return unlinkRetrying(file)
}

/**
 * Windows'ta taze kilit dosyasını Defender/indeksleyici kısa süre tutabiliyor; unlink EPERM/EBUSY
 * veriyor. Sınırlı, artan beklemeli deneme. Başarısız olursa kilit dosyası BIRAKILMAZ: kendi
 * PID'imizle diskte kalan kayıt sonraki açılışta 'başka bir Nubbo kullanıyor' sanılıyordu.
 */
const UNLINK_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
function unlinkRetrying(file: string): boolean {
  for (let attempt = 1; attempt <= 12; attempt++) {
    try { fs.unlinkSync(file); return true } catch (e) {
      const c = code(e)
      if (c === 'ENOENT') return true
      if (process.platform !== 'win32' || !UNLINK_RETRY_CODES.has(c ?? '') || attempt === 12) return false
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(30 * 2 ** (attempt - 1), 400))
    }
  }
  return false
}

/**
 * Only one process may reclaim a particular stale generation. Recovery tickets
 * are complete exclusive files too. Never unlink another process's stale ticket:
 * elect one successor at a deterministic new name instead. This avoids moving
 * the original unlink/recreate race into a second "recovery lock".
 */
function recovering<T>(file: string, stale: Snapshot, fn: () => T): T {
  const root = `${file}.recover-${createHash('sha256').update(stale.raw).digest('hex')}`
  let ticket = root
  let parents: { file: string; snapshot: Snapshot }[] = []
  const owner: Owner = { format: 'nubbo-lock', pid: process.pid, nonce: randomUUID() }
  for (let depth = 0; depth < 32; depth++) {
    try {
      publish(ticket, owner)
    } catch (e) {
      if (code(e) !== 'EEXIST') throw e
      const previous = snapshot(ticket)
      if (!previous) continue
      mayRecover(previous)
      parents.push({ file: ticket, snapshot: previous })
      ticket = `${file}.recover-${createHash('sha256').update(ticket).update(previous.raw).digest('hex')}`
      continue
    }
    const ownedTicket = ticket
    try {
      // A parent may have cleaned up just before its process exited. Its missing
      // name would allow a new root contender; a descendant must then rejoin the
      // root election instead of claiming an independent recovery lane.
      const valid = parents.every(parent => {
        const current = snapshot(parent.file)
        if (!current || !same(parent.snapshot, current)) return false
        mayRecover(current)
        return true
      })
      if (!valid) { ticket = root; parents = []; continue }
      return fn()
    } finally { removeOwned(ownedTicket, owner) }
  }
  throw Error('Kütüphane kilidi kurtarma sınırına ulaştı; mevcut dosyalar korunuyor.')
}

function acquire(file: string): Owner {
  const owner: Owner = { format: 'nubbo-lock', pid: process.pid, nonce: randomUUID() }
  for (let attempt = 0; attempt < 8; attempt++) {
    try { publish(file, owner); return owner } catch (e) { if (code(e) !== 'EEXIST') throw e }
    const stale = snapshot(file)
    if (!stale) continue
    mayRecover(stale)
    const acquired = recovering(file, stale, () => {
      const current = snapshot(file)
      if (!current || !same(stale, current)) return false
      mayRecover(current)
      fs.unlinkSync(file)
      try { publish(file, owner); return true } catch (e) { if (code(e) === 'EEXIST') return false; throw e }
    })
    if (acquired) return owner
  }
  throw busy()
}
function assertOwned(file: string, owner: Owner): void {
  const current = snapshot(file)
  const o = current && ownerOf(current)
  if (!o || o.pid !== process.pid || o.nonce !== owner.nonce) throw lost()
}

/** A directory owns its own nonce; one instance cannot release another's claim. */
export function claimLibraryLock(directory: string): LibraryLock {
  const file = lockFile(directory)
  let record = held.get(file)
  // A deletion or rename outside this process leaves our record pointing at a
  // generation that no longer exists. Forget it and acquire again: a missing or
  // dead generation is claimed fresh, while a live foreign owner still answers
  // busy() and is never deleted. Losing ownership during the caller's own work
  // still surfaces as lost(), so nothing is written under a foreign lock.
  if (record) {
    try { assertOwned(file, record.owner) }
    catch { if (held.get(file) === record) held.delete(file); record = undefined }
  }
  if (!record) { record = { owner: acquire(file), refs: 0 }; held.set(file, record) }
  record.refs++
  const owned = record
  let released = false
  return {
    assertOwned: () => { if (released) throw lost(); assertOwned(file, owned.owner) },
    release: () => releaseHeld(file, owned, () => released, (value) => { released = value }),
  }
}
function releaseHeld(file: string, owned: Held, isReleased: () => boolean, markReleased: (value: boolean) => void): void {
  if (isReleased()) return
  markReleased(true)
  if (--owned.refs > 0) return
  // Bırakma hatası (dosya başka programca tutuluyor) KOŞUYU/çağrıyı hataya çevirmez: kayıt
  // `held`'de kalır, sonraki sahiplenme kendi kaydımızı doğrulanmış sayıp yeniden kullanır.
  if (removeOwned(file, owned.owner) && held.get(file) === owned) held.delete(file)
}
export function withLibraryLock<T>(directory: string, fn: () => T): T {
  const file = lockFile(directory), record = held.get(file)
  if (record) {
    let valid = true
    try { assertOwned(file, record.owner) } catch { valid = false }
    if (!valid) held.delete(file)
  }
  const lock = claimLibraryLock(directory)
  let asyncWork = false
  try {
    const result = fn()
    if (result instanceof Promise) {
      asyncWork = true
      return result.finally(() => lock.release()) as T
    }
    return result
  } finally {
    if (!asyncWork) lock.release()
  }
}
