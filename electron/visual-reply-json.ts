/** Visual replies carry coordinates: never silently overwrite a duplicate JSON key. */
export function visualReplyJson(content: string, allowed: readonly string[]): Record<string, unknown> {
  let text = content.trim()
  const fence = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i)
  if (fence) text = fence[1].trim()
  if (text.length > 65_536) throw new Error('Görsel JSON yanıtı çok uzun')
  const decoded: unknown = JSON.parse(text)
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('Görsel yanıt tek JSON nesnesi olmalı')
  // JSON.parse accepts duplicate keys (last wins). Walk the valid JSON tokens before using it.
  let pos = 0
  const ws = () => { while (/\s/.test(text[pos] ?? '') && pos < text.length) pos++ }
  const string = (): string => {
    const start = pos++
    while (pos < text.length) {
      const c = text[pos++]
      if (c === '\\') pos++
      else if (c === '"') return JSON.parse(text.slice(start, pos)) as string
    }
    throw new Error('Görsel JSON dizesi eksik')
  }
  const value = (depth: number): void => {
    if (depth > 32) throw new Error('Görsel JSON iç içe sınırı aşıldı')
    ws()
    if (text[pos] === '{') {
      pos++; ws()
      const keys = new Set<string>()
      if (text[pos] !== '}') for (;;) {
        ws(); const key = string()
        if (keys.has(key)) throw new Error(`Görsel JSON alanı tekrar ediyor: ${key}`)
        keys.add(key); ws(); pos++; value(depth + 1); ws()
        if (text[pos] !== ',') break
        pos++
      }
      pos++
    } else if (text[pos] === '[') {
      pos++; ws()
      if (text[pos] !== ']') for (;;) {
        value(depth + 1); ws()
        if (text[pos] !== ',') break
        pos++
      }
      pos++
    } else if (text[pos] === '"') string()
    else { while (pos < text.length && !/[\s,}\]]/.test(text[pos])) pos++ }
  }
  value(0)
  const result = decoded as Record<string, unknown>
  for (const key of Object.keys(result)) {
    if (!allowed.includes(key)) throw new Error(`Görsel JSON alanı tanınmıyor: ${key}`)
  }
  if ('reason' in result && typeof result.reason !== 'string') throw new Error('Görsel JSON reason metin olmalı')
  return result
}
