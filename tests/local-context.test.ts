import { beforeEach, describe, expect, it } from 'vitest'
import { baglamYenilenmeli, pencereKaynagi, statikYenilenmeli, baglamOlcumu, baglamOlcumunuKaydet, baglamOnbelleginiTemizle, baglamOnbellekBoyu, etkinPencere, parseOllamaPs, parseOllamaShow } from '../electron/local-context'

/**
 * Yerel bağlam ölçümü (adım 1) — üç kavram ayrı: azami kapasite / yapılandırılmış num_ctx / çalışan pencere.
 * Hiçbiri doğrulanamıyorsa "bilinmiyor" (65536 VARSAYILMAZ). Model adına özel çözüm yok.
 */
const SUNUCU = 'http://localhost:11434'
beforeEach(() => baglamOnbelleginiTemizle())

const showJson = (numCtx: number, azami: number) => ({
  parameters: `num_ctx             ${numCtx}\ntemperature         1\ntop_k               20\n`,
  model_info: { 'general.architecture': 'qwen35', 'qwen35.context_length': azami, 'general.parameter_count': 9_000_000_000 },
})

describe('1) /api/show ayrıştırma: azami kapasite ile yapılandırılmış pencere AYRI', () => {
  it('num_ctx yapılandırılmış penceredir; context_length azami kapasitedir', () => {
    const o = parseOllamaShow(showJson(65536, 262144))
    expect(o.yapilandirilmisPencere).toBe(65536)
    expect(o.azamiKapasite).toBe(262144)
  })

  it('num_ctx yoksa yalnız azami kapasite döner (uydurma yok)', () => {
    const o = parseOllamaShow({ parameters: 'temperature 1\n', model_info: { 'llama.context_length': 131072 } })
    expect(o.yapilandirilmisPencere).toBeUndefined()
    expect(o.azamiKapasite).toBe(131072)
  })

  it('bozuk/eksik cevapta hiçbir alan üretilmez', () => {
    expect(parseOllamaShow(undefined)).toEqual({})
    expect(parseOllamaShow({ parameters: 42, model_info: null })).toEqual({})
  })

  it('herhangi bir mimari adı desteklenir (Qwen/GUI-Owl adına özel çözüm YOK)', () => {
    expect(parseOllamaShow({ model_info: { 'guiowl.context_length': 32768 } }).azamiKapasite).toBe(32768)
    expect(parseOllamaShow({ model_info: { 'phi3.context_length': 4096 } }).azamiKapasite).toBe(4096)
  })
})

describe('2) /api/ps: çalışan pencerenin gerçek değeri', () => {
  it('çalışan modelin context_length i bulunur (etiket farkı önemsiz)', () => {
    const ps = { models: [{ name: 'gui-owl:latest', context_length: 32768 }, { name: 'qwen3.5-64k:latest', context_length: 65536 }] }
    expect(parseOllamaPs(ps, 'gui-owl:latest')).toBe(32768)
    expect(parseOllamaPs(ps, 'qwen3.5-64k:latest')).toBe(65536)
    expect(parseOllamaPs(ps, 'yuklu-degil:latest')).toBeUndefined()
    expect(parseOllamaPs({}, 'x')).toBeUndefined()
  })
})

describe('3) etkin pencere sırası ve "bilinmiyor"', () => {
  it('istek num_ctx → çalışan → yapılandırılmış sırası uygulanır', () => {
    expect(etkinPencere({ istekNumCtx: 8192, calisanPencere: 32768, yapilandirilmisPencere: 65536, olcumAt: 1 })).toBe(8192)
    expect(etkinPencere({ calisanPencere: 32768, yapilandirilmisPencere: 65536, olcumAt: 1 })).toBe(32768)
    expect(etkinPencere({ yapilandirilmisPencere: 65536, olcumAt: 1 })).toBe(65536)
  })

  it('azami kapasite etkin pencere YERİNE GEÇMEZ', () => {
    expect(etkinPencere({ azamiKapasite: 262144, olcumAt: 1 })).toBeNull()
  })

  it('hiçbir değer yoksa bilinmiyor (65536 VARSAYILMAZ)', () => {
    expect(etkinPencere(undefined)).toBeNull()
    expect(etkinPencere({ olcumAt: 1 })).toBeNull()
    expect(etkinPencere({ azamiKapasite: 262144, olcumAt: 1 })).toBeNull()
  })
})

describe('4) önbellek: model+SUNUCU bazında, ağ isteği tekrarı yok', () => {
  it('aynı model farklı sunucuda ayrı ölçüm tutar', () => {
    baglamOlcumunuKaydet('gui-owl:latest', SUNUCU, { calisanPencere: 32768, olcumAt: 1 })
    baglamOlcumunuKaydet('gui-owl:latest', 'http://diger:11434', { calisanPencere: 8192, olcumAt: 1 })
    expect(etkinPencere(baglamOlcumu('gui-owl:latest', SUNUCU))).toBe(32768)
    expect(etkinPencere(baglamOlcumu('gui-owl:latest', 'http://diger:11434'))).toBe(8192)
    expect(baglamOnbellekBoyu()).toBe(2)
  })

  it('model değişince yalnız o modelin ölçümü tazelenir; tümü temizlenebilir', () => {
    baglamOlcumunuKaydet('qwen3.5-64k:latest', SUNUCU, { yapilandirilmisPencere: 65536, olcumAt: 1 })
    baglamOlcumunuKaydet('gui-owl:latest', SUNUCU, { yapilandirilmisPencere: 32768, olcumAt: 1 })
    baglamOnbelleginiTemizle('qwen3.5-64k:latest', SUNUCU)
    expect(baglamOlcumu('qwen3.5-64k:latest', SUNUCU)).toBeUndefined()
    expect(etkinPencere(baglamOlcumu('gui-owl:latest', SUNUCU))).toBe(32768)
    baglamOnbelleginiTemizle()
    expect(baglamOnbellekBoyu()).toBe(0)
  })
})

describe('5) farklı modellerin kapasiteleri karışmaz', () => {
  it('aynı koşuda Qwen 65536, GUI-Owl 32768', () => {
    baglamOlcumunuKaydet('qwen3.5-64k:latest', SUNUCU, { ...parseOllamaShow(showJson(65536, 262144)), olcumAt: 1 })
    baglamOlcumunuKaydet('gui-owl:latest', SUNUCU, { ...parseOllamaShow({ parameters: 'num_ctx 32768\n', model_info: { 'guiowl.context_length': 262144 } }), olcumAt: 1 })
    expect(etkinPencere(baglamOlcumu('qwen3.5-64k:latest', SUNUCU))).toBe(65536)
    expect(etkinPencere(baglamOlcumu('gui-owl:latest', SUNUCU))).toBe(32768)
  })
})

describe('6) boş /api/ps, kaldırılma ve pencere değişimi eski değeri GÜNCEL bırakmaz', () => {
  const olcum = { calisanPencere: 32768, yapilandirilmisPencere: 65536, olcumAt: 1_000 }
  it('BOŞ liste = model yüklü değil -> yenilenmeli (eski kontrol bunu kaçırıyordu)', () => {
    expect(baglamYenilenmeli(olcum, 'm', { durum: 'ok', calisanlar: [] }, 2_000)).toBe(true)
  })
  it('sorgu HATASI ile boş liste AYRI: ikisi de yenilenmeli ama sebep farklı', () => {
    expect(baglamYenilenmeli(olcum, 'm', { durum: 'hata' }, 2_000)).toBe(true)
    expect(baglamYenilenmeli(olcum, 'm', { durum: 'ok', calisanlar: [{ model: 'm', pencere: 32768 }] }, 2_000)).toBe(false)
  })
  it('aynı model FARKLI pencereyle yeniden yüklenirse yenilenir', () => {
    expect(baglamYenilenmeli(olcum, 'm', { durum: 'ok', calisanlar: [{ model: 'm', pencere: 8192 }] }, 2_000)).toBe(true)
  })
  it('statik bilgi daha uzun ömürlü: 5 dk sonra statik YENİLENMEZ, 30 dk sonra yenilenir', () => {
    const s = { yapilandirilmisPencere: 65536, statikAt: 1, olcumAt: 1 }
    expect(statikYenilenmeli(s, 6 * 60_000 + 1)).toBe(false)
    expect(statikYenilenmeli(s, 31 * 60_000)).toBe(true)
  })
})

describe('7) pencerenin KAYNAĞI taşınır; istenen değer "yüklü" diye sunulmaz', () => {
  it('sıra ve kaynak etiketi', () => {
    expect(pencereKaynagi({ istekNumCtx: 8192, calisanPencere: 32768, yapilandirilmisPencere: 65536, olcumAt: 1 })).toEqual({ token: 8192, kaynak: 'istek' })
    expect(pencereKaynagi({ calisanPencere: 32768, yapilandirilmisPencere: 65536, olcumAt: 1 })).toEqual({ token: 32768, kaynak: 'yuklu' })
    expect(pencereKaynagi({ yapilandirilmisPencere: 65536, olcumAt: 1 })).toEqual({ token: 65536, kaynak: 'yapilandirilmis' })
  })
  it('azami kapasite pencere yerine GEÇMEZ; hiçbiri yoksa bilinmiyor', () => {
    expect(pencereKaynagi({ azamiKapasite: 262144, olcumAt: 1 })).toEqual({ token: null, kaynak: 'bilinmiyor' })
    expect(pencereKaynagi(undefined)).toEqual({ token: null, kaynak: 'bilinmiyor' })
  })
})
