import { describe, expect, it } from 'vitest'
import { sendMarkerInfo, shortModelName, stopwatchText } from '../electron/send-log'

/**
 * Kullanıcının şikâyeti (1.9.118): "masaüstü kartı her güncellemeyi geçmiyor; OCR'ı buluyor ama LLM
 * cevap verirken orada bir sayaç açıp cevabın kaç saniyede oluştuğunu raporlayabilir."
 * Kart kronometresi, model isteği/cevabı işaretlerinden (GONDERIM/YANIT) sürülür; bu dosya o kararı ölçer.
 */
describe('kart kronometresi işaretleri tanır', () => {
  it('GONDERIM satırından model ve aşama çıkarılır (alan sırasından bağımsız)', () => {
    const satir = 'GONDERIM id=mv5t49l9-9 | node=Tıkla | asama=click | model=local:qwen3.5-64k:latest,~openai/gpt-luna-latest | hedef=local | goruntu=VAR 1400x788 marked 102688B image/jpeg'
    const i = sendMarkerInfo(satir)
    expect(i?.kind).toBe('gonderim')
    expect(i?.id).toBe('mv5t49l9-9')
    expect(i?.stage).toBe('click')
    expect(shortModelName(i?.model)).toBe('qwen3.5-64k:latest')
  })

  it('YANIT satırı kronometreyi bitirir; alakasız satır hiçbir şey başlatmaz', () => {
    expect(sendMarkerInfo('YANIT id=mv5t49l9-9 | donen-id=35 | listede=YOK | red-sebebi=absent')?.kind).toBe('yanit')
    expect(sendMarkerInfo('[yerel] → qwen3.5-64k:latest')).toBeNull()
    expect(sendMarkerInfo('GORUNTU-ROZETI id=x | donen-id=35 listede YOK')).toBeNull()
  })

  it('kelime seçimi aşaması ayrı etiketlenir (kısa ikinci istek)', () => {
    const i = sendMarkerInfo('GONDERIM id=mv5t2ec4-4 | node=mv0t7n2h13ih0w9g | asama=ocr-word-choice | model=local:qwen3.5-64k:latest | hedef=local')
    expect(i?.stage).toBe('ocr-word-choice')
  })

  it('kart satırı süreyi Türkçe ondalık virgülle ve model adıyla yazar', () => {
    expect(stopwatchText('Model cevabı bekleniyor', 'qwen3.5-64k:latest', 1400)).toBe('Model cevabı bekleniyor · qwen3.5-64k:latest · 1,4 sn')
    expect(stopwatchText('Model cevabı', 'qwen3.5-64k:latest', 3120)).toBe('Model cevabı · qwen3.5-64k:latest · 3,1 sn')
    expect(stopwatchText('Model cevabı', '', 0)).toBe('Model cevabı · 0,0 sn')
    expect(shortModelName('')).toBe('')
    expect(shortModelName(undefined)).toBe('')
  })
})
