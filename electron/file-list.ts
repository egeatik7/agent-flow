import fs from 'node:fs'
import path from 'node:path'
import type { ListSource } from './file-contract'

export function matchesFile(name: string, filter: string): boolean {
  const parts = filter.split(/[;,]/).map(x => x.trim()).filter(Boolean)
  return (parts.length ? parts : ['*']).some(p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'iu').test(name))
}
/** Modern opt-in reader. Legacy listDirEntries remains untouched. No symlink traversal. */
export async function listFileSource(dir: string, spec: ListSource): Promise<string[]> {
  if (!dir || dir.includes('{{')) throw new Error('Döngünün klasörü çözülemedi.')
  const root = await fs.promises.lstat(dir)
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error(`Gerçek bir klasör seç: ${dir}`)
  const out: string[] = []
  const read = async (folder: string, depth: number) => {
    if (depth > 128) throw new Error('Klasör ağacı 128 seviyeden derin.')
    const entries = await fs.promises.readdir(folder, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name, 'tr', { numeric: true, sensitivity: 'base' }))
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      const p = path.join(folder, e.name)
      if ((spec.kind === 'all' || spec.kind === 'folders' && e.isDirectory() || spec.kind === 'files' && e.isFile()) && matchesFile(e.name, spec.filter)) out.push(p)
      if (spec.recursive && e.isDirectory()) await read(p, depth + 1)
    }
  }
  await read(dir, 0)
  return out
}
