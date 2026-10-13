import { beforeEach, describe, expect, it } from 'vitest'
import { baglamKapasitesi, contextErrorKind, contextPressureText, parseOllamaNumCtx, responseUsageText, setBaglamKapasitesi } from '../electron/send-log'

/**
 * 1.9.126 — bağlam ölçüm loglarının düzeltmesi. KURAL: etkin num_ctx ÖLÇÜMDÜR (model+sunucu bazında
 * önbellekli); token sayısı TAHMİNDİR ve hiçbir karar bu tahmine dayanmaz; sunucu alanları olduğu gibi
 * yazılır, eksik alan "bilinmiyor"dur.
 */
const URL1 = 'http://localhost:11434'
beforeEach(() => { setBaglamKapasitesi('qwen3.5-64k:latest', URL1, 65536); setBaglamKapasitesi('gui-owl:latest', URL1, 32768); setBaglamKapasitesi('bilinmeyen:latest', URL1, null) })

describe('1) aynı koşuda farklı modeller için AYRI etkin kapasiteler', () => {
  it('Qwen 65536 ve GUI-Owl 32768 ayrı ayrı kullanılır', () => {
    expect(baglamKapasitesi('qwen3.5-64k:latest', URL1)).toBe(65536)
    expect(baglamKapasitesi('gui-owl:latest', URL1)).toBe(32768)
    const metin = 100000
    const q = contextPressureText({ model: 'qwen3.5-64k:latest', metinKarakter: metin, goruntuAdet: 0, goruntuBayt: 0, pencereToken: baglamKapasitesi('qwen3.5-64k:latest', URL1)! })
    const g = contextPressureText({ model: 'gui-owl:latest', metinKarakter: metin, goruntuAdet: 0, goruntuBayt: 0, pencereToken: baglamKapasitesi('gui-owl:latest', URL1)! })
    expect(q).toContain('pencere=65536')
    expect(g).toContain('pencere=32768')
    expect(q).not.toBe(g) // yüzdeler farklı
  })

  it('sunucu bazında ayrı önbellek (aynı model, farklı sunucu)', () => {
    setBaglamKapasitesi('qwen3.5-64k:latest', 'http://other:11434', 8192)
    expect(baglamKapasitesi('qwen3.5-64k:latest', URL1)).toBe(65536)
    expect(baglamKapasitesi('qwen3.5-64k:latest', 'http://other:11434')).toBe(8192)
  })
})

describe('2) etkin kapasite bilinmiyorsa yüzde ÜRETİLMEZ', () => {
  it('pencere=bilinmiyor yazılır; yüzde/UYARI/ASIM çıkmaz', () => {
    const s = contextPressureText({ model: 'bilinmeyen:latest', metinKarakter: 400000, goruntuAdet: 0, goruntuBayt: 0, pencereToken: baglamKapasitesi('bilinmeyen:latest', URL1) })
    expect(s).toContain('pencere=bilinmiyor')
    expect(s).not.toContain('(%')
    expect(s).not.toContain('BAGLAM-UYARI')
    expect(s).not.toContain('BAGLAM-ASIM')
  })
})

describe('3) tahmini aşım isteği DEĞİŞTİRMEZ', () => {
  it('mesajlar dokunulmadan kalır ve satır bunu açıkça söyler', () => {
    const mesajlar = [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }]
    const kopya = JSON.parse(JSON.stringify(mesajlar))
    const s = contextPressureText({ model: 'gui-owl:latest', metinKarakter: 200000, goruntuAdet: 0, goruntuBayt: 0, pencereToken: 32768 })
    expect(s).toContain('BAGLAM-ASIM')
    expect(s).toContain('Tahmini kapasite aşımı; gerçek token ölçümü gerekli')
    expect(s).toContain('istek DEĞİŞTİRİLMEDİ')
    expect(s).not.toContain('SIĞMIYOR')
    expect(mesajlar).toEqual(kopya) // engelleme/kırpma/model değiştirme YOK
  })
})

describe('4) length sonucu kesin bağlam taşması DEĞİLDİR', () => {
  it('KESIK satırı iki olasılığı söyler ve KANITLANMADI der', () => {
    const s = responseUsageText({ model: 'm', finishReason: 'length' })!
    expect(s).toContain('BAGLAM-KESIK')
    expect(s).toContain('çıktı bütçesi VEYA bağlam sınırı olabilir')
    expect(s).toContain('KANITLANMADI')
    expect(s).toContain('max_tokens=yok') // istekte sınır yoksa "yok"
  })
})

describe('5) hata sınıfları ayrı (geniş eşleşme YOK)', () => {
  it('token repeat ≠ bağlam aşımı; belirsiz metin genel API hatası kalır', () => {
    expect(contextErrorKind('... prediction aborted, token repeat limit reached')).toBe('tekrar')
    expect(contextErrorKind('maximum context length exceeded')).toBe('baglam')
    expect(contextErrorKind('context_length_exceeded')).toBe('baglam')
    expect(contextErrorKind('the request was truncated')).toBe('diger') // geniş /truncat/ KULLANILMAZ
    expect(contextErrorKind('context deadline exceeded')).toBe('diger')
  })
})

describe('6) eksik usage alanları UYDURULMAZ + num_ctx ile azami context karıştırılmaz', () => {
  it('alan yoksa bilinmiyor yazılır', () => {
    const s = responseUsageText({ model: 'm', finishReason: 'stop' })!
    expect(s).toContain('prompt_tokens=bilinmiyor')
    expect(s).toContain('completion_tokens=bilinmiyor')
    expect(s).toContain('total_tokens=bilinmiyor')
    expect(responseUsageText({ model: 'm' })).toBeNull() // hiç veri yoksa satır yazılmaz
  })

  it('native Ollama alanları varsa yazılır, yoksa bilinmiyor', () => {
    const s = responseUsageText({ model: 'm', finishReason: 'stop', usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }, native: { prompt_eval_count: 10, eval_count: 2, done_reason: 'stop' } })!
    expect(s).toContain('prompt_eval_count=10')
    expect(s).toContain('done_reason=stop')
    const eksik = responseUsageText({ model: 'm', finishReason: 'stop', native: {} })!
    expect(eksik).toContain('prompt_eval_count=bilinmiyor')
  })

  it('parseOllamaNumCtx ETKİN num_ctx yi alır, azami context length i KARISTIRMAZ', () => {
    const cikti = 'Model\n    architecture        qwen35\n    context length      262144\n\n  Parameters\n    num_ctx             32768\n    temperature         1\n'
    expect(parseOllamaNumCtx(cikti)).toBe(32768)
    expect(parseOllamaNumCtx('context length 262144')).toBeNull() // tek başına azami değer num_ctx DEĞİL
  })
})
