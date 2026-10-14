import { visualReplyJson } from './visual-reply-json'

export type VisualToolCall = {
  name: 'computer_use'
  arguments: { action: 'mouse_move'; coordinate: [number, number] } | { action: 'terminate'; status: 'failure' }
}

/** Parse data only. This function cannot dispatch a tool or authorize a click. */
export function visualToolCall(content: string): VisualToolCall & { reason: string } {
  const text = content.trim()
  if (text.length > 65_536) throw new Error('Görsel araç yanıtı çok uzun')
  let json = text, reason = ''
  if (text.includes('<tool_call>') || text.includes('</tool_call>')) {
    const match = text.match(/^(?:Action:[ \t]*([^\r\n]+)\r?\n\s*)?<tool_call>\s*([\s\S]*?)\s*<\/tool_call>$/)
    if (!match || (text.match(/<tool_call>/g) ?? []).length !== 1 || (text.match(/<\/tool_call>/g) ?? []).length !== 1) {
      throw new Error('Görsel hedef yanıtında yalnız tek computer_use tool_call gerekli')
    }
    reason = match[1]?.trim() ?? ''; json = match[2]
  }
  const tool = visualReplyJson(json, ['name', 'arguments'])
  if (tool.name !== 'computer_use') throw new Error('Görsel hedef yalnız computer_use kabul eder')
  if (!tool.arguments || typeof tool.arguments !== 'object' || Array.isArray(tool.arguments)) throw new Error('Görsel hedef arguments nesne olmalı')
  // The outer reader already rejects duplicate keys at every nesting level.
  const args = visualReplyJson(JSON.stringify(tool.arguments), ['action', 'coordinate', 'status'])
  if (args.action === 'terminate') {
    if (args.status !== 'failure' || 'coordinate' in args) throw new Error('Hedef yoksa yalnız terminate/status=failure gerekli; koordinat verilmez')
  } else if (args.action === 'mouse_move') {
    const point = args.coordinate
    if ('status' in args || !Array.isArray(point) || point.length !== 2 || !point.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 1000)) {
      throw new Error('mouse_move için iki sonlu sayıdan oluşan coordinate gerekli (0 <= x,y < 1000)')
    }
  } else throw new Error('Görsel hedef yalnız mouse_move veya terminate/failure kabul eder; tıklama ve diğer araçlar çalıştırılmaz')
  // Preserve the actual wire object instead of translating it to intent/x/y.
  return { ...(tool as VisualToolCall), reason }
}
