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

/** Gerçekten GÖNDERİLEN aday sayısı: liste metnindeki "#numara " satırları sayılır (kesilmemiş kanıt). */
export function countSentCandidates(listText: string): number {
  return (listText.match(/^#\d+\s/gm) ?? []).length
}

let root = ''
/** Tanılama kökü (main.ts kurar: kullanıcı veri klasörü altında). Boşsa diske yazılmaz. */
export function setDiagnosticsRoot(directory: string): void { root = directory }
export function diagnosticsRoot(): string { return root }

/** Görüntü verisini (data URL) ham baytlara çevirir; gizli bilgi içermez. */
export function imageBytes(data: string | undefined): { buffer: Buffer; mime: string } | null {
  const raw = String(data ?? '')
  const m = raw.match(/^data:([^;,]+);base64,(.*)$/s)
  if (!m) return null
  try { return { buffer: Buffer.from(m[2], 'base64'), mime: m[1] } } catch { return null }
}

/**
 * İsteğin kanıtını diske yazar: özet, tam sistem promptu, talimat, gönderilen aday listesi, görüntünün
 * AYNISI (yeniden ekran görüntüsü alınmaz; istekteki veri kullanılır) ve modelin ham yanıtı.
 */
export function saveRequestEvidence(id: string, files: { summary?: string; system?: string; instruction?: string; candidates?: string; image?: { buffer: Buffer; mime: string }; response?: string }): string {
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
    if (files.image) {
      const uzanti = files.image.mime.includes('png') ? 'png' : 'jpg'
      try { fs.writeFileSync(path.join(dir, `gonderilen-goruntu.${uzanti}`), files.image.buffer) } catch { /* aynı */ }
    }
    return dir
  } catch { return '' }
}
