/**
 * BAĞLAM ÖLÇÜM KARTI — yalnız GÖSTERİM. Hiçbir istek, prompt, ayar veya fallback bu modül yüzünden
 * değişmez; burada üretilen tek şey okunabilir bir veri nesnesidir (`BaglamKarti`).
 *
 * Kart, günlük METNİNDEN AYRIŞTIRILMAZ: main süreci ölçümü `local-context.ts` önbelleğinden okur ve
 * nesne olarak HUD penceresine, oradan da izleyici (masaüstü/Android) durumuna geçer.
 *
 * DÖRT AYRI KAVRAM KARIŞTIRILMAZ (uydurma yok, eksik alan "bilinmiyor"):
 *   · yuklu        → /api/ps çalışan örneğin GERÇEK penceresi ("Yüklü bağlam")
 *   · azami        → /api/show model_info.<mimari>.context_length (desteklenen AZAMİ; pencere DEĞİL)
 *   · yapilandirilmis → /api/show parameters içindeki num_ctx (yapılandırılmış pencere)
 *   · istekNumCtx  → istek GÖVDESİNDE gerçekten gönderilen num_ctx (gönderilmiyorsa "gönderilmiyor")
 * Yapılandırılmış pencere "yüklü" diye gösterilmez ve açık sunucu kanıtı olmadan kırpma iddiası
 * üretilmez; bu modül kırpma/aşım kararı VERMEZ.
 */
import { cevapSonrasiTazeleme, olcumEskiMi, pencereKaynagi, type BaglamOlcumu } from './local-context'

export type BaglamKarti = {
  /** Ölçümün konusu: gerçek model adı ve sunucu (kimlik bilgisi DEĞİL; yalnız host). */
  model: string
  sunucu: string
  /** /api/ps: çalışan örneğin yüklü penceresi (yoksa bilinmiyor). */
  yukluToken: number | null
  /** /api/show: desteklenen azami bağlam. */
  azamiToken: number | null
  /** /api/show: yapılandırılmış num_ctx. */
  yapilandirilmisToken: number | null
  /** İstek gövdesinde gerçekten gönderilen num_ctx (null = gönderilmiyor/bilinmiyor). */
  istekNumCtx: number | null
  /** Etkin pencerenin KAYNAĞI: istek | yuklu | yapilandirilmis | bilinmiyor. */
  kaynak: 'istek' | 'yuklu' | 'yapilandirilmis' | 'bilinmiyor'
  /** Kartın ana satırı: "Yüklü bağlam: 32.768 token". Ölçüm yoksa "bilinmiyor". */
  yukluMetin: string
  /** ÜÇ DURUM AYRI: 'yok' = hiç ölçüm yok · 'eski' = ölçüm var ama bayat · 'taze' = güncel ölçüm. */
  durum: 'yok' | 'eski' | 'taze'
  /**
   * Kısa durum rozeti (kartın üst satırında gösterilir). Pencere ölçülemediğinde açıkça
   * "ölçülemedi · kırpma iddiası yok" yazar: sistem başarıyı/kesmeyi YARGILAMAZ, eksik kanıtı söyler.
   */
  rozet: string
  /** Ölçüm hiç yok mu (pencere bilinmiyor ve damga yok). */
  bilinmiyor: boolean
  /** Ölçüm eski mi (BAGLAM_ESKI_MS'ten yaşlı ya da damgasız). */
  eski: boolean
  /** Ölçüm cevaptan SONRA tazelendi: önceki isteğin kesin pencere kanıtı DEĞİL. */
  cevapSonrasi: boolean
  /** Ölçümün alındığı an (ms) veya 0. */
  olcumAt: number
  /** Kart için yaş metni: "3,2 dk önce ölçüldü" / "ölçüm zamanı bilinmiyor". */
  olcumYasi: string
  /** Sunucunun bildirdiği GERÇEK giriş token sayısı (yoksa null). */
  girisToken: number | null
  /** Tahmini (TAHMİN) giriş token sayısı. */
  tahminiToken: number | null
  /** Kartta gösterilecek satırlar (masaüstü ve telefon aynı nesneyi kullanır). */
  satirlar: string[]
}

/** Binlik ayraç: 32768 → "32.768" (Türkçe biçim). */
export function tokenYaz(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return 'bilinmiyor'
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Sunucu etiketi: YALNIZ host:port — yol, sorgu ve kimlik bilgisi yazılmaz. */
export function sunucuEtiketi(ucNokta: string): string {
  const ham = String(ucNokta ?? '').trim()
  if (!ham) return ''
  try {
    return new URL(ham).host
  } catch {
    return ham.replace(/[/?#].*$/, '')
  }
}

/** Ölçüm yaşı: "az önce" / "12 sn önce" / "3,4 dk önce" / "2,1 sa önce". */
export function olcumYasiYaz(o: { olcumAt?: number; cevapAt?: number } | undefined, simdi: number): string {
  const kanit = Math.max(Number(o?.olcumAt) || 0, Number(o?.cevapAt) || 0)
  if (kanit <= 0) return 'ölçüm zamanı bilinmiyor'
  const fark = Math.max(0, simdi - kanit)
  if (fark < 2000) return 'az önce ölçüldü'
  const sn = fark / 1000
  if (sn < 60) return `${sn.toFixed(0)} sn önce ölçüldü`
  const dk = sn / 60
  if (dk < 60) return `${dk.toFixed(1).replace('.', ',')} dk önce ölçüldü`
  return `${(dk / 60).toFixed(1).replace('.', ',')} sa önce ölçüldü`
}

export type BaglamKartiGirdi = {
  model: string
  sunucu: string
  olcum?: BaglamOlcumu
  /** İstek GÖVDESİNDE gerçekten gönderilen num_ctx (verilmezse önbellekten okunur). */
  istekNumCtx?: number | null
  /** Asgari giriş bilgisi: "gönderilen bağlam penceresi" bilinmiyorsa buradan "bilinmiyor" yazılır. */
  girisToken?: number | null
  tahminiToken?: number | null
  simdi: number
}

/** Ölçüm nesnesinden kart nesnesi üretir. `olcum` yoksa kart yine döner: pencere "bilinmiyor". */
export function baglamKartiYap(g: BaglamKartiGirdi): BaglamKarti {
  const o = g.olcum
  const kaynak = pencereKaynagi(o)
  const yukluToken = typeof o?.calisanPencere === 'number' && o.calisanPencere > 0 ? o.calisanPencere : null
  const azamiToken = typeof o?.azamiKapasite === 'number' && o.azamiKapasite > 0 ? o.azamiKapasite : null
  const yapilandirilmisToken = typeof o?.yapilandirilmisPencere === 'number' && o.yapilandirilmisPencere > 0 ? o.yapilandirilmisPencere : null
  const istekNumCtxHam = g.istekNumCtx !== undefined ? g.istekNumCtx : o?.istekNumCtx
  const istekNumCtx = typeof istekNumCtxHam === 'number' && istekNumCtxHam > 0 ? istekNumCtxHam : null
  const bilinmiyor = kaynak.token === null
  // "Ölçüm yok" ile "ölçüm var ama eski" AYRI durumlardır; hiç damga yoksa ölçüm yoktur.
  const damgaVar = Math.max(Number(o?.olcumAt) || 0, Number(o?.cevapAt) || 0) > 0
  const eski = olcumEskiMi(o, g.simdi)
  const durum: 'yok' | 'eski' | 'taze' = !o || !damgaVar ? 'yok' : eski ? 'eski' : 'taze'
  const cevapSonrasi = cevapSonrasiTazeleme(o)
  const girisToken = typeof o?.girisToken === 'number' && o.girisToken >= 0 ? o.girisToken : (typeof g.girisToken === 'number' ? g.girisToken : null)
  const tahminiToken = typeof g.tahminiToken === 'number' && Number.isFinite(g.tahminiToken) ? Math.round(g.tahminiToken) : null

  // ANA SATIR yalnız gerçekten yüklü pencereyi söyler. İsteğin num_ctx'i ve yapılandırılmış
  // pencere kendi satırlarındadır; ikisi de "yüklü" diye yazılmaz.
  const yukluMetin = yukluToken === null
    ? 'Yüklü bağlam: bilinmiyor'
    : `Yüklü bağlam: ${tokenYaz(yukluToken)} token`

  const satirlar = [yukluMetin]
  satirlar.push(`Azami kapasite: ${tokenYaz(azamiToken)} (desteklenen sınır)`)
  satirlar.push(`Yapılandırılmış pencere: ${tokenYaz(yapilandirilmisToken)}`)
  satirlar.push(istekNumCtx === null ? 'Gönderilen num_ctx: gönderilmiyor' : `Gönderilen num_ctx: ${tokenYaz(istekNumCtx)}`)
  satirlar.push(`Giriş: ${girisToken === null ? 'bilinmiyor' : `${tokenYaz(girisToken)} token (ölçüm)`} · tahmini ${tahminiToken === null ? 'bilinmiyor' : tokenYaz(tahminiToken)} token (TAHMİN)`)
  satirlar.push(durum === 'yok' ? 'Ölçüm: bilinmiyor' : durum === 'eski' ? `Ölçüm: eski ölçüm · ${olcumYasiYaz(o, g.simdi)}` : `Ölçüm: ${olcumYasiYaz(o, g.simdi)}`)
  if (cevapSonrasi) satirlar.push('Bu kayıt cevap sonrası tazelendi; önceki isteğin kesin pencere kanıtı değil')

  const olcumYasi = olcumYasiYaz(o, g.simdi)
  // Rozet: durumu tek bakışta söyler; ölçüm yoksa kırpma iddiası ÜRETİLMEDİĞİNİ açıkça yazar.
  const rozet = durum === 'yok'
    ? bilinmiyor ? 'ölçülemedi · kırpma iddiası yok' : 'bilinmiyor'
    : durum === 'eski' ? 'eski ölçüm' : olcumYasi

  return {
    model: String(g.model ?? ''),
    sunucu: String(g.sunucu ?? ''),
    yukluToken,
    azamiToken,
    yapilandirilmisToken,
    istekNumCtx,
    kaynak: kaynak.kaynak,
    yukluMetin,
    durum,
    rozet,
    bilinmiyor,
    eski,
    cevapSonrasi,
    olcumAt: Math.max(Number(o?.olcumAt) || 0, Number(o?.cevapAt) || 0),
    olcumYasi,
    girisToken,
    tahminiToken,
    satirlar,
  }
}

/** Kartın tek satırlık yoğun biçimi (kart şeridi/telefon ayrıntı satırı için). */
export function baglamKartiOzet(k: BaglamKarti | undefined): string {
  if (!k) return ''
  const parca = [k.yukluMetin]
  if (k.azamiToken !== null) parca.push(`azami ${tokenYaz(k.azamiToken)}`)
  if (k.yapilandirilmisToken !== null) parca.push(`yapılandırılmış ${tokenYaz(k.yapilandirilmisToken)}`)
  parca.push(k.istekNumCtx === null ? 'num_ctx gönderilmiyor' : `num_ctx ${tokenYaz(k.istekNumCtx)}`)
  if (k.girisToken !== null) parca.push(`giriş ${tokenYaz(k.girisToken)} (ölçüm)`)
  if (k.tahminiToken !== null) parca.push(`tahmini ${tokenYaz(k.tahminiToken)} (TAHMİN)`)
  parca.push(k.durum === 'yok' ? 'bilinmiyor' : k.durum === 'eski' ? 'eski ölçüm' : k.olcumYasi)
  return parca.join(' · ')
}

/** Kartı en son besleyen cevap ölçümü: hangi model/sunucu ve hangi damga. */
export type KartSiraDurumu = { model: string; sunucu: string; cevapAt: number }

/**
 * GECİKMİŞ ÖLÇÜM SIRALAMASI. İstek zincirinde ÖNCEKİ modelin/sunucunun sondası SONRA dönebilir; ya da
 * bir cevabın ardından başlatılan tazeleme, daha yeni bir ölçüm alındıktan sonra tamamlanabilir.
 * Böyle bir olay YENİ kartı EZMEMELİDİR. Kural: kartın en son cevap ölçümünden DAHA ESKİ damgalı bir
 * cevap olayı reddedilir. İstek aşaması olayları her zaman kabul edilir. Damgası olmayan (0) cevap
 * olayı kıyaslanacak kanıt taşımadığı için kabul edilir.
 */
export function kartOlayiKabulEdilir(son: KartSiraDurumu | undefined, olay: { asama: 'istek' | 'cevap'; damga: number }): boolean {
  if (!son || olay.asama !== 'cevap') return true
  if (!olay.damga) return true
  return olay.damga >= son.cevapAt
}

/**
 * KART DURUMU — main sürecinin tuttuğu tek parça durum. Ayrı bir nesne olmasının nedeni: koşu bitişi
 * kartı TEMİZLEMELİDİR ve bu çağrı, `runFlow` gibi ayrıştırılıp sınanan fonksiyonların içinden
 * yapılır; durum burada toplanınca ana süreç yalnız `temizle()` çağırır (test koşumları da aynı
 * yolu besleyebilir).
 */
export type BaglamKartiDurumu = {
  kart(): BaglamKarti | undefined
  /** Ölçüm olayını işler. Kart yayınlanacaksa `{ kart }` döner; sıra korumasına takılırsa null. */
  isle(olay: { model: string; sunucu: string; asama: 'istek' | 'cevap'; olcum?: BaglamOlcumu; istekNumCtx?: number | null; girisToken?: number | null; tahminiToken?: number | null; simdi: number }): { kart: BaglamKarti } | null
  /** Koşu bitince: kart ve sıra durumu bırakılır. Temizlenecek bir şey varsa true. */
  temizle(): boolean
}

export function baglamKartiDurumuYap(): BaglamKartiDurumu {
  let kart: BaglamKarti | undefined
  let son: KartSiraDurumu | undefined
  return {
    kart: () => kart,
    isle(olay) {
      const damga = Math.max(Number(olay.olcum?.cevapAt) || 0, Number(olay.olcum?.olcumAt) || 0)
      if (!kartOlayiKabulEdilir(son, { asama: olay.asama, damga })) return null
      const yeni = baglamKartiYap({
        model: olay.model, sunucu: olay.sunucu, olcum: olay.olcum,
        istekNumCtx: olay.istekNumCtx ?? null, girisToken: olay.girisToken ?? null,
        tahminiToken: olay.tahminiToken ?? null, simdi: olay.simdi,
      })
      if (olay.asama === 'cevap') son = { model: olay.model, sunucu: olay.sunucu, cevapAt: damga }
      else {
        // A newer request raises the watermark. A late probe from the previous model must not
        // replace this card when its reply stamp is older than this request.
        const damgaIstek = Math.max(son?.cevapAt ?? 0, olay.simdi || 0, damga)
        son = { model: olay.model, sunucu: olay.sunucu, cevapAt: damgaIstek }
      }
      kart = yeni
      return { kart: yeni }
    },
    temizle() {
      if (!kart && !son) return false
      kart = undefined
      son = undefined
      return true
    },
  }
}
