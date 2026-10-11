import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
const PREFIX = /^nubbo-screen-[0-9T_:.Z-]+(?:-[0-9a-f-]+)?\.(?:png|jpg)$/i
export function pruneScreenFiles(dir = os.tmpdir(), now = Date.now(), keep?: string): void {
  const files = fs.readdirSync(dir).filter(name => PREFIX.test(name)).flatMap(name => {
    const file = path.join(dir, name)
    try { const stat = fs.lstatSync(file); return stat.isFile() && !stat.isSymbolicLink() ? [{ file, age: stat.mtimeMs, size: stat.size }] : [] } catch { return [] }
  }).sort((a, b) => a.file === keep ? -1 : b.file === keep ? 1 : b.age - a.age)
  let bytes = 0
  for (let i = 0; i < files.length; i++) {
    const file = files[i]; bytes += file.size
    if (file.file !== keep && (i >= 100 || bytes > 100 * 1024 * 1024 || now - file.age > 24 * 60 * 60_000)) {
      try { fs.rmSync(file.file, { force: true }) } catch { /* best effort, never abort an action */ }
    }
  }
}
export function writeScreenFile(data: string, mime: string, dir = os.tmpdir()): string {
  const name = `nubbo-screen-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.${/jpe?g/i.test(mime) ? 'jpg' : 'png'}`
  const file = path.join(dir, name)
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  try { pruneScreenFiles(dir, Date.now(), file) } catch { /* Keep the successfully written capture available. */ }
  // The delivered capture remains readable; older files have count/size/age limits.
  return file
}
