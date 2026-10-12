import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { countSentCandidates, imageBytes, responseSummaryText, saveRequestEvidence, sendSummaryText, setDiagnosticsRoot } from '../electron/send-log'

/**
 * Kullanıcının isteği (1.9.113): "kanıtlanabilir günlük yazsın" — istek gövdesi 6000 karakterde
 * kesildiği için görüntü işareti kayboluyordu ve "Qwen ekran görüntüsü aldı mı" KANITLANAMIYORDU.
 * Bu dosya, gövdeden ÖNCE yazılan tek satırlık özeti ve diske yazılan kanıtı ölçer.
 */
const ozet = (over: Partial<Parameters<typeof sendSummaryText>[0]> = {}) => sendSummaryText({
  id: 'abc-1', node: 'Tıkla', stage: 'click', model: 'local:qwen3.5-64k:latest', target: 'local',
  image: { sent: true, w: 1400, h: 787, bytes: 258_000, mime: 'image/jpeg' },
  candidates: { built: 318, sent: 240 }, promptChars: 17_800, ...over,
})

describe('gönderim özeti kanıtlanabilir', () => {
  it('tek satırdır ve gerekli alanların hepsini taşır', () => {
    const satir = ozet()
    expect(satir).not.toContain('\n')
    for (const alan of ['GONDERIM id=abc-1', 'node=Tıkla', 'asama=click', 'model=local:qwen3.5-64k:latest', 'hedef=local', 'goruntu=VAR 1400x787', 'aday=uretilen:318 gonderilen:240', 'istem-uzunlugu=17800']) {
      expect(satir).toContain(alan)
    }
  })

  it('görüntü yoksa SEBEBİNİ yazar ve görüntüsüz geri dönüşü işaretler', () => {
    const yok = ozet({ image: { sent: false, reason: 'ayar kapalı: numaralı ekran görüntüsü gönder' }, fallbackNoImage: true })
    expect(yok).toContain('goruntu=YOK (ayar kapalı')
    expect(yok).toContain('goruntusuz-geri-donus=VAR')
    const model = ozet({ image: { sent: false, reason: 'tarama görüntüsü boş (kare alınamadı)' } })
    expect(model).toContain('goruntu=YOK (tarama görüntüsü boş')
  })

  it('çok uzun aday listesi özeti gizlemez (gövde kısalsa bile özet ayrı satırdır)', () => {
    const liste = Array.from({ length: 900 }, (_, i) => `#${1000 + i} Text "aday ${i}" @1,2 3x4`).join('\n')
    expect(countSentCandidates(liste)).toBe(900)
    const satir = ozet({ candidates: { built: 1200, sent: countSentCandidates(liste) } })
    expect(satir).toContain('gonderilen:900')
    expect(satir.length).toBeLessThan(400)
  })

  it('yanıt özeti: red sebebi, listede var mı ve düzeltme bilgisi görünür', () => {
    const red = responseSummaryText({ id: 'abc-1', raw: '{"id":35,...}', returnedId: 35, inSentList: false, selectable: false, rejected: 'absent' })
    expect(red).toContain('donen-id=35')
    expect(red).toContain('listede=YOK')
    expect(red).toContain('red-sebebi=absent')
    const duzeltme = responseSummaryText({ id: 'abc-2', raw: '{"id":7}', returnedId: 7, inSentList: true, selectable: true, resolvedWord: '#7 w1', correctedFrom: '04_Hunyuanm', correctedTo: 'Blender' })
    expect(duzeltme).toContain('duzeltme=04_Hunyuanm -> Blender')
  })

  it('görüntü baytları isteğin kendi verisinden çıkarılır; gizli bilgi yazılmaz', () => {
    const img = imageBytes('data:image/jpeg;base64,QUJD')
    expect(img?.mime).toBe('image/jpeg')
    expect(img?.buffer.toString('utf8')).toBe('ABC')
    expect(imageBytes('data:image/png;base64,!!bozuk!!')).not.toBeNull() // çözülürse bayt üretir, çözülmezse null
    const dir = mkdtempSync(join(tmpdir(), 'nubbo-kanit-'))
    setDiagnosticsRoot(dir)
    const yazilan = saveRequestEvidence('test-1', { summary: ozet(), system: 'SISTEM', instruction: 'talimat', candidates: '#1 Text "a"', image: img!, response: '{"id":1}' })
    expect(yazilan).toContain('test-1')
    const dosyalar = readdirSync(join(dir, 'test-1')).sort()
    expect(dosyalar).toContain('ozet.txt')
    expect(dosyalar).toContain('sistem-promptu.txt')
    expect(dosyalar).toContain('aday-listesi.txt')
    expect(dosyalar).toContain('gonderilen-goruntu.jpg')
    expect(dosyalar).toContain('yanit.txt')
    const hepsi = dosyalar.map((d) => readFileSync(join(dir, 'test-1', d), 'utf8')).join('\n')
    expect(hepsi).not.toMatch(/sk-or-|Authorization|apiKey/i)
    setDiagnosticsRoot('')
  })
})
