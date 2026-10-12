import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { ScanResult } from '../electron/matcher'
import { setChatLogger } from '../electron/openrouter'
import { imageBytes, imageFromMessages, setDiagnosticsRoot } from '../electron/send-log'

/**
 * Kullanıcının isteği (1.9.115): `imageBytes()` HAM base64 ve data URL biçimlerini desteklesin; MIME
 * görüntü nesnesinden gelsin; gönderim özeti ve kaydedilen görüntü GERÇEK HTTP gövdesindeki `image_url`
 * parçasından üretilsin; istekte duran ham base64 görüntü "YOK" diye raporlanmasın.
 * Worker/köprüde yeni görüntü alma davranışı EKLENMEDİ.
 */
const tarama = (data: unknown, mime?: string) => ({
  area: { x: 0, y: 0, w: 1000, h: 700 },
  items: [{ id: 5, text: 'Kaydet', type: 'Button', src: 'uia', x: 10, y: 10, w: 90, h: 24 }],
  image: data === null ? null : { data, w: 800, h: 450, ...(mime ? { mime } : {}) },
  window: 'Blender', ocr: true, ocrCount: 1, uiaCount: 1, ocrEngine: 'combined',
}) as unknown as ScanResult

function yanit(id: number) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ id, text: 'Kaydet', reason: 'test' }) } }] }) })))
}

afterEach(() => { vi.unstubAllGlobals(); setChatLogger(null); setDiagnosticsRoot('') })

it('imageBytes hem data URL hem HAM base64 kabul eder; MIME görüntü nesnesinden gelir', () => {
  const dataUrl = imageBytes('data:image/png;base64,QUJD', 'image/jpeg')
  expect(dataUrl?.buffer.toString('utf8')).toBe('ABC')
  expect(dataUrl?.mime).toBe('image/jpeg') // nesnenin bildirdiği MIME kazanır
  const ham = imageBytes('QUJD', 'image/webp')
  expect(ham?.buffer.toString('utf8')).toBe('ABC')
  expect(ham?.mime).toBe('image/webp')
  expect(imageBytes('', 'image/jpeg')).toBeNull()
  expect(imageBytes('bu bir görüntü değil!!', 'image/jpeg')).toBeNull()
})

it('imageFromMessages görüntüyü gerçek gövdedeki image_url parçasından (ham base64) çıkarır', () => {
  const cikarilan = imageFromMessages([
    { content: 'metin' },
    { content: [{ type: 'text', text: 'liste' }, { type: 'image_url', image_url: { url: 'QUJD' } }] },
  ], 'image/jpeg')
  expect(cikarilan?.buffer.toString('utf8')).toBe('ABC')
  expect(imageFromMessages([{ content: 'yalnız metin' }], 'image/jpeg')).toBeNull()
})

it('HAM base64 görüntü istekte varken özet "VAR" der ve görüntü diske kaydedilir', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nubbo-ham-'))
  setDiagnosticsRoot(dir)
  const satirlar: string[] = []
  setChatLogger((satir) => satirlar.push(satir))
  yanit(5)
  const { chooseScreenTarget } = await import('../electron/openrouter')
  const choice = await chooseScreenTarget({ apiKey: 'fake', model: 'valid', prompt: 'Kaydet', kind: 'click' as never, stepTitle: 'Tıkla', scan: tarama('QUJD', 'image/jpeg'), sendImage: true })
  expect(choice.id).toBe(5)
  const ozet = satirlar.find((s) => s.startsWith('GONDERIM id='))!
  expect(ozet).toBeDefined()
  expect(ozet).toContain('goruntu=VAR 800x450')
  expect(ozet).toContain('image/jpeg')
  expect(ozet).not.toContain('goruntu=YOK')
  const klasor = readdirSync(dir)[0]
  const dosyalar = readdirSync(join(dir, klasor))
  const goruntuDosyasi = dosyalar.find((d) => d.startsWith('gonderilen-goruntu.'))!
  expect(goruntuDosyasi).toBeDefined()
  expect(readFileSync(join(dir, klasor, goruntuDosyasi), 'utf8')).toBe('ABC')
  expect(dosyalar).toContain('ozet.txt')
})

it('görüntü nesnesi yokken özet YOK + sebep yazar (regresyon)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nubbo-yok-'))
  setDiagnosticsRoot(dir)
  const satirlar: string[] = []
  setChatLogger((satir) => satirlar.push(satir))
  yanit(5)
  const { chooseScreenTarget } = await import('../electron/openrouter')
  await chooseScreenTarget({ apiKey: 'fake', model: 'valid', prompt: 'Kaydet', kind: 'click' as never, stepTitle: 'Tıkla', scan: tarama(null), sendImage: true })
  const ozet = satirlar.find((s) => s.startsWith('GONDERIM id='))!
  expect(ozet).toContain('goruntu=YOK (tarama görüntüsü boş')
  const klasor = readdirSync(dir)[0]
  expect(readdirSync(join(dir, klasor)).some((d) => d.startsWith('gonderilen-goruntu.'))).toBe(false)
  expect(existsSync(join(dir, klasor, 'ozet.txt'))).toBe(true)
})
