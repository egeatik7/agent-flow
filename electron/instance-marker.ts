import fs from 'node:fs'
import path from 'node:path'

/**
 * Portable örneğin çalıştığını bildiren işaret dosyası. %TEMP% altındaki çıkarma klasörü, süreç
 * zorla öldürülünce kalıyor; temizleyici "10 dakikadan eski" diye ÇALIŞAN bir örneğin klasörünü
 * siliyordu ve saatlerce süren koşu düşüyordu. İşaret, süre tahmini yerine gerçek sahipliği söyler.
 */
export const INSTANCE_MARKER = '.nubbo-calistiriyor'

export function instanceMarkerPath(dir: string): string {
  return path.join(dir, INSTANCE_MARKER)
}

export function writeInstanceMarker(dir: string, pid = process.pid): void {
  try { fs.writeFileSync(instanceMarkerPath(dir), String(pid)) } catch { /* salt okunur klasör: süpürme zaten kendi klasörünü atlar */ }
}

export function clearInstanceMarker(dir: string): void {
  try { fs.unlinkSync(instanceMarkerPath(dir)) } catch { /* zaten yok */ }
}

/** İşaret dosyasındaki süreç hâlâ yaşıyor mu? Okunamıyorsa "bilinmiyor" → öldürme. */
export function instanceMarkerAlive(dir: string, alive: (pid: number) => boolean = processAlive): boolean {
  try {
    const pid = Number(fs.readFileSync(instanceMarkerPath(dir), 'utf8').trim())
    if (!Number.isInteger(pid) || pid <= 0) return false
    return alive(pid)
  } catch { return false }
}

export function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
}
