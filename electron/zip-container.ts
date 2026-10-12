import AdmZip from 'adm-zip'
import { inflateRawSync } from 'node:zlib'

export const ZIP_LIMITS = { archiveBytes: 64 * 1024 * 1024, entryBytes: 64 * 1024 * 1024, totalBytes: 256 * 1024 * 1024, entries: 1024 } as const
export type JsonZipEntry = { name: string; data: Buffer }
const collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'variant' })
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Reads only bounded JSON data; never extracts archive paths to the filesystem. */
export function readJsonZip(buffer: Buffer): JsonZipEntry[] {
  if (buffer.length > ZIP_LIMITS.archiveBytes) throw new Error('ZIP dosyası boyut sınırını aşıyor.')
  const entries = new AdmZip(buffer).getEntries()
  if (entries.length > ZIP_LIMITS.entries) throw new Error('ZIP dosyasında çok fazla öğe var.')
  const names = new Set<string>(), out: JsonZipEntry[] = []
  let total = 0
  for (const entry of entries) {
    const name = entry.entryName
    if (name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').some(p => p === '..') || /[\x00-\x1f]/.test(name)) throw new Error('ZIP içinde geçersiz dosya yolu var.')
    if (entry.isDirectory || !/\.json$/i.test(name)) continue
    if (name.includes('/')) throw new Error('Tuval JSON’ları ZIP’in doğrudan içinde olmalı; iç içe klasör desteklenmiyor.')
    const key = name.normalize('NFC').toUpperCase()
    if (names.has(key)) throw new Error('ZIP içinde aynı adlı birden fazla JSON var.')
    names.add(key)
    const header = entry.header
    if (header.encrypted || ![0, 8].includes(header.method)) throw new Error('Şifreli veya desteklenmeyen ZIP kaydı.')
    if (header.size > ZIP_LIMITS.entryBytes || (total += header.size) > ZIP_LIMITS.totalBytes) throw new Error('ZIP içeriği boyut sınırını aşıyor.')
    const compressed = entry.getCompressedData()
    const data = header.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.min(ZIP_LIMITS.entryBytes, header.size + 1) })
    if (data.length !== header.size || crc32(data) !== header.crc) throw new Error('ZIP içeriği bozuk; boyut veya CRC uyuşmuyor.')
    out.push({ name, data })
  }
  return out.sort((a, b) => collator.compare(a.name, b.name))
}

export function writeJsonZip(entries: JsonZipEntry[]): Buffer {
  if (entries.length > ZIP_LIMITS.entries) throw new Error('Bir ZIP grubunda çok fazla tuval var.')
  const zip = new AdmZip({ noSort: true })
  let total = 0
  for (const entry of entries) {
    if (entry.data.length > ZIP_LIMITS.entryBytes || (total += entry.data.length) > ZIP_LIMITS.totalBytes) throw new Error('Tuval JSON’ları boyut sınırını aşıyor.')
    zip.addFile(entry.name, entry.data)
  }
  const data = zip.toBuffer()
  if (data.length > ZIP_LIMITS.archiveBytes) throw new Error('ZIP dosyası boyut sınırını aşıyor.')
  return data
}
