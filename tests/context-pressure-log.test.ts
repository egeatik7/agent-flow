import { describe, expect, it } from 'vitest'
import { contextErrorKind, contextPressureText, responseUsageText } from '../electron/send-log'

/** Bağlam penceresi baskısı logları: yalnız sayı/kod yazılır (içerik ve anahtar YAZILMAZ). */
describe('bağlam baskısı logları', () => {
  it('normal doluluk: tek satır, yüzde ve boyutlar yazılır', () => {
    const s = contextPressureText({ model: 'qwen3.5-64k:latest', metinKarakter: 32000, goruntuAdet: 1, goruntuBayt: 102400, pencereToken: 65536 })
    expect(s).toContain('BAGLAM-SIGMA')
    expect(s).toContain('tahmini≈11400 token')
    expect(s).toContain('(%17)')
    expect(s).not.toContain('BAGLAM-UYARI')
  })

  it('eşik aşılınca UYARI, pencere geçilince ASIM yazılır', () => {
    const uyari = contextPressureText({ model: 'm', metinKarakter: 170000, goruntuAdet: 0, goruntuBayt: 0, pencereToken: 65536 })
    expect(uyari).toContain('BAGLAM-UYARI')
    const asim = contextPressureText({ model: 'm', metinKarakter: 250000, goruntuAdet: 0, goruntuBayt: 0, pencereToken: 65536 })
    expect(asim).toContain('BAGLAM-ASIM')
    expect(asim).toContain('SUNUCUYA SIĞMIYOR')
  })

  it('pencere bilinmiyorsa yalnız boyut yazılır, yüzde/uyarı üretilmez', () => {
    const s = contextPressureText({ model: 'uzak', metinKarakter: 400000, goruntuAdet: 0, goruntuBayt: 0 })
    expect(s).not.toContain('BAGLAM-UYARI')
    expect(s).not.toContain('BAGLAM-ASIM')
    expect(s).toContain('pencere=?')
  })

  it('cevap sayıları ve kesilme kararı', () => {
    expect(responseUsageText({ model: 'm', finishReason: 'stop', usage: { prompt_tokens: 51200, completion_tokens: 2100, total_tokens: 53300 } }))
      .toContain('usage=prompt 51200 · completion 2100 · total 53300')
    const kesik = responseUsageText({ model: 'm', finishReason: 'length' })!
    expect(kesik).toContain('BAGLAM-KESIK')
    expect(responseUsageText({ model: 'm' })).toBeNull()
  })

  it('sunucu hatası sınıflandırılır (içerik yazılmaz)', () => {
    expect(contextErrorKind('prediction aborted, token repeat limit reached')).toBe('tekrar')
    expect(contextErrorKind('the prompt is too long for the context window')).toBe('baglam')
    expect(contextErrorKind('connection reset by peer')).toBe('diger')
  })
})
