import fs from 'fs'
import path from 'path'

/**
 * Names sitting directly in `dir`: files, folders, and anything else.
 * Nothing inside a subfolder. Missing paths and templates return null.
 */
export function listDirEntries(dir: string): string[] | null {
  const trimmed = dir.trim()
  if (!trimmed || trimmed.includes('{{')) return null
  let names: string[]
  try {
    if (!fs.statSync(trimmed).isDirectory()) return null
    names = fs.readdirSync(trimmed)
  } catch {
    return null
  }
  names.sort((a, b) => a.localeCompare(b, 'tr', { numeric: true, sensitivity: 'base' }))
  return names.map((n) => path.join(trimmed, n))
}
