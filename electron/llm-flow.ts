/** Find order and the prompts the models actually receive. Empty saved text means the built-in prompt. */

export const FIND_STAGE_IDS = ['chrome', 'uia', 'icon', 'windows', 'onnx', 'list', 'tars', 'offset'] as const
export type FindStageId = (typeof FIND_STAGE_IDS)[number]

export type PromptId = 'list' | 'tars' | 'screen' | 'initiative' | 'reaction' | 'stall'

export const FIND_STAGES: { id: FindStageId; title: string; note: string; prompt?: PromptId }[] = [
  { id: 'chrome', title: 'Chrome sayfası', note: '9222 portundaki sayfanın yazıları. Tam eşleşmezse kelime listesi yazı modeline gider.' },
  { id: 'uia', title: 'Kayıtlı öğe', note: 'Yakalanan düğmenin kendi adı. LLM yok.' },
  { id: 'icon', title: 'Kayıtlı resim', note: 'Simge resmi yerelde aranır. LLM yok.' },
  { id: 'windows', title: 'Windows OCR', note: 'Yalnızca tırnak içindeki yazıyı rampalı karede ve 90° turda arar. Tırnak yoksa atlanır. Bulunamazsa sıradaki aşama, yani model.' },
  { id: 'onnx', title: 'ONNX OCR', note: 'Tırnak içindeki yazı Windows’ta yoksa aynı karede aranır. O da yoksa modele geçilir.' },
  { id: 'list', title: 'Kelime listesi → yazı modeli', note: 'OCR’dan çıkan numaralı liste bu prompt ile yazı modeline gider.', prompt: 'list' },
  { id: 'tars', title: 'UI-TARS', note: 'Düz, rampasız ekran görüntüsü. {{hedef}} talimatın yerine yazılır.', prompt: 'tars' },
  { id: 'offset', title: 'Kayıtlı konum', note: 'Eski pencere içi nokta. LLM yok.' },
]

export const EXTRA_PROMPTS: { id: PromptId; title: string; note: string }[] = [
  { id: 'screen', title: 'Ekran görüntüsü JSON', note: 'UI-TARS olmayan model ekran görüntüsüne bu prompt ile bakar.' },
  { id: 'initiative', title: 'İnisiyatif', note: 'Hedefe giderken her turda numaralı liste ve görüntü bu prompt ile gider.' },
  { id: 'reaction', title: 'Tepki', note: 'Tıklamadan sonraki iki kare bu prompt ile yorumlanır.' },
  { id: 'stall', title: 'Takılma', note: 'Hedef bulunamazsa akış bu prompt ile bekler, sürer ya da durur.' },
]

// Hiçbir aşama varsayılan olarak kapalı değil: "Kelime listesi → yazı modeli" (OCR listesinin
// yazı modeline gittiği aşama) varsayılan olarak AÇIK. "Kayıtlı konum" (offset) aşaması ayrıdır
// ve bu değişiklikten etkilenmez.
export const DEFAULT_FIND_OFF: FindStageId[] = []

export const LIST_PROMPT = `You are a Windows desktop automation agent. You receive a numbered list of visible text and controls. UIA means a control reported by an application; Text means writing detected by OCR.

Choose the text or control that matches the user's click instruction.

Use each item's physical coordinates, normalized center position, nearby-item hints, and measured screen regions when available. Interpret directions relative to the captured screen area.

Nearby OCR boxes may be parts of the same label, such as "Google" above "Chrome". Treat proximity as a clue, not proof. Keep the original item IDs; never invent a combined ID.

Respect the requested location and surface. A desktop shortcut is not interchangeable with a taskbar button or an item inside an application. If only targets on the wrong surface are available, return id:null.

Use measured taskbar boundaries when provided. Taskbars may be on any screen edge. An item near the bottom is not necessarily on the taskbar. If region information is unavailable, do not invent it.

Allow Turkish suffixes, letter-case differences, and plausible OCR mistakes. Use application context to interpret observed candidates, but do not invent controls or assume a familiar layout proves their presence.

Reply with JSON only:
{"id": <original item number or null>, "text": "<observed target text>", "reason": "<short reason>"}

If no observed item fits the instruction, set id to null.`

/** Liste aşamasında eylem cümlesi: tıklama ve yazma için ayrı. */
export const LIST_CLICK_SENTENCE = "Choose the text or control that matches the user's click instruction."
export const LIST_TYPE_SENTENCE = "Choose the text field (search box, Edit, input) that matches the user's typing instruction."

/**
 * "Kelime listesi → yazı modeli" aşamasının sistem promptu.
 *
 * Kayıtlı metin varsa o kullanılır (kullanıcının özel promptu korunur); yoksa yerleşik LIST_PROMPT.
 * Eylem cümlesi node türüne göre değiştirilir; cümle bulunamazsa sona eklenir (metin değişse de tutar).
 */
export function listPromptFor(kind: string, saved?: string): string {
  const taban = typeof saved === 'string' && saved.trim() ? saved : LIST_PROMPT
  const cumle = kind === 'type' ? LIST_TYPE_SENTENCE : LIST_CLICK_SENTENCE
  if (taban.includes(LIST_CLICK_SENTENCE)) return taban.split(LIST_CLICK_SENTENCE).join(cumle)
  if (kind === 'type' && taban.includes(LIST_TYPE_SENTENCE)) return taban
  return `${taban}${taban.endsWith('\n') ? '' : '\n'}\n${cumle}`
}


export const TARS_TEMPLATE = `You are a GUI agent. You are given a task and your action history, with screenshots. You need to perform the next action to complete the task.

## Output Format
\`\`\`
Thought: ...
Action: ...
\`\`\`

## Action Space

click(start_box='<|box_start|>(x1,y1)<|box_end|>')
left_double(start_box='<|box_start|>(x1,y1)<|box_end|>')
right_single(start_box='<|box_start|>(x1,y1)<|box_end|>')
drag(start_box='<|box_start|>(x1,y1)<|box_end|>', end_box='<|box_start|>(x3,y3)<|box_end|>')
hotkey(key='ctrl c')
type(content='xxx')
scroll(start_box='<|box_start|>(x1,y1)<|box_end|>', direction='down or up or right or left')
wait()
finished(content='xxx')
call_user()

## Note
- Write Thought in English.
- Write a small plan and finally summarize your next action in one sentence in Thought part.
- The computer runs Windows.

## User Instruction
{{hedef}}`

export const SCREEN_PROMPT = `You are a computer-use agent on Windows. Each turn you receive the goal, your previous steps, and the LATEST screenshot. Choose the SINGLE next action toward the goal.
Coordinates are normalized 0-1000 on the screenshot: x from the left, y from the top. Point at the center of the target.
Actions: click, double, right, drag, hotkey, type, scroll, wait, finished, call_user.
JSON only: {"thought":"<short plan>","action":"click","x":0,"y":0,"x2":null,"y2":null,"keys":[],"text":"","direction":""}`

export const INITIATIVE_PROMPT = `You are an automation agent working step by step on Windows or in a web page. Choose the SINGLE next action toward the user's goal.
Controls on screen are given as a numbered list. Clicks and typing must target a number from that list.
Actions: click, double, right, type, key, wait, done, fail.
JSON only: {"action":"...","id":null,"text":"","keys":"","seconds":0,"enter":false,"reason":"<short reason>"}`

export const REACTION_PROMPT = `You receive two screenshots, BEFORE and AFTER an automation step. Decide whether the next step is possible.
Pick one verdict: ready, missed, loading, blocked, unknown.
JSON only: {"verdict":"ready|missed|loading|blocked|unknown","reason":"<short reason>"}`

export const STALL_PROMPT = `A desktop automation step got no clear reaction, or the next control was not found. Do not break the flow immediately.
Decision: continue, wait (waitSec from 1 to 8), or stop.
lookFor: a short string to look for on screen. Empty string if none.
JSON only: {"action":"continue|wait|stop","waitSec":3,"lookFor":"","reason":"<short plan>"}`

export const DEFAULT_PROMPTS: Record<PromptId, string> = {
  list: LIST_PROMPT,
  tars: TARS_TEMPLATE,
  screen: SCREEN_PROMPT,
  initiative: INITIATIVE_PROMPT,
  reaction: REACTION_PROMPT,
  stall: STALL_PROMPT,
}

export type LlmPrompts = Partial<Record<PromptId, string>>

const STAGE_SET = new Set<string>(FIND_STAGE_IDS)
const PROMPT_SET = new Set<string>(Object.keys(DEFAULT_PROMPTS))

export function normalizeFind(order: unknown, off: unknown): { order: FindStageId[]; off: FindStageId[] } {
  const seen = new Set<FindStageId>()
  const next: FindStageId[] = []
  if (Array.isArray(order)) {
    for (const id of order) {
      if (typeof id !== 'string' || !STAGE_SET.has(id) || seen.has(id as FindStageId)) continue
      seen.add(id as FindStageId)
      next.push(id as FindStageId)
    }
  }
  for (const id of FIND_STAGE_IDS) if (!seen.has(id)) next.push(id)
  const disabled: FindStageId[] = []
  if (Array.isArray(off)) {
    for (const id of off) {
      if (typeof id === 'string' && STAGE_SET.has(id)) disabled.push(id as FindStageId)
    }
  }
  return { order: next, off: disabled }
}

export function normalizePrompts(raw: unknown): LlmPrompts {
  const out: LlmPrompts = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!PROMPT_SET.has(k) || typeof v !== 'string') continue
    const text = v.trim()
    if (!text || text === DEFAULT_PROMPTS[k as PromptId].trim()) continue
    if (/Sen bir |Sadece JSON|SADECE JSON|Bir otomasyon adımının|Bir masaüstü otomasyon|Program adını da değerlendirerek/.test(text)) continue
    out[k as PromptId] = v
  }
  return out
}

export function activeFindOrder(order: FindStageId[], off: FindStageId[]): FindStageId[] {
  const disabled = new Set(off)
  return order.filter((id) => !disabled.has(id))
}

export function promptOf(prompts: LlmPrompts | undefined, id: PromptId): string | undefined {
  const v = prompts?.[id]
  return typeof v === 'string' && v.trim() ? v : undefined
}

export function fillGoal(template: string, goal: string): string {
  if (template.includes('{{hedef}}')) return template.split('{{hedef}}').join(goal)
  return `${template}\n\n## User Instruction\n${goal}`
}
