import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baglamOnbelleginiTemizle, etkinPencere } from '../electron/local-context'
import { bekleyenSorguVar, olcumuTazele, ollamaKoku, olcumFor, pencereTokenFor } from '../electron/local-context-probe'

/**
 * Ölçüm sondası: yalnız GERÇEK sunucuya sorar (sabit localhost/CLI yok), asenkron + zaman aşımlı,
 * başarısızlıkta LLM çağrısını bozmaz, eşzamanlı sorguları birleştirir, boş /api/ps'i "yüklü değil" sayar.
 */
const UC = 'http://127.0.0.1:11500/v1/chat/completions'
const KOK = 'http://127.0.0.1:11500'

const showGovde = (numCtx: number, azami: number) => JSON.stringify({ parameters: `num_ctx ${numCtx}\n`, model_info: { 'guiowl.context_length': azami } })
const psGovde = (model: string, pencere: number) => JSON.stringify({ models: [{ name: model, context_length: pencere }] })

/** fetch taklidi: yol → gövde eşlemesi. */
function sahteFetch(esleme: Record<string, string | null>) {
  return vi.fn(async (url: string, init?: { method?: string }) => {
    const yol = (() => { try { return new URL(String(url)).pathname } catch { return String(url) } })()
    const anahtar = init?.method === 'POST' ? `POST ${yol}` : yol
    const govde = esleme[anahtar]
    if (govde === null || govde === undefined) return { ok: false, status: 500, text: async () => '' }
    return { ok: true, status: 200, text: async () => govde }
  })
}

beforeEach(() => baglamOnbelleginiTemizle())
afterEach(() => vi.unstubAllGlobals())

describe('sonda: adres ve ayrıştırma', () => {
  it('köken sohbet ucundan türetilir; sabit localhost/CLI kullanılmaz', () => {
    expect(ollamaKoku(UC)).toBe(KOK)
    expect(ollamaKoku('http://192.168.1.50:11434/v1/chat/completions')).toBe('http://192.168.1.50:11434')
    expect(ollamaKoku('http://192.168.1.50:11434')).toBe('http://192.168.1.50:11434')
    expect(ollamaKoku('')).toBe('')
  })
})

describe('sonda: gerçek ölçüm ve kaynak ayrımı', () => {
  it('azami 262144 / yapılandırılmış 65536 / YÜKLÜ 32768 ayrı tutulur ve pencere YÜKLÜ olandır', async () => {
    vi.stubGlobal('fetch', sahteFetch({ '/api/ps': psGovde('gui-owl:latest', 32768), 'POST /api/show': showGovde(65536, 262144) }))
    await olcumuTazele('gui-owl:latest', UC, 1_000)
    const o = olcumFor('gui-owl:latest', UC)!
    expect(o.azamiKapasite).toBe(262144)
    expect(o.yapilandirilmisPencere).toBe(65536)
    expect(o.calisanPencere).toBe(32768)
    expect(pencereTokenFor('gui-owl:latest', UC)).toBe(32768)
  })

  it('BOŞ /api/ps = model yüklü değil: yüklü pencere GEÇERSİZ, yapılandırılmış değere düşülür', async () => {
    vi.stubGlobal('fetch', sahteFetch({ '/api/ps': JSON.stringify({ models: [] }), 'POST /api/show': showGovde(65536, 262144) }))
    await olcumuTazele('gui-owl:latest', UC, 1_000)
    expect(olcumFor('gui-owl:latest', UC)!.calisanPencere).toBeUndefined()
    expect(pencereTokenFor('gui-owl:latest', UC)).toBe(65536) // yapılandırılmış, "yüklü" diye sunulmaz
  })

  it('aynı model farklı pencereyle yeniden yüklendiğinde yeni değer alınır', async () => {
    vi.stubGlobal('fetch', sahteFetch({ '/api/ps': psGovde('gui-owl:latest', 32768), 'POST /api/show': showGovde(65536, 262144) }))
    await olcumuTazele('gui-owl:latest', UC, 1_000)
    vi.stubGlobal('fetch', sahteFetch({ '/api/ps': psGovde('gui-owl:latest', 8192) }))
    await olcumuTazele('gui-owl:latest', UC, 2_000)
    expect(olcumFor('gui-owl:latest', UC)!.calisanPencere).toBe(8192)
    expect(etkinPencere(olcumFor('gui-owl:latest', UC))).toBe(8192)
  })

  it('aynı model iki farklı sunucuda karışmaz', async () => {
    const diger = 'http://10.0.0.5:11434/v1/chat/completions'
    vi.stubGlobal('fetch', sahteFetch({ '/api/ps': psGovde('gui-owl:latest', 32768) }))
    await olcumuTazele('gui-owl:latest', UC, 1_000)
    vi.stubGlobal('fetch', sahteFetch({ '/api/ps': psGovde('gui-owl:latest', 8192) }))
    await olcumuTazele('gui-owl:latest', diger, 1_000)
    expect(pencereTokenFor('gui-owl:latest', UC)).toBe(32768)
    expect(pencereTokenFor('gui-owl:latest', diger)).toBe(8192)
  })
})

describe('sonda: başarısızlık LLM çağrısını BOZMAZ', () => {
  it('zaman aşımı/iptal ve HTTP hatası: throw yok, ölçüm bilinmiyor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('aborted') }))
    await expect(olcumuTazele('m', UC, 1_000)).resolves.toBeUndefined()
    expect(pencereTokenFor('m', UC)).toBeNull()
  })

  it('bozuk JSON ve Ollama olmayan yanıt: uydurma yok, bilinmiyor', async () => {
    vi.stubGlobal('fetch', sahteFetch({ '/api/ps': '{bozuk', 'POST /api/show': '<html>merhaba</html>' }))
    await olcumuTazele('m', UC, 1_000)
    expect(pencereTokenFor('m', UC)).toBeNull()
    expect(olcumFor('m', UC)!.azamiKapasite).toBeUndefined()
  })

  it('yenileme başarısızsa ESKİ statik bilgi korunur ama yüklü pencere temizlenir', async () => {
    vi.stubGlobal('fetch', sahteFetch({ '/api/ps': psGovde('m', 32768), 'POST /api/show': showGovde(65536, 262144) }))
    await olcumuTazele('m', UC, 1_000)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await olcumuTazele('m', UC, 2_000)
    const o = olcumFor('m', UC)!
    expect(o.calisanPencere).toBeUndefined() // eski yüklü değer GÜNCEL sayılmaz
    expect(o.yapilandirilmisPencere).toBe(65536) // statik bilgi durur
    expect(o.statikAt).toBe(1_000) // ve "güncel" damgası ilerlemez
  })
})

describe('sonda: eşzamanlı sorgular birleşir', () => {
  it('aynı model+sunucu için tek sorgu yapılır', async () => {
    const cagri = sahteFetch({ '/api/ps': psGovde('m', 32768), 'POST /api/show': showGovde(65536, 262144) })
    vi.stubGlobal('fetch', cagri)
    const a = olcumuTazele('m', UC, 1_000)
    const b = olcumuTazele('m', UC, 1_000)
    expect(bekleyenSorguVar(KOK, 'm')).toBe(true)
    await Promise.all([a, b])
    expect(cagri).toHaveBeenCalledTimes(2) // 1 /api/ps + 1 /api/show (birleşti)
    expect(bekleyenSorguVar(KOK, 'm')).toBe(false)
  })
})
