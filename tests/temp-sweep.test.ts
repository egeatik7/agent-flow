import { describe, expect, it } from 'vitest'
import { bayatCikarmaKlasorleri, geciciGirdileriTopla, type GeciciGirdi } from '../electron/temp-sweep'

const simdi = 1_800_000_000_000
const BAYAT = simdi - 60 * 60_000 // 1 saat önce
const TAZE = simdi - 60_000 // 1 dakika önce

const girdi = (ad: string, ek: Partial<GeciciGirdi> = {}): GeciciGirdi => ({
  ad,
  yol: `C:\\Temp\\${ad}`,
  exeVar: true,
  yukVar: true,
  mtimeMs: BAYAT,
  ...ek,
})

/**
 * Portable çalıştırma %TEMP%'e ~330 MB bırakıyor ve zorla öldürülünce silemiyor.
 * Ölçüldü: 5 günde 16 klasör · 4,93 GB (disk 10,7 GB boştu). Bu testler seçim kuralını sabitler.
 */
describe('portable geçici klasör süpürme kuralı', () => {
  it('bayat çıkarma klasörünü seçer', () => {
    const seçilen = bayatCikarmaKlasorleri([girdi('3KLRTeCFXRmfgBKByvauip3CYxV')], { now: simdi })
    expect(seçilen.map((x) => x.ad)).toEqual(['3KLRTeCFXRmfgBKByvauip3CYxV'])
  })

  it('ÇALIŞAN örneğin kendi klasörünü ASLA seçmez', () => {
    const own = 'C:\\Temp\\3KLRTeCFXRmfgBKByvauip3CYxV'
    const seçilen = bayatCikarmaKlasorleri([girdi('3KLRTeCFXRmfgBKByvauip3CYxV', { yol: own })], { now: simdi, ownDir: own })
    expect(seçilen, 'kendi klasörünü silmeye kalktı (uygulama kendi altından silinir)').toEqual([])
  })

  it('TAZE klasörü seçmez (yeni açılmış örnek öldürülmesin)', () => {
    const seçilen = bayatCikarmaKlasorleri([girdi('3KLT72UYZJT6CKbinDxazNU4G6V', { mtimeMs: TAZE })], { now: simdi })
    expect(seçilen).toEqual([])
  })

  it('bizim exe/imzamız olmayan klasörlere DOKUNMAZ', () => {
    const seçilen = bayatCikarmaKlasorleri(
      [
        girdi('BaskaUygulamaGecici123', { exeVar: false, yukVar: false }),
        girdi('3KLUKaEgq6gYvaCWgEU5OxTZCYx', { exeVar: false }), // exe yok
        girdi('3KLVFtbXJnTyQwlRuTpWJjIQzHH', { yukVar: false, exeVar: false }), // bizim exe yok
      ],
      { now: simdi }
    )
    expect(seçilen).toEqual([])
  })

  it('yarım kalmış çıkarmayı (yalnız exe) da seçer', () => {
    const seçilen = bayatCikarmaKlasorleri([girdi('3KLe2GGQBe7yR8vFuxJlankiLrU', { yukVar: false })], { now: simdi })
    expect(seçilen.map((x) => x.ad)).toEqual(['3KLe2GGQBe7yR8vFuxJlankiLrU'])
  })

  it('rastgele ad desenine uymayan klasörü seçmez', () => {
    const seçilen = bayatCikarmaKlasorleri([girdi('nubbo-kabul')], { now: simdi })
    expect(seçilen).toEqual([])
  })

  it('girdileri %TEMP% kökünden doğru kurar', () => {
    const A = '3KLRTeCFXRmfgBKByvauip3CYxV'
    const B = '3KLT72UYZJT6CKbinDxazNU4G6V'
    const varOlan = new Set([`C:\\Temp\\${A}\\Nubbo Agent Studio.exe`, `C:\\Temp\\${A}\\app-64.7z`])
    const girdiler = geciciGirdileriTopla({
      tempDir: 'C:\\Temp',
      adlar: [A, B],
      varMi: (y) => varOlan.has(y),
      mtimeMs: () => BAYAT,
    })
    expect(girdiler[0].exeVar).toBe(true)
    expect(girdiler[0].yukVar).toBe(true)
    expect(girdiler[1].exeVar).toBe(false)
    const seçilen = bayatCikarmaKlasorleri(girdiler, { now: simdi })
    expect(seçilen.map((x) => x.ad)).toEqual([A])
  })
})
