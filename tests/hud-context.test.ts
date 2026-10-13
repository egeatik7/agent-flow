import { describe, expect, it } from 'vitest'
import { baglamKartiDurumuYap, baglamKartiOzet, baglamKartiYap, kartOlayiKabulEdilir, olcumYasiYaz, sunucuEtiketi, tokenYaz } from '../electron/hud-context'
import { BAGLAM_ESKI_MS, type BaglamOlcumu } from '../electron/local-context'

/**
 * 1.9.129 — BAĞLAM ÖLÇÜM KARTI. Kullanıcının istediği cümle: "Yüklü bağlam: 32.768 token".
 * Kural: dört kavram (azami / yapılandırılmış / yüklü / istek num_ctx) AYRI gösterilir; ölçüm yoksa
 * "bilinmiyor", eskiyse "eski ölçüm"; GERÇEK giriş tokenı ile TAHMİN karıştırılmaz; yapılandırılmış
 * pencere "yüklü" diye sunulmaz ve açık kanıt olmadan kırpma iddiası üretilmez.
 */
const UC = 'http://127.0.0.1:11434/v1/chat/completions'
const SIMDI = 1_800_000_000_000

const tamOlcum = (ek: Partial<BaglamOlcumu> = {}): BaglamOlcumu => ({
  azamiKapasite: 262144,
  yapilandirilmisPencere: 65536,
  calisanPencere: 32768,
  olcumAt: SIMDI - 3_000,
  statikAt: SIMDI - 3_000,
  ...ek,
})

describe('1) ana satır kullanıcının istediği cümledir', () => {
  it('yüklü pencere 32.768 ise tam olarak "Yüklü bağlam: 32.768 token" yazılır', () => {
    const k = baglamKartiYap({ model: 'qwen3.5-64k:latest', sunucu: UC, olcum: tamOlcum(), simdi: SIMDI })
    expect(k.yukluMetin).toBe('Yüklü bağlam: 32.768 token')
    expect(k.yukluToken).toBe(32768)
    expect(k.satirlar[0]).toBe('Yüklü bağlam: 32.768 token')
    expect(k.durum).toBe('taze')
    expect(tokenYaz(32768)).toBe('32.768')
    expect(tokenYaz(262144)).toBe('262.144')
  })
})

describe('2) ölçüm yoksa "bilinmiyor", eskiyse "eski ölçüm"', () => {
  it('hiç ölçüm yoksa bilinmiyor; uydurma pencere YAZILMAZ', () => {
    const k = baglamKartiYap({ model: 'm', sunucu: UC, olcum: undefined, simdi: SIMDI })
    expect(k.yukluMetin).toBe('Yüklü bağlam: bilinmiyor')
    expect(k.durum).toBe('yok')
    expect(k.bilinmiyor).toBe(true)
    expect(k.yukluToken).toBeNull()
    expect(k.satirlar.join(' ')).toContain('Ölçüm: bilinmiyor')
    // Açık sunucu kanıtı yokken kırpma/aşım iddiası ÜRETİLMEZ; kart bunu rozetle açıkça söyler.
    expect(k.rozet).toBe('ölçülemedi · kırpma iddiası yok')
    const metin = k.satirlar.join(' ')
    expect(metin).not.toContain('KIRPILDI')
    expect(metin).not.toContain('sığmıyor')
    expect(metin).not.toContain('aşım')
  })

  it('damgası olmayan kayıt "ölçüm var" sayılmaz: durum yok', () => {
    const k = baglamKartiYap({ model: 'm', sunucu: UC, olcum: { azamiKapasite: 262144, olcumAt: 0 }, simdi: SIMDI })
    expect(k.durum).toBe('yok')
    expect(k.eski).toBe(true) // damgasız ölçüm taze değildir
  })

  it('eski ölçüm ayrı durumdur ve kart bunu açıkça yazar', () => {
    const k = baglamKartiYap({ model: 'm', sunucu: UC, olcum: tamOlcum({ olcumAt: SIMDI - BAGLAM_ESKI_MS - 60_000 }), simdi: SIMDI })
    expect(k.durum).toBe('eski')
    expect(k.eski).toBe(true)
    expect(k.rozet).toBe('eski ölçüm')
    expect(k.satirlar.join(' ')).toContain('eski ölçüm')
    expect(k.yukluMetin).toBe('Yüklü bağlam: 32.768 token') // pencere yine dürüstçe yazılır
    expect(baglamKartiOzet(k)).toContain('eski ölçüm')
  })
})

describe('3) dört kavram AYRI gösterilir (yapılandırılmış "yüklü" diye sunulmaz)', () => {
  it('azami / yapılandırılmış / yüklü / istek num_ctx ayrı alanlardır', () => {
    const k = baglamKartiYap({ model: 'm', sunucu: UC, olcum: tamOlcum({ istekNumCtx: 16384 }), simdi: SIMDI })
    expect(k.azamiToken).toBe(262144)
    expect(k.yapilandirilmisToken).toBe(65536)
    expect(k.yukluToken).toBe(32768)
    expect(k.istekNumCtx).toBe(16384)
    // Etkin pencere KAYNAĞI istektir; yüklü pencere alanı yine gerçek yüklü değeri taşır.
    expect(k.kaynak).toBe('istek')
    const metin = k.satirlar.join(' ')
    expect(metin).toContain('Azami kapasite: 262.144')
    expect(metin).toContain('Yapılandırılmış pencere: 65.536')
    expect(metin).toContain('Gönderilen num_ctx: 16.384')
  })

  it('num_ctx gönderilmiyorsa "gönderilmiyor" yazılır, uydurma değer yazılmaz', () => {
    const k = baglamKartiYap({ model: 'm', sunucu: UC, olcum: tamOlcum(), simdi: SIMDI })
    expect(k.istekNumCtx).toBeNull()
    expect(k.satirlar.join(' ')).toContain('Gönderilen num_ctx: gönderilmiyor')
  })

  it('yüklü pencere yoksa yapılandırılmış değer "yüklü" diye GÖSTERİLMEZ', () => {
    const k = baglamKartiYap({ model: 'm', sunucu: UC, olcum: tamOlcum({ calisanPencere: undefined }), simdi: SIMDI })
    expect(k.yukluToken).toBeNull()
    expect(k.kaynak).toBe('yapilandirilmis')
    // Etkin pencere yapılandırılmıştır ama ana satır bunu "yüklü" demez.
    expect(k.yukluMetin).toBe('Yüklü bağlam: 65.536 token')
    expect(k.satirlar.join(' ')).toContain('Yapılandırılmış pencere: 65.536')
  })

  it('bilinmeyen alanlar "bilinmiyor" yazılır', () => {
    const k = baglamKartiYap({ model: 'm', sunucu: UC, olcum: { calisanPencere: 32768, olcumAt: SIMDI }, simdi: SIMDI })
    const metin = k.satirlar.join(' ')
    expect(metin).toContain('Azami kapasite: bilinmiyor')
    expect(metin).toContain('Yapılandırılmış pencere: bilinmiyor')
  })
})

describe('4) GERÇEK giriş tokenı ile TAHMİN açıkça ayrıdır', () => {
  it('ölçülen giriş "ölçüm", tahmin "TAHMİN" etiketiyle ayrı yazılır', () => {
    const k = baglamKartiYap({ model: 'm', sunucu: UC, olcum: tamOlcum({ girisToken: 8123 }), tahminiToken: 7400, simdi: SIMDI })
    expect(k.girisToken).toBe(8123)
    expect(k.tahminiToken).toBe(7400)
    const metin = k.satirlar.join(' ')
    expect(metin).toContain('Giriş: 8.123 token (ölçüm)')
    expect(metin).toContain('tahmini 7.400 token (TAHMİN)')
  })
  it('gerçek sayı yoksa "bilinmiyor"; tahmin tek başına gerçek sayı sayılmaz', () => {
    const k = baglamKartiYap({ model: 'm', sunucu: UC, olcum: tamOlcum(), tahminiToken: 7400, simdi: SIMDI })
    expect(k.girisToken).toBeNull()
    const metin = k.satirlar.join(' ')
    expect(metin).toContain('Giriş: bilinmiyor')
    expect(metin).toContain('tahmini 7.400 token (TAHMİN)')
  })
})

describe('5) cevap sonrası tazelik "kesin pencere kanıtı" diye sunulmaz', () => {
  it('cevapAt > olcumAt ise kart bunu ayrıca söyler', () => {
    const k = baglamKartiYap({ model: 'm', sunucu: UC, olcum: tamOlcum({ olcumAt: SIMDI - 60_000, cevapAt: SIMDI - 1_000 }), simdi: SIMDI })
    expect(k.cevapSonrasi).toBe(true)
    expect(k.satirlar.join(' ')).toContain('cevap sonrası tazelendi')
    expect(k.satirlar.join(' ')).toContain('önceki isteğin kesin pencere kanıtı değil')
    expect(k.durum).toBe('taze') // yaş EN YENİ kanıta göre hesaplanır
  })
})

describe('6) gecikmiş ESKİ ölçüm yeni kartı ezmez (sıra koruması)', () => {
  it('kartın son cevap ölçümünden eski damgalı cevap olayı REDDEDİLİR', () => {
    const son = { model: 'yeni-model', sunucu: 'http://yeni:11434', cevapAt: 5_000 }
    expect(kartOlayiKabulEdilir(son, { asama: 'cevap', damga: 4_999 })).toBe(false) // eski modelin gecikmiş sondası
    expect(kartOlayiKabulEdilir(son, { asama: 'cevap', damga: 5_000 })).toBe(true)
    expect(kartOlayiKabulEdilir(son, { asama: 'cevap', damga: 5_001 })).toBe(true)
  })

  it('ilk olay ve istek aşaması her zaman kabul edilir; damgasız cevap kıyaslanamaz', () => {
    expect(kartOlayiKabulEdilir(undefined, { asama: 'cevap', damga: 1 })).toBe(true)
    const son = { model: 'm', sunucu: 'http://s:1', cevapAt: 5_000 }
    expect(kartOlayiKabulEdilir(son, { asama: 'istek', damga: 1 })).toBe(true)
    expect(kartOlayiKabulEdilir(son, { asama: 'cevap', damga: 0 })).toBe(true)
  })
})

describe('7) kart DURUMU: sıra koruması, temizleme ve yeni koşuya taşınmama', () => {
  const istek = { model: 'm1', sunucu: 'http://a:1', asama: 'istek' as const, olcum: { calisanPencere: 32768, olcumAt: SIMDI }, simdi: SIMDI }

  it('gecikmiş ESKİ cevap ölçümü yeni kartı EZMEZ; yeni damga kabul edilir', () => {
    const d = baglamKartiDurumuYap()
    d.isle(istek)
    d.isle({ model: 'm1', sunucu: 'http://a:1', asama: 'cevap', olcum: { calisanPencere: 8192, olcumAt: SIMDI + 1000, cevapAt: SIMDI + 1000 }, simdi: SIMDI + 1000 })
    expect(d.kart()?.yukluToken).toBe(8192)
    // ÖNCEKİ modelin gecikmiş sondası (daha eski damga): reddedilir, kart 8192'de kalır.
    const geç = d.isle({ model: 'eski-model', sunucu: 'http://b:2', asama: 'cevap', olcum: { calisanPencere: 4096, olcumAt: SIMDI + 500, cevapAt: SIMDI + 500 }, simdi: SIMDI + 2000 })
    expect(geç).toBeNull()
    expect(d.kart()?.yukluToken).toBe(8192)
    expect(d.kart()?.model).toBe('m1')
  })

  it('temizle() kart ve sıra durumunu bırakır; ikinci çağrı false döner', () => {
    const d = baglamKartiDurumuYap()
    expect(d.temizle()).toBe(false) // temizlenecek bir şey yok
    d.isle(istek)
    expect(d.kart()).toBeDefined()
    expect(d.temizle()).toBe(true)
    expect(d.kart()).toBeUndefined()
    expect(d.temizle()).toBe(false)
    // Temizlendikten sonra yeni koşunun ESKİ damgalı olmayan olayı yine kabul edilir.
    expect(d.isle({ ...istek, simdi: SIMDI + 10_000 })).not.toBeNull()
  })
})

describe('8) biçimlendirme yardımcıları', () => {
  it('ölçüm yaşı okunur; damga yoksa "ölçüm zamanı bilinmiyor"', () => {
    expect(olcumYasiYaz({ olcumAt: SIMDI - 500 }, SIMDI)).toBe('az önce ölçüldü')
    expect(olcumYasiYaz({ olcumAt: SIMDI - 12_000 }, SIMDI)).toBe('12 sn önce ölçüldü')
    expect(olcumYasiYaz({ olcumAt: SIMDI - 204_000 }, SIMDI)).toBe('3,4 dk önce ölçüldü')
    expect(olcumYasiYaz({}, SIMDI)).toBe('ölçüm zamanı bilinmiyor')
    expect(olcumYasiYaz(undefined, SIMDI)).toBe('ölçüm zamanı bilinmiyor')
  })

  it('sunucu etiketi YALNIZ host verir: yol ve kimlik bilgisi yazılmaz', () => {
    expect(sunucuEtiketi('http://127.0.0.1:11434/v1/chat/completions')).toBe('127.0.0.1:11434')
    expect(sunucuEtiketi('http://kullanici:gizli@10.0.0.5:1234/ollama/v1/chat/completions')).toBe('10.0.0.5:1234')
    expect(sunucuEtiketi('')).toBe('')
  })
})
