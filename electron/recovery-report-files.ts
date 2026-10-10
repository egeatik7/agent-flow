import fs from 'node:fs'
import path from 'node:path'

/** Removes only report JSON files, never screenshots, flow files or directories. */
export function removeRecoveryReportFiles(dir: string, ids: string[] | undefined, onRemoved: (ids: string[]) => void): void {
  const selected = ids ?? fs.readdirSync(dir).filter(name => /^recovery-[\w-]+\.json$/.test(name)).map(name => name.slice(0, -5))
  if (selected.some(id => typeof id !== 'string' || !/^recovery-[\w-]+$/.test(id))) throw new Error('Geçersiz kurtarma raporu kimliği.')
  const removed: string[] = []
  try {
    for (const id of new Set(selected)) {
      try { fs.unlinkSync(path.join(dir, `${id}.json`)) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      removed.push(id)
    }
  } finally {
    // Notify even after a partial failure so the UI matches files already deleted.
    if (removed.length) onRemoved(removed)
  }
}
