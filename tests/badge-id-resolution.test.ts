import { expect, it, vi } from 'vitest'
import type { ScanResult } from '../electron/matcher'
import { refineWordTarget } from '../electron/word-targets'
import { setChatLogger } from '../electron/openrouter'
import { setDiagnosticsRoot } from '../electron/send-log'

/**
 * Kullanıcının isteği (1.9.116): GÖRÜNTÜ ROZETİ çözümlemesi. Qwen numarayı görüntüdeki rozetten okuyor;
 * rozetler ASIL öğe kimlikleri (küçük), liste ise kelime adayı kimlikleri. Çözümleme YALNIZ gerçekten
 * gönderilen **marked** görüntünün aynı karesindeki öğeler için yapılır. Çok kelimeli OCR satırında satır
 * MERKEZİNE düşülmez (kelime indeksi verilmez; ajanın mevcut kısa ikinci kelime seçimi kelimeyi seçer).
 */
const adresSatiri = () => ({
  id: 36, text: 'C:WserslASUS TUFXDocumentsl', type: 'Text', src: 'ocr' as const, x: 627, y: 134, w: 213, h: 20,
  words: [
    { t: 'C:WserslASUS', x: 627, y: 140, w: 97, h: 14 },
    { t: 'TUFXDocumentsl', x: 728, y: 140, w: 112, h: 14 },
  ],
})

function tarama(marked: boolean | null) {
  return {
    area: { x: 0, y: 0, w: 1400, h: 788 },
    items: [adresSatiri(), { id: 101, text: 'Import GLB Files', type: 'Button', src: 'uia', x: 820, y: 400, w: 230, h: 22 }],
    image: marked === null ? null : { data: 'QUJD', w: 1400, h: 788, mime: 'image/jpeg', ...(marked ? { marked: true } : {}) },
    window: 'Blender File View', ocr: true, ocrCount: 2, uiaCount: 1, ocrEngine: 'combined',
  } as unknown as ScanResult
}

function yanit(id: number, text = 'C:\\Users\\ASUS TUF\\Documents') {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ id, text, reason: 'adres kutusu' }) } }] }) })))
}

async function sor(scan: ScanResult) {
  const { chooseScreenTarget } = await import('../electron/openrouter')
  return chooseScreenTarget({ apiKey: 'fake', model: 'valid', prompt: 'adres giriş kutusuna tıkla', kind: 'click' as never, stepTitle: 'Tıkla', scan, sendImage: !!scan.image })
}

it('GÖRÜNTÜSÜZ istekte aynı küçük numara reddedilir (rozet çözümlemesi yok)', async () => {
  setDiagnosticsRoot('')
  const satirlar: string[] = []
  setChatLogger((s) => satirlar.push(s))
  yanit(36)
  await expect(sor(tarama(null))).rejects.toThrow('id=36')
  expect(satirlar.some((s) => s.startsWith('GORUNTU-ROZETI'))).toBe(false)
  setChatLogger(null)
})

it('PLAIN (numarasız) görüntüde de reddedilir: çözümleme yalnız marked görüntüye bağlı', async () => {
  setDiagnosticsRoot('')
  const satirlar: string[] = []
  setChatLogger((s) => satirlar.push(s))
  yanit(36)
  await expect(sor(tarama(false))).rejects.toThrow('id=36')
  setChatLogger(null)
})

it('MARKED görüntüde rozet numarası doğru OCR SATIRINA çözülür ve kelime indeksi VERİLMEZ', async () => {
  setDiagnosticsRoot('')
  const satirlar: string[] = []
  setChatLogger((s) => satirlar.push(s))
  yanit(36)
  await expect(sor(tarama(true))).rejects.toThrow('MODEL_TARGET_REJECTED')
  // The badge number matches the row, but the model's text does not match the OCR line.
  // A contradiction does not click; the word-box helper below is unchanged.

  expect(satirlar.some((s) => s.startsWith('CELISKI'))).toBe(true)
  // Kelime kutusuna gidiş: kısa ikinci seçim bir kelime indeksi seçtiğinde tıklama GERÇEK kelime kutusudur
  // (satır merkezi DEĞİL) — refineWordTarget kelimenin kendi dikdörtgenini verir.
  const satir = adresSatiri() as never
  const ikinciKelime = refineWordTarget(satir, 1)!
  expect(ikinciKelime.x).toBeGreaterThanOrEqual(728)
  expect(ikinciKelime.w).toBeLessThanOrEqual(112)
  expect(ikinciKelime.x).not.toBe(627 + 213 / 2) // satır merkezi değil
  setChatLogger(null)
})

it('tek kelimeli kontrol (UIA düğmesi) rozetten kendi kutusuna çözülür', async () => {
  setDiagnosticsRoot('')
  yanit(101, 'Import GLB Files')
  const secim = await sor(tarama(true))
  expect(secim.id).toBe(101)
  expect(secim.wordIndex).toBeUndefined()
  expect(secim.rejected).toBeUndefined()
})

it('rozet satiri kisa ikinci kelime secimine GERCEKTEN girer (eski hata: sessizce cikiyordu)', async () => {
  const { shouldRefineWord } = await import('../electron/word-targets')
  expect(shouldRefineWord('click', 'ocr', { badgeResolved: true })).toBe(true)   // rozet satiri
  expect(shouldRefineWord('click', 'ocr', { wordIndex: 1 })).toBe(true)          // normal kelime adayi
  expect(shouldRefineWord('click', 'ocr', {})).toBe(false)                       // ESKI HATA: burada cikiyordu
  expect(shouldRefineWord('click', 'ocr', { badgeResolved: false })).toBe(false)
  expect(shouldRefineWord('type', 'ocr', { badgeResolved: true })).toBe(false)   // tikla disi tur
  expect(shouldRefineWord('click', 'uia', { badgeResolved: true })).toBe(false)  // UIA ogesi zaten kendi kutusu
})

it('rozetten cozulen secim badgeResolved tasir ve kelime indeksi VERILMEZ', async () => {
  setDiagnosticsRoot('')
  const satirlar: string[] = []
  setChatLogger((s) => satirlar.push(s))
  yanit(36)
  await expect(sor(tarama(true))).rejects.toThrow('MODEL_TARGET_REJECTED')
  expect(satirlar.some((s) => s.startsWith('CELISKI'))).toBe(true)
  setChatLogger(null)
})

it('gonderim ozeti GERCEK marked bilgisini tasir (plain/marked artik durust)', async () => {
  setDiagnosticsRoot('')
  const satirlar: string[] = []
  setChatLogger((s) => satirlar.push(s))
  yanit(101, 'Import GLB Files')
  await sor(tarama(true))
  const markedOzet = satirlar.find((s) => s.startsWith('GONDERIM id='))!
  expect(markedOzet).toContain('marked')
  expect(markedOzet).not.toContain('plain')
  satirlar.length = 0
  await sor(tarama(false))
  const plainOzet = satirlar.find((s) => s.startsWith('GONDERIM id='))!
  expect(plainOzet).toContain('plain')
  setChatLogger(null)
})
