/** Find order and the prompts the models actually receive. Empty saved text means the built-in prompt. */

export const FIND_STAGE_IDS = ['chrome', 'uia', 'icon', 'windows', 'onnx', 'list', 'tars', 'offset'] as const
export type FindStageId = (typeof FIND_STAGE_IDS)[number]

export type PromptId = 'list' | 'tars' | 'screen' | 'initiative'

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
]

export const DEFAULT_FIND_OFF: FindStageId[] = ['list']

export const LIST_PROMPT = `You are a Windows desktop automation agent. You receive a numbered list of the text and controls visible on the screen (UIA = a control the application reported, Text = writing read from the screenshot by OCR).
The user is about to click somewhere on the screen: choose the text or control to click.
The name in the instruction may not match the on-screen text exactly (Turkish suffixes, letter case, OCR mistakes): choose the item that fits the meaning. Judge location phrases (at the top, on the right, at the bottom) from the coordinates. Also consider the application name, picture its layout, and decide which area should be clicked.
Reply with JSON only: {"id": <number or null>, "text": "<the text to click>", "reason": "<short reason>"}
If no item fits, set id to null.`

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

export const DEFAULT_PROMPTS: Record<PromptId, string> = {
  list: LIST_PROMPT,
  tars: TARS_TEMPLATE,
  screen: SCREEN_PROMPT,
  initiative: INITIATIVE_PROMPT,
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
