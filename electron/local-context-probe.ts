/**
 * YEREL BAĞLAM ÖLÇÜM SONDASI — ölçüm yalnızca isteğin GERÇEKTEN gönderildiği sunucuya sorulur.
 *
 * Kurallar:
 *  · Sabit `localhost` veya makinedeki `ollama` CLI'si KULLANILMAZ; adres sohbet ucunun kendisinden türetilir.
 *  · Sorgular ASENKRON, İPTAL EDİLEBİLİR (`AbortController`) ve KISA zaman aşımlıdır.
 *  · Ölçüm başarısızlığı LLM çağrısını ASLA engellemez/bozmaz (bu modül hiç `throw` etmez).
 *  · Ollama olmayan sunuculara Ollama uçları körlemesine uygulanmaz: yanıt Ollama biçiminde değilse ölçüm
 *    "bilinmiyor" olarak kalır.
 *  · Eşzamanlı aynı sorgular BİRLEŞTİRİLİR; statik (/api/show) bilgi daha uzun, yüklü durum (/api/ps) daha
 *    kısa ömürlüdür ve yalnız ÇAĞRI SINIRINDA yenilenir (arayüz güncellemelerinde ağ sorgusu yapılmaz).
 */
import {
  BAGLAM_STATIK_TAZELIK_MS,
  baglamOlcumu,
  baglamOlcumunuKaydet,
  etkinPencere,
  parseOllamaPs,
  parseOllamaShow,
  statikYenilenmeli,
  type BaglamOlcumu,
} from './local-context'

const PS_MS = 1200
const SHOW_MS = 2500

/** Sohbet ucundan Ollama kökünü türetir (ör. .../v1/chat/completions → http://host:port). */
export function ollamaKoku(ucNokta: string): string {
  const ham = String(ucNokta ?? '').trim()
  if (!ham) return ''
  try {
    const u = new URL(ham)
    return `${u.protocol}//${u.host}`
  } catch {
    return ham.replace(/\/v1\/?.*$/, '').replace(/\/+$/, '')
  }
}

/**
 * Önbellekten pencere (AĞ İSTEĞİ YOK). Bilinmiyorsa null → gösterimde "bilinmiyor".
 */
export function pencereTokenFor(model: string, ucNokta: string): number | null {
  const sunucu = ollamaKoku(ucNokta)
  return etkinPencere(baglamOlcumu(model, sunucu))
}

/** Önbellekteki ölçümün kendisi (kaynak etiketi için). */
export function olcumFor(model: string, ucNokta: string): BaglamOlcumu | undefined {
  return baglamOlcumu(model, ollamaKoku(ucNokta))
}

async function kisaFetch(url: string, init: RequestInit, ms: number): Promise<{ ok: boolean; text: string } | null> {
  const kontrol = new AbortController()
  const zaman = setTimeout(() => kontrol.abort(), ms)
  try {
    const res = await fetch(url, { ...init, signal: kontrol.signal })
    if (!res.ok) return null
    return { ok: true, text: await res.text() }
  } catch {
    return null // zaman aşımı / ağ hatası / iptal: ölçüm yok, çağrı ETKİLENMEZ
  } finally {
    clearTimeout(zaman)
  }
}

const ucusan = new Map<string, Promise<void>>()

/**
 * Yüklü durumu ve (gerekirse) statik bilgiyi tazeler. Çağrı SINIRINDA çağrılır; sonucu beklenmez.
 * Aynı model+sunucu için eşzamanlı çağrılar tek sorguya birleşir.
 *
 * TAZELİK KURALI: `olcumAt` yalnız `/api/ps` GERÇEKTEN cevap verdiğinde ilerletilir; böylece sunucu
 * kapalıyken "şimdi ölçüldü" damgası vurulmuş bir kayıt yazılmaz ve sonraki çağrı sınırında yeniden
 * denenir. Sorgu başarısızsa YÜKLÜ pencere GEÇERSİZ olur (model artık yüklü değil sayılır, eski
 * değer GÜNCEL sayılmaz) ama statik bilgi ve `statikAt` damgası korunur.
 */
export function olcumuTazele(
  model: string,
  ucNokta: string,
  simdi = Date.now(),
  /**
   * Cevap sonrası tazelemede eklenen kanıt: `cevapAt` bu kaydın "önceki isteğin kesin pencere
   * kanıtı" sayılmasını engeller; `girisToken` sunucunun bildirdiği GERÇEK giriş tokenıdır.
   */
  ek?: { cevapAt?: number; girisToken?: number },
): Promise<void> {
  const sunucu = ollamaKoku(ucNokta)
  if (!sunucu) return Promise.resolve()
  const anahtar = `${sunucu}|${model}`
  // BİRLEŞTİRME YALNIZ AYNI AMAÇLI SORGULAR İÇİNDİR. Cevap sonrası tazeleme (`ek`) uçuştaki istek
  // sınırı sondayla BİRLEŞEMEZ: o sonda istekten ÖNCE başladı ve modelin YENİ yüklenmiş penceresini
  // göremez (ölçülen kusur: cevap sonrası ölçüm eski boş sonucu devralıyordu). Bu durumda uçuştaki
  // sonda beklenir, ardından GERÇEKTEN YENİ bir sorgu yapılır.
  let coalesceOldu = false
  const varolan = ucusan.get(anahtar)
  if (varolan) {
    if (!ek) return varolan
    coalesceOldu = true
  }
  const is = (async () => {
    // Cevap sonrası tazeleme uçuştaki sondayı bekler: modelin yeni yüklendiğini görebilmek için
    // isteği sınırındaki sorgu BİTMİŞ olmalıdır.
    if (coalesceOldu && varolan) await varolan
    const onceki = baglamOlcumu(model, sunucu)
    const yeni: BaglamOlcumu = { ...(onceki ?? {}), olcumAt: onceki?.olcumAt ?? 0, statikAt: onceki?.statikAt }
    let ogrenildi = false
    // 1) Yüklü pencere (/api/ps): BOŞ liste = model yüklü değil -> yüklü pencere GEÇERSİZ.
    const ps = await kisaFetch(`${sunucu}/api/ps`, {}, PS_MS)
    if (ps) {
      let json: unknown = null
      try {
        json = JSON.parse(ps.text)
      } catch {
        json = null
      }
      const pencere = json ? parseOllamaPs(json, model) : undefined
      yeni.calisanPencere = pencere // undefined -> yüklü pencere bilinmiyor (eski değer GÜNCEL sayılmaz)
      ogrenildi = true
    } else {
      yeni.calisanPencere = undefined
    }
    // 2) Statik bilgi (/api/show): yalnız gerekliyse ve daha uzun ömürle.
    if (statikYenilenmeli(onceki, simdi)) {
      const show = await kisaFetch(`${sunucu}/api/show`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) }, SHOW_MS)
      if (show) {
        let json: unknown = null
        try {
          json = JSON.parse(show.text)
        } catch {
          json = null
        }
        if (json && typeof json === 'object') {
          const a = parseOllamaShow(json)
          if (a.azamiKapasite || a.yapilandirilmisPencere) {
            yeni.azamiKapasite = a.azamiKapasite
            yeni.yapilandirilmisPencere = a.yapilandirilmisPencere
            yeni.statikAt = simdi
            ogrenildi = true
          }
        }
      }
    }
    // Yenileme tamamen başarısızsa bile kayıt YAZILIR: eski "yüklü pencere" artık GÜNCEL değildir
    // (modelin hâlâ yüklü olduğu varsayılamaz) ve damga ilerletilmediği için sonraki çağrı sınırında
    // yeniden denenir. Statik bilgi ve `statikAt` korunur.
    if (ogrenildi) {
      yeni.olcumAt = simdi
      if (ek?.cevapAt) yeni.cevapAt = ek.cevapAt
      if (typeof ek?.girisToken === 'number' && ek.girisToken >= 0) yeni.girisToken = ek.girisToken
    }
    baglamOlcumunuKaydet(model, sunucu, yeni)
  })().finally(() => {
    if (ucusan.get(anahtar) === is) ucusan.delete(anahtar)
  })
  ucusan.set(anahtar, is)
  return is
}

/** Yalnız test/ölçüm amaçlı: bekleyen birleştirilmiş sorgu var mı? */
export function bekleyenSorguVar(sunucu: string, model: string): boolean {
  return ucusan.has(`${sunucu}|${model}`)
}

/** Bekleyen sonda sorgusu var mı (testler kaçak bırakmasın diye). */
export function bekleyenOlcumVar(): boolean {
  return ucusan.size > 0 || ekGorevler.size > 0
}

/**
 * Cevap SONRASI ölçüm görevleri. `olcumuTazele` doğrudan kaydedilir; ondan sonra kart olayını yayan
 * sarmalayıcı da buraya eklenir, böylece testler TÜM ölçüm işini (sorgu + kart olayı) bekleyebilir ve
 * test bittikten sonra arka planda kalan bir görev "unhandled" hata üretmez.
 */
const ekGorevler = new Set<Promise<unknown>>()

export function olcumGoreviEkle(gorev: Promise<unknown>): void {
  ekGorevler.add(gorev)
  const temizle = () => ekGorevler.delete(gorev)
  void gorev.then(temizle, temizle)
}

/**
 * Bekleyen tüm ölçüm işi bitene kadar bekler. Testler bunu `afterEach` içinde çağırır: kapanmış bir
 * sokete yazmaya çalışan bir sonda veya gecikmiş kart olayı, test bittikten sonra "unhandled
 * rejection" olarak görünmesin. Yeni iş başlatmaz; yalnız varolanı bekler.
 */
export async function bekleyenOlcumleriBekle(): Promise<void> {
  // Birden çok tur: beklerken yeni bir görev eklenirse (cevap sonrası sarmalayıcı) o da beklenir.
  for (let tur = 0; tur < 5; tur++) {
    const hepsi = [...ucusan.values(), ...ekGorevler]
    if (!hepsi.length) return
    await Promise.allSettled(hepsi) // hatalar yutulur: ölçüm hatası testi düşürmez
    if (!ucusan.size && !ekGorevler.size) return
  }
}

export const SONDALAMA_SURESI = { ps: PS_MS, show: SHOW_MS, statikTazelik: BAGLAM_STATIK_TAZELIK_MS }
