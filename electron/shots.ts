import { app } from 'electron'
import fs from 'fs'
import path from 'path'

/** Rolling pocket of screenshots for the current runs. The oldest file is deleted past this count. */
const MAX_SHOTS = 10

export function rememberShot(jpegBase64: string, label: string): string | null {
  if (!jpegBase64) return null
  try {
    const dir = path.join(app.getPath('userData'), 'shots')
    fs.mkdirSync(dir, { recursive: true })
    const safe = label.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 28) || 'kare'
    const file = path.join(dir, `${Date.now()}-${safe}.jpg`)
    fs.writeFileSync(file, Buffer.from(jpegBase64, 'base64'))
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jpg'))
      .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => a.m - b.m)
    while (files.length > MAX_SHOTS) {
      const old = files.shift()
      if (old) fs.unlinkSync(path.join(dir, old.f))
    }
    return file
  } catch {
    return null
  }
}
