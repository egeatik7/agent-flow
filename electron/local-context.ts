/**
 * YEREL MODEL BAĞLAM ÖLÇÜMÜ — yalnız ölçüm ve önbellek.
 *
 * Kapsam kuralı: bu modül num_ctx, prompt, üretim ayarları, kırpma veya fallback davranışını DEĞİŞTİRMEZ;
 * yalnızca "etkin pencere"yi ölçer ve önbelleğe alır. Üç ayrı kavram KARIŞTIRILMAZ:
 *   · azamiKapasite         → /api/show `model_info.<mimari>.context_length` (modelin DESTEKLEDİĞİ azami)
 *   · yapilandirilmisPencere→ /api/show `parameters` içindeki `num_ctx` (modelin YAPILANDIRILMIŞ penceresi)
 *   · calisanPencere        → /api/ps çalışan örneğin `context_length` (GERÇEK yüklü pencere)
 * Etkin pencere sırası: istekteki num_ctx → çalışan pencere → yapılandırılmış pencere. Hiçbiri yoksa
 * `null` = "bilinmiyor"; **65536 gibi bir değer VARSAYILMAZ**.
 *
 * Model adına özel çözüm YOKTUR; her yerel model için aynı yordam işler.
 */
export type BaglamOlcumu = {
  /** Modelin desteklediği azami bağlam (ölçüm; pencere DEĞİL). */
  azamiKapasite?: number
  /** Modelin yapılandırılmış penceresi (num_ctx). */
  yapilandirilmisPencere?: number
  /** Şu an yüklü örneğin gerçek penceresi. */
  calisanPencere?: number
  /** İstek gövdesi num_ctx gönderdiyse o değer (uygulama şu an göndermiyor). */
  istekNumCtx?: number
  /** Ölçümün alındığı an (yenileme kararı için). */
  olcumAt: number
  /** STATİK (/api/show) bilginin alındığı an: yüklü durumdan daha uzun önbelleklenir. */
  statikAt?: number
  /**
   * Cevap SONRASI tazelemenin anı. Bu damga, kaydın "önceki isteğin kesin pencere kanıtı" diye
   * sunulmasını engeller: `cevapAt > olcumAt` ise ölçüm cevaptan SONRA alınmıştır ve o isteğin
   * penceresini kanıtlamaz, yalnız o anki yüklü durumu söyler.
   */
  cevapAt?: number
  /** Son cevapta sunucunun GERÇEKTEN bildirdiği giriş token sayısı (ölçüm; tahmin değil). */
  girisToken?: number
}

const sayi = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)

/** Etkin pencere: istek num_ctx → çalışan → yapılandırılmış. Doğrulanamıyorsa null ("bilinmiyor"). */
export function etkinPencere(o: BaglamOlcumu | undefined): number | null {
  if (!o) return null
  return sayi(o.istekNumCtx) ?? sayi(o.calisanPencere) ?? sayi(o.yapilandirilmisPencere) ?? null
}

/** `/api/show` cevabından azami kapasite ve yapılandırılmış num_ctx'yi AYRI AYRI çıkarır. */
export function parseOllamaShow(json: unknown): { azamiKapasite?: number; yapilandirilmisPencere?: number } {
  const j = (json ?? {}) as { parameters?: unknown; model_info?: Record<string, unknown> }
  const cikti: { azamiKapasite?: number; yapilandirilmisPencere?: number } = {}
  const parametreler = typeof j.parameters === 'string' ? j.parameters : ''
  const m = parametreler.match(/^\s*num_ctx\s+(\d+)\s*$/m)
  const numCtx = m ? sayi(Number(m[1])) : undefined
  if (numCtx) cikti.yapilandirilmisPencere = numCtx
  const info = j.model_info && typeof j.model_info === 'object' ? j.model_info : {}
  for (const [anahtar, deger] of Object.entries(info)) {
    if (/\.context_length$/i.test(anahtar)) {
      const n = sayi(deger)
      if (n) {
        cikti.azamiKapasite = n
        break
      }
    }
  }
  return cikti
}

/** `/api/ps` cevabından ÇALIŞAN modelin yüklü penceresini bulur (yoksa undefined). */
export function parseOllamaPs(json: unknown, model: string): number | undefined {
  const j = (json ?? {}) as { models?: { name?: string; model?: string; context_length?: number }[] }
  const liste = Array.isArray(j.models) ? j.models : []
  const normalize = (s: unknown) => String(s ?? '').replace(/:latest$/, '')
  const aranan = normalize(model)
  const bulunan = liste.find((m) => normalize(m?.name ?? m?.model) === aranan)
  return sayi(bulunan?.context_length)
}

// ---- Önbellek: model+SUNUCU bazında; her çağrıda ek ağ isteği YAPILMAZ. ----
const onbellek = new Map<string, BaglamOlcumu>()
const anahtar = (model: string, sunucu: string) => `${sunucu}|${model}`

export function baglamOlcumu(model: string, sunucu: string): BaglamOlcumu | undefined {
  return onbellek.get(anahtar(model, sunucu))
}

export function baglamOlcumunuKaydet(model: string, sunucu: string, olcum: BaglamOlcumu): void {
  onbellek.set(anahtar(model, sunucu), olcum)
}

/** Model/ayar değişiminde, yükleme sonrası veya `/api/ps` değiştiğinde çağrılır. */
export function baglamOnbelleginiTemizle(model?: string, sunucu?: string): void {
  if (model === undefined || sunucu === undefined) onbellek.clear()
  else onbellek.delete(anahtar(model, sunucu))
}

export function baglamOnbellekBoyu(): number {
  return onbellek.size
}

/** Ölçüm tazelik süresi: bu süreden eski ölçüm ÇAĞRI SINIRINDA yenilenir (her güncellemede değil). */
export const BAGLAM_TAZELIK_MS = 5 * 60_000

/**
 * Ölçüm yenilenmeli mi? Ollama yeniden başlatılırsa, model yeniden yüklenirse veya num_ctx değişirse eski
 * bilgi kalmasın diye çağrı sınırında sorulur. /api/ps'te model YOKSA da yenilenir (ilk çağrı modeli yükler).
 */
export function baglamYenilenmeli(
  o: BaglamOlcumu | undefined,
  model: string,
  ps: { durum: 'ok' | 'hata'; calisanlar?: { model: string; pencere?: number }[] },
  simdi: number,
): boolean {
  if (!o) return true
  if (simdi - o.olcumAt > BAGLAM_TAZELIK_MS) return true
  if (ps.durum === 'hata') return true // sorgu başarısız: eski ölçüm GÜNCEL sayılmaz, çağrı sınırında yeniden dene
  const ad = (s: unknown) => String(s ?? '').replace(/:latest$/, '')
  const bulunan = (ps.calisanlar ?? []).find((m) => ad(m.model) === ad(model))
  if (!bulunan) return true // BOŞ liste dâhil: model yüklü değil -> eski "yüklü pencere" geçersiz
  if (bulunan.pencere !== undefined && bulunan.pencere !== o.calisanPencere) return true // aynı model, FARKLI pencere
  return false
}

/** STATİK (/api/show) bilgi daha uzun önbelleklenir; yüklü durum çağrı sınırında yenilenir. */
export const BAGLAM_STATIK_TAZELIK_MS = 30 * 60_000
export function statikYenilenmeli(o: BaglamOlcumu | undefined, simdi: number): boolean {
  return !o || !o.statikAt || simdi - o.statikAt > BAGLAM_STATIK_TAZELIK_MS
}

/** Ölçüm "eski" sayılma sınırı (kart "eski ölçüm" yazar). */
export const BAGLAM_ESKI_MS = 5 * 60_000

/**
 * Ölçüm eski mi. Kural: kanıt zamanı `olcumAt` ve varsa `cevapAt` içinden EN YENİSİ alınır; ikisi de
 * yoksa (0) ölçüm yaşlı sayılır. Böylece iki damgadan biri ilerlemişse kart yanlışlıkla "eski" demez.
 */
export function olcumEskiMi(o: BaglamOlcumu | undefined, simdi: number, sinirMs = BAGLAM_ESKI_MS): boolean {
  if (!o) return true
  const kanit = Math.max(Number(o.olcumAt) || 0, Number(o.cevapAt) || 0)
  if (kanit <= 0) return true
  return simdi - kanit > sinirMs
}

/**
 * Ölçüm ÖNCEKİ isteğin cevabından SONRA mı tazelendi. Böyle bir kayıt, o isteğin penceresi için
 * "kesin kanıt" sayılmaz; yalnız o anki yüklü durumu bildirir.
 */
export function cevapSonrasiTazeleme(o: BaglamOlcumu | undefined): boolean {
  const cevap = Number(o?.cevapAt) || 0
  const olcum = Number(o?.olcumAt) || 0
  // Production stamps both at the same millisecond after a reply. That record is still a
  // post-response refresh: it is the loaded window now, not proof of the request that just finished.
  return cevap > 0 && cevap >= olcum
}

/** Pencerenin KAYNAĞI: istenen/yapılandırılan değer "gerçek yüklü pencere" diye sunulmaz. */
export type PencereKaynagi = 'istek' | 'yuklu' | 'yapilandirilmis' | 'bilinmiyor'
export function pencereKaynagi(o: BaglamOlcumu | undefined): { token: number | null; kaynak: PencereKaynagi } {
  if (o) {
    const istenen = sayi(o.istekNumCtx)
    if (istenen) return { token: istenen, kaynak: 'istek' }
    const yuklu = sayi(o.calisanPencere)
    if (yuklu) return { token: yuklu, kaynak: 'yuklu' }
    const yapilandirilmis = sayi(o.yapilandirilmisPencere)
    if (yapilandirilmis) return { token: yapilandirilmis, kaynak: 'yapilandirilmis' }
  }
  return { token: null, kaynak: 'bilinmiyor' }
}