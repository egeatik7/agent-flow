import fs from 'node:fs'
import path from 'node:path'

/**
 * Kanıtlanabilir gönderim kaydı (1.9.113). Ölçülen kusur: istek gövdesi günlükte 6000 karakterde
 * kesiliyordu ve görüntü işareti listenin SONUNDA yazıldığı için kesilen bölümde kalıyordu; bu yüzden
 * "Qwen'e ekran görüntüsü gitti mi?" sorusu günlükten KANITLANAMIYORDU.
 *
 * Çözüm: gövdeden ÖNCE, TEK SATIR ve KESİLMEYEN bir özet yazılır; görüntünün aynısı, tam sistem promptu,
 * talimat ve gönderilen aday listesi aynı istek kimliğiyle diske kaydedilir. API anahtarı, Authorization
 * başlığı veya başka gizli bilgi ASLA yazılmaz.
 */
export type SendImageInfo = {
  sent: boolean
  /** Görüntü yoksa sebebi (ayar kapalı, tarama boş, sınır...). */
  reason?: string
  w?: number
  h?: number
  /** Worker'ın çizdiği numaralar var mı (image:'marked' istendi mi). */
  marked?: boolean
  bytes?: number
  mime?: string
}

export type SendSummaryInput = {
  id: string
  node?: string
  stage: string
  model: string
  target: 'local' | 'api'
  image: SendImageInfo
  /** Görüntülü deneme reddedildi de görüntüsüz isteğe düşüldü mü. */
  fallbackNoImage?: boolean
  candidates: { built: number; sent: number }
  promptChars: number
  /** Kayıtlı model sırasının revizyonu. Yapılandırılmış zincir `model` alanına yazılmaz. */
  revision?: number
  /** Bu aşamanın sırayı hangi listeden aldığı. */
  source?: string
  /** Denenecek sıra, `>` ile. `model` yalnız bu isteğin modeli. */
  chain?: string
}

const tekSatir = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim()

/** Tek satırlık, kesilmeye dayanıklı özet. Gizli bilgi içermez; yalnız sayılar ve adlar. */
export function sendSummaryText(input: SendSummaryInput): string {
  const g = input.image
  const goruntu = g.sent
    ? `VAR ${g.w ?? '?'}x${g.h ?? '?'} ${g.marked ? 'marked' : 'plain'} ${g.bytes ?? 0}B${g.mime ? ` ${g.mime}` : ''}`
    : `YOK (${tekSatir(g.reason ?? 'sebep kaydedilmedi')})`
  return [
    `GONDERIM id=${input.id}`,
    `node=${input.node ?? '-'}`,
    `asama=${input.stage}`,
    `model=${tekSatir(input.model)}`,
    `hedef=${input.target}`,
    `goruntu=${goruntu}`,
    `goruntusuz-geri-donus=${input.fallbackNoImage ? 'VAR' : 'yok'}`,
    `aday=uretilen:${input.candidates.built} gonderilen:${input.candidates.sent}`,
    `istem-uzunlugu=${input.promptChars}`,
    ...(input.revision !== undefined ? [`revizyon=${input.revision}`] : []),
    ...(input.source ? [`kaynak=${tekSatir(input.source)}`] : []),
    ...(input.chain ? [`zincir=${tekSatir(input.chain)}`, `ilk=${tekSatir(input.chain.split(' > ')[0] ?? '')}`] : []),
  ].join(' | ')
}

export type ResponseSummaryInput = {
  id: string
  /** Modelin ham cevabı; günlük satırı KISA tutulur, tamamı diske yazılır. */
  raw: string
  returnedId: number | null
  inSentList?: boolean
  selectable?: boolean
  rejected?: string
  resolvedItem?: string
  resolvedWord?: string
  targetText?: string
  point?: { x: number; y: number }
  /** Program modelin seçimini değiştirdiyse öncesi/sonrası. */
  correctedFrom?: string
  correctedTo?: string
}

export function responseSummaryText(input: ResponseSummaryInput): string {
  const p = input.point
  return [
    `YANIT id=${input.id}`,
    `donen-id=${input.returnedId ?? 'yok'}`,
    `listede=${input.inSentList === undefined ? '?' : input.inSentList ? 'var' : 'YOK'}`,
    `secilabilir=${input.selectable === undefined ? '?' : input.selectable ? 'evet' : 'hayir'}`,
    `red-sebebi=${tekSatir(input.rejected ?? '-')}`,
    `cozulen-oge=${tekSatir(input.resolvedItem ?? '-')}`,
    `cozulen-kelime=${tekSatir(input.resolvedWord ?? '-')}`,
    `hedef=${tekSatir(input.targetText ?? '-')}`,
    `nokta=${p ? `${p.x},${p.y}` : '-'}`,
    `duzeltme=${input.correctedFrom ? `${tekSatir(input.correctedFrom)} -> ${tekSatir(input.correctedTo ?? '')}` : 'yok'}`,
    `ham=${tekSatir(input.raw).slice(0, 160)}`,
  ].join(' | ')
}

let sayac = 0
/** Kısa, benzersiz istek kimliği: günlük satırı ile tanılama klasörünü eşler. */
export function nextRequestId(): string {
  sayac += 1
  return `${Date.now().toString(36)}-${sayac.toString(36)}`
}

/**
 * Günlük satırından model İSTEĞİ/CEVABI işaretini çıkarır (1.9.118). Kart kronometresi bunlarla
 * sürülür: istek yazıldığında sayaç başlar, cevap yazıldığında geçen süre raporlanır. Böylece OCR
 * listesi hazır olduktan sonraki "model düşünüyor" boşluğu kartta görünür olur.
 */
export function sendMarkerInfo(line: string): { kind: 'gonderim' | 'yanit'; id: string; model?: string; stage?: string } | null {
  const satir = String(line ?? '')
  const alan = (k: string) => (satir.match(new RegExp(`${k}=([^|]*)`))?.[1] ?? '').trim()
  if (/GONDERIM id=/.test(satir)) return { kind: 'gonderim', id: alan('id'), model: alan('model'), stage: alan('asama') }
  if (/YANIT id=/.test(satir)) return { kind: 'yanit', id: alan('id') }
  return null
}

/** Model adını kart için kısaltır: "local:qwen3.5-64k:latest,~openai/…" → "qwen3.5-64k:latest". */
export function shortModelName(model: string | undefined): string {
  const ilk = String(model ?? '').split(',')[0].trim()
  return ilk.replace(/^local:/, '')
}

/** Kart satırı: "Model cevabı · qwen3.5-64k:latest · 2,8 sn" (Türkçe ondalık virgül). */
export function stopwatchText(label: string, extra: string, ms: number): string {
  const s = (Math.max(0, ms) / 1000).toFixed(1).replace('.', ',')
  return `${label}${extra ? ` · ${extra}` : ''} · ${s} sn`
}

/**
 * Kart şeridi (1.9.119): son üç aşama ve süreleri tek satırda —
 * "OCR + liste · 147 aday 1,2 sn · Model qwen3.5-64k:latest 3,1 sn". Ölçülemeyen aralık "—" yazılır
 * (adımlar arası bekleme süre sayılmaz), böylece kart yanlış bir süre uydurmaz.
 */
export function stageStripText(items: { ad: string; ms: number | null }[]): string {
  return items
    .map((a) => `${a.ad} ${a.ms === null ? '—' : `${(a.ms / 1000).toFixed(1).replace('.', ',')} sn`}`)
    .join(' · ')
}

/** İstek satırından aday sayısını çıkarır: "aday=uretilen:147 gonderilen:147" → "147". */
export function adaySayisi(line: string): string {
  return (String(line ?? '').match(/aday=uretilen:(\d+)/) ?? [])[1] ?? ''
}

/** Gerçekten GÖNDERİLEN aday sayısı: liste metnindeki "#numara " satırları sayılır (kesilmemiş kanıt). */
export function countSentCandidates(listText: string): number {
  return (listText.match(/^#\d+\s/gm) ?? []).length
}

let root = ''
/** Tanılama kökü (main.ts kurar: kullanıcı veri klasörü altında). Boşsa diske yazılmaz. */
export function setDiagnosticsRoot(directory: string): void { root = directory }
export function diagnosticsRoot(): string { return root }

/**
 * Görüntü verisini baytlara çevirir. İKİ biçim desteklenir (1.9.115): `data:<mime>;base64,<veri>` VE
 * **ham base64**. MIME önce verilen görüntü nesnesinden (çağıranın bildirdiği), yoksa data URL'den,
 * yoksa `image/jpeg` varsayılanından alınır. Böylece istekte ham base64 olarak duran bir görüntü
 * yanlışlıkla "YOK" diye raporlanmaz.
 */
export function imageBytes(data: string | undefined, mimeFromObject?: string): { buffer: Buffer; mime: string } | null {
  const raw = String(data ?? '').trim()
  if (!raw) return null
  const dataUrl = raw.match(/^data:([^;,]+);base64,(.*)$/s)
  if (dataUrl) {
    try { return { buffer: Buffer.from(dataUrl[2], 'base64'), mime: mimeFromObject || dataUrl[1] || 'image/jpeg' } } catch { return null }
  }
  // Ham base64: yalnız base64 alfabesi + isteğe bağlı dolgu.
  if (/^[A-Za-z0-9+/=\s]+$/.test(raw)) {
    try {
      const buffer = Buffer.from(raw.replace(/\s+/g, ''), 'base64')
      if (buffer.length) return { buffer, mime: mimeFromObject || 'image/jpeg' }
    } catch { /* aşağıda null */ }
  }
  return null
}

/**
 * Gönderilen HTTP gövdesindeki (messages) gerçek `image_url` parçasından görüntüyü çıkarır. Kanıt,
 * "niyet"ten değil **istekte duran veriden** üretilir; ham base64 de kabul edilir.
 */
export function imageFromMessages(messages: { content?: unknown }[], mimeFromObject?: string): { buffer: Buffer; mime: string } | null {
  for (const message of messages) {
    const parts = Array.isArray(message?.content) ? message.content as { type?: string; image_url?: { url?: string } }[] : []
    for (const part of parts) {
      if (part?.type !== 'image_url') continue
      const bytes = imageBytes(part.image_url?.url, mimeFromObject)
      if (bytes) return bytes
    }
  }
  return null
}

/**
 * İsteğin kanıtını diske yazar: özet, tam sistem promptu, talimat, gönderilen aday listesi, görüntünün
 * AYNISI (yeniden ekran görüntüsü alınmaz; istekteki veri kullanılır) ve modelin ham yanıtı.
 */
/** Tanılama kanıtı saklama sınırı: her istek kalıcı bir klasör bırakıyordu, hiçbiri silinmiyordu. */
export const EVIDENCE_KEEP = 200
export const EVIDENCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
let lastPrune = 0

/** Eski istek kanıtı klasörlerini budar. Hata (kilit/izin) tanılamayı ve koşuyu durdurmaz. */
export function pruneEvidence(dir: string, now = Date.now(), keep = EVIDENCE_KEEP): number {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return 0 }
  const rows: { name: string; at: number }[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try { rows.push({ name: entry.name, at: fs.statSync(path.join(dir, entry.name)).mtimeMs }) } catch { /* silinmiş */ }
  }
  rows.sort((a, b) => b.at - a.at)
  let removed = 0
  for (const [index, row] of rows.entries()) {
    if (index < keep && now - row.at <= EVIDENCE_MAX_AGE_MS) continue
    try { fs.rmSync(path.join(dir, row.name), { recursive: true, force: true }); removed++ } catch { /* sonraki turda */ }
  }
  return removed
}

export function saveRequestEvidence(id: string, files: { summary?: string; system?: string; instruction?: string; candidates?: string; image?: { buffer: Buffer; mime: string }; response?: string; mapping?: unknown; resolution?: unknown }): string {
  if (!root) return ''
  try {
    const dir = path.join(root, id)
    fs.mkdirSync(dir, { recursive: true })
    const yaz = (ad: string, icerik: string) => { try { fs.writeFileSync(path.join(dir, ad), icerik, 'utf8') } catch { /* tanılama yazımı koşuyu durdurmaz */ } }
    if (files.summary) yaz('ozet.txt', files.summary + '\n')
    if (files.system) yaz('sistem-promptu.txt', files.system)
    if (files.instruction) yaz('talimat.txt', files.instruction)
    if (files.candidates) yaz('aday-listesi.txt', files.candidates)
    if (files.response) yaz('yanit.txt', files.response)
    if (files.mapping !== undefined) yaz('ocr-esleme.json', JSON.stringify(files.mapping, null, 2))
    if (files.resolution !== undefined) yaz('id-cozumleme.json', JSON.stringify(files.resolution, null, 2))
    if (files.image) {
      const uzanti = files.image.mime.includes('png') ? 'png' : 'jpg'
      try { fs.writeFileSync(path.join(dir, `gonderilen-goruntu.${uzanti}`), files.image.buffer) } catch { /* aynı */ }
    }
    // Sınırsız büyümeyi önle: dakikada en çok bir kez, en yeni N klasör tutulur.
    if (Date.now() - lastPrune > 60_000) { lastPrune = Date.now(); pruneEvidence(root) }
    return dir
  } catch { return '' }
}

/**
 * ETKİN BAĞLAM KAPASİTESİ (num_ctx) — bu bir ÖLÇÜMDÜR, tahmin değildir.
 * Kural: (1) istek açıkça num_ctx gönderiyorsa o kullanılır; (2) göndermiyorsa yerel sunucunun MODEL
 * yapılandırmasındaki etkin num_ctx alınır (`ollama show <model>` → Parameters → num_ctx);
 * (3) modelin desteklediği AZAMİ "context length" (ör. 262144) ile etkin num_ctx KARIŞTIRILMAZ;
 * (4) doğrulanamıyorsa null → "pencere=bilinmiyor" ve YÜZDE/AŞIM İDDİASI ÜRETİLMEZ.
 * Ölçüm model+SUNUCU bazında önbelleklenir; her çağrıda ek ağ isteği YAPILMAZ.
 */
const baglamOnbellek = new Map<string, number | null>()
const baglamAnahtar = (model: string, sunucu: string) => `${sunucu}|${model}`
export function setBaglamKapasitesi(model: string, sunucu: string, token: number | null): void { baglamOnbellek.set(baglamAnahtar(model, sunucu), token) }
export function baglamKapasitesi(model: string, sunucu: string): number | null | undefined { return baglamOnbellek.get(baglamAnahtar(model, sunucu)) }
export function baglamOnbellekBoyu(): number { return baglamOnbellek.size }

/** `ollama show <model>` çıktısından ETKİN num_ctx'yi çıkarır. Azami "context length" satırı KULLANILMAZ. */
export function parseOllamaNumCtx(cikti: string): number | null {
  const m = String(cikti ?? '').match(/^\s*num_ctx\s+(\d+)\s*$/m)
  const n = m ? Number(m[1]) : 0
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * BAĞLAM PENCERESİ BASKISI — yalnız SAYI/BOYUT yazar (görev metni, OCR/UIA içeriği, ekran görüntüsü ve
 * anahtar YAZILMAZ). Token sayısı TAHMİNDİR ve hiçbir karar (engelleme, kırpma, model değiştirme) bu
 * tahmine dayanmaz.
 */
export function contextPressureText(f: { model: string; metinKarakter: number; goruntuAdet: number; goruntuBayt: number; pencereToken?: number | null }): string {
  const token = Math.round(f.metinKarakter / 3.2 + f.goruntuAdet * 1400)
  const pencere = typeof f.pencereToken === 'number' && f.pencereToken > 0 ? f.pencereToken : null
  const yuzde = pencere ? Math.round((token / pencere) * 100) : null
  const satirlar = [`BAGLAM-SIGMA | model=${f.model} | tahmini≈${token} token (TAHMİN) · pencere=${pencere ?? 'bilinmiyor'}${yuzde === null ? '' : ` (%${yuzde})`} | metin-karakter=${f.metinKarakter} görüntü=${f.goruntuAdet} (~${Math.round(f.goruntuBayt / 1024)} KB)`]
  if (yuzde !== null && yuzde > 100) satirlar.push('BAGLAM-ASIM | Tahmini kapasite aşımı; gerçek token ölçümü gerekli (istek DEĞİŞTİRİLMEDİ)')
  else if (yuzde !== null && yuzde >= 80) satirlar.push(`BAGLAM-UYARI | tahmini doluluk %${yuzde} ≥ eşik %80 (TAHMİN; engelleme/kırpma yapılmaz)`)
  return satirlar.join('\n')
}

/** Sunucunun verdiği sayılar OLDUĞU GİBİ yazılır; alan yoksa "bilinmiyor" (tahmin üretilmez). */
export function responseUsageText(f: { model: string; finishReason?: string; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }; native?: { prompt_eval_count?: number; eval_count?: number; done_reason?: string }; maxTokens?: number }): string | null {
  const u = f.usage, n = f.native
  if (!u && !n && !f.finishReason) return null
  const b = (v: unknown) => (v === undefined || v === null ? 'bilinmiyor' : String(v))
  const parca = [
    `prompt_tokens=${b(u?.prompt_tokens)}`,
    `completion_tokens=${b(u?.completion_tokens)}`,
    `total_tokens=${b(u?.total_tokens)}`,
    `finish_reason=${b(f.finishReason)}`,
    `max_tokens=${f.maxTokens === undefined ? 'yok' : f.maxTokens}`,
  ]
  if (n) parca.push(`prompt_eval_count=${b(n.prompt_eval_count)}`, `eval_count=${b(n.eval_count)}`, `done_reason=${b(n.done_reason)}`)
  const bas = `BAGLAM-SONUC | model=${f.model} | ${parca.join(' · ')}`
  return f.finishReason === 'length'
    ? `${bas}\nBAGLAM-KESIK | Yanıt uzunluk sınırında kesildi; çıktı bütçesi VEYA bağlam sınırı olabilir (bağlam taşması KANITLANMADI)`
    : bas
}

/** Hata sınıfları AYRI: açık bağlam-uzunluğu aşımı | token repeat limit | diğer (geniş eşleşme YOK). */
export function contextErrorKind(message: string): 'baglam' | 'tekrar' | 'diger' {
  const m = String(message ?? '')
  if (/token repeat limit|repeat limit reached/i.test(m)) return 'tekrar'
  if (/context length (?:exceeded|is exceeded)|maximum context length|exceeds the (?:maximum )?context|too many tokens|prompt is too long|context_length_exceeded/i.test(m)) return 'baglam'
  return 'diger'
}
