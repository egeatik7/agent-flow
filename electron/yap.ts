import { YAP_PROMPT } from './llm-flow'
import { windowsTools } from './windows-tools'
import type { AgentNode, LogLevel } from './graph-types'
import type { ModelTool, ToolMessage } from './openrouter'
import { recoveryTools, type RecoveryToolResult } from './recovery'
import { DEFAULT_RECOVERY } from './recovery-settings'
import { StoppedError } from './runner'

export function yapTools(allowCode = true): ModelTool[] {
  const excluded = new Set(['target_preview', 'step_run', 'recovery_retry', 'recovery_complete', 'recovery_stop'])
  return [...windowsTools(allowCode), ...recoveryTools({ ...DEFAULT_RECOVERY, allowDesktop: true, allowNodes: false }).filter(t => !excluded.has(t.function.name)), {
    type: 'function' as const, function: { name: 'task_complete', description: 'Verilen görev tamamlandı. Araç sonucuna veya güncel ekran gözlemine dayanan kısa açıklamayla bitir.', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'], additionalProperties: false } },
  }]
}

const names: Record<string, string> = { screen_read: 'screen.read', flow_read: 'flow.read', flow_context: 'flow.context', act_click: 'act.click', act_move: 'act.move', act_click_current: 'act.clickCurrent', act_click_point: 'act.clickPoint', act_type: 'act.type', act_key: 'act.key', act_wait: 'act.wait' }

type Deps = {
  system?: string
  shouldStop: () => boolean
  log: (level: LogLevel, message: string) => void
  makeExecute: (shouldStop: () => boolean) => (name: string, args: Record<string, unknown>) => Promise<RecoveryToolResult>
  turn: (args: { messages: ToolMessage[]; tools: ModelTool[]; shouldStop: () => boolean; timeoutMs: number }) => Promise<ToolMessage>
}

/** Shared desktop tools, normal task context: no failed node, logs, repair reports or replay. */
export async function runYap(node: AgentNode, context: unknown, deps: Deps): Promise<boolean> {
  const budget = Math.min(60, Math.max(1, Math.floor(node.maxActions ?? 25)))
  const deadline = Date.now() + Math.min(900_000, Math.max(10_000, node.timeoutMs || 300_000))
  const stopped = () => deps.shouldStop() || Date.now() >= deadline
  const check = () => {
    if (deps.shouldStop()) throw new StoppedError()
    if (Date.now() >= deadline) throw new Error('Yap süresi doldu.')
  }
  const execute = deps.makeExecute(stopped)
  const tools = yapTools(node.allowCode !== false)
  let observed = false
  const messages: ToolMessage[] = [{ role: 'system', content: deps.system?.trim() || YAP_PROMPT }, { role: 'user', content: JSON.stringify({ task: node.prompt, context }, (key, value) => ['icon', 'patch', 'sig', 'path', 'trace'].includes(key) ? undefined : value) }]
  for (let used = 0, turns = 0; used < budget && turns < budget + 3; turns++) {
    check()
    const answer = await deps.turn({ messages, tools, shouldStop: stopped, timeoutMs: deadline - Date.now() })
    check()
    messages.push(answer)
    if (typeof answer.content === 'string' && answer.content.trim()) deps.log('info', `Yap: ${answer.content.slice(0, 1200)}`)
    if (!answer.tool_calls?.length) { messages.push({ role: 'user', content: 'Görevi araçlarla gerçekleştir; tamamlandıysa task_complete çağır.' }); continue }
    // All actions are sequential, including providers that send multiple calls in one turn.
    const pictures: ToolMessage[] = []
    for (const call of answer.tool_calls) {
      check()
      if (used++ >= budget) break
      let result: RecoveryToolResult
      try {
        const definition = tools.find(t => t.function.name === call.function.name)
        if (!definition) throw new Error('Bu araç Yap ajanına açık değil.')
        const args = JSON.parse(call.function.arguments)
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Araç argümanları nesne olmalı.')
        const schema = definition.function.parameters
        const properties = schema.properties as Record<string, { type: string; enum?: string[] }>
        for (const key of schema.required as string[]) if (!(key in args)) throw new Error(`Eksik alan: ${key}`)
        for (const [key, value] of Object.entries(args)) {
          const spec = properties[key]
          if (!spec || (spec.type === 'integer' ? !Number.isInteger(value) : typeof value !== spec.type) || (spec.enum && !spec.enum.includes(String(value)))) throw new Error(`Geçersiz alan: ${key}`)
        }
        if (call.function.name === 'task_complete') {
          if (!args.summary.trim()) throw new Error('Tamamlandı açıklaması boş olamaz.')
          if (!observed) throw new Error('Tamamlandı demeden önce güncel ekranı veya doğrudan işlem sonucunu incele.')
          deps.log('success', `Yap tamamlandı: ${args.summary.slice(0, 2000)}`)
          return true
        }
        deps.log('info', `Yap aracı: ${call.function.name} ${JSON.stringify(args)}`)
        if (call.function.name.startsWith('act_') && call.function.name !== 'act_wait') observed = false
        result = await execute(names[call.function.name] || call.function.name, args)
        check()
        if (call.function.name === 'window_action' || call.function.name === 'powershell_run') observed = false
        if (call.function.name === 'screen_read') observed = result.ok && result.outcome === 'tamam'
      } catch (error) {
        check()
        result = { ok: false, outcome: 'hata', message: (error as Error).message }
      }
      const data = result.data ? { ...result.data } : undefined
      const img = data?.image as { data?: string; mime?: string } | undefined
      if (data) delete data.image
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ...result, ...(data ? { data } : {}) }).slice(0, 30_000) })
      if (img?.data) pictures.push({ role: 'user', content: [{ type: 'text', text: 'Güncel ekran görüntüsü.' }, { type: 'image_url', image_url: { url: `data:${img.mime || 'image/png'};base64,${img.data}` } }] })
    }
    messages.push(...pictures)
    const frames = messages.filter(m => Array.isArray(m.content))
    for (const frame of frames.slice(0, -2)) frame.content = '[Eski ekran; gözlem araç cevabında.]'
  }
  throw new Error('Yap araç/adım sınırında görevi tamamlayamadı.')
}
