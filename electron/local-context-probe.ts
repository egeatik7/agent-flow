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
  BAGLAM_TAZELIK_MS,
  baglamOlcumu,
  baglamOlcumunuKaydet,
  etkinPencere,
  parseOllamaPs,
  parseOllamaShow,
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

/** Önbellekten pencere (AĞ İSTEĞİ YOK). Bilinmiyorsa null → gösterimde "bilinmiyor". */
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
 */
export function olcumuTazele(model: string, ucNokta: string, simdi = Date.now()): Promise<void> {
  const sunucu = ollamaKoku(ucNokta)
  if (!sunucu) return Promise.resolve()
  const anahtar = `${sunucu}|${model}`
  const varolan = ucusan.get(anahtar)
  if (varolan) return varolan
  const is = (async () => {
    const onceki = baglamOlcumu(model, sunucu)
    const yeni: BaglamOlcumu = { ...(onceki ?? {}), olcumAt: simdi, statikAt: onceki?.statikAt }
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
    } else {
      yeni.calisanPencere = undefined
    }
    // 2) Statik bilgi (/api/show): yalnız gerekliyse ve daha uzun ömürle.
    const statikGerekli = !onceki || !onceki.statikAt || simdi - onceki.statikAt > BAGLAM_STATIK_TAZELIK_MS
    if (statikGerekli) {
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
          }
        }
      }
    }
    // Yenileme başarısızsa eski statik bilgi korunur ama "güncel" sayılmaz: statikAt'e dokunulmaz.
    baglamOlcumunuKaydet(model, sunucu, yeni)
  })().finally(() => ucusan.delete(anahtar))
  ucusan.set(anahtar, is)
  return is
}

/** Yalnız test/ölçüm amaçlı: bekleyen birleştirilmiş sorgu var mı? */
export function bekleyenSorguVar(sunucu: string, model: string): boolean {
  return ucusan.has(`${sunucu}|${model}`)
}

export const SONDALAMA_SURESI = { ps: PS_MS, show: SHOW_MS, statikTazelik: BAGLAM_STATIK_TAZELIK_MS, yukluTazelik: BAGLAM_TAZELIK_MS }
