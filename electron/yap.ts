import {repeatMethodCycle,methodErrorText,TaskNeedsRecoveryError} from './method-cycle'
import {interruptibleSleep} from './runner'
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
  }, {
    type: 'function' as const, function: { name: 'task_give_up', description: 'Güncel ekranı okuyup alternatifleri değerlendirdikten sonra görevi tamamlayamıyorsan gerekçeyle kurtarma aşamasına aktar. Bu araç koşuyu doğrudan durdurmaz.', parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'], additionalProperties: false } },
  }]
}

const names: Record<string, string> = { screen_read: 'screen.read', flow_read: 'flow.read', flow_context: 'flow.context', act_click: 'act.click', act_move: 'act.move', act_click_current: 'act.clickCurrent', act_click_point: 'act.clickPoint', act_type: 'act.type', act_key: 'act.key', act_wait: 'act.wait' }
const READ_OR_FINISH = new Set(['screen_read', 'local_context', 'task_complete', 'task_give_up', 'flow_read', 'flow_context'])
function spendsAction(name: string): boolean {
  return name.startsWith('act_') || name === 'act_scroll' || name === 'window_action' || name === 'powershell_run'
}
function clearsScreen(name: string): boolean {
  return name.startsWith('act_') || name === 'window_action' || name === 'powershell_run'
}

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
  let deadline = Date.now() + Math.min(900_000, Math.max(10_000, node.timeoutMs || 300_000))
  // Model waiting/retries do not consume the task execution budget.
  let waitingForModel = false
  const stopped = () => deps.shouldStop() || (!waitingForModel && Date.now() >= deadline)
  const check = () => {
    if (deps.shouldStop()) throw new StoppedError()
    if (Date.now() >= deadline) return markFailure(new Error('Yap süresi doldu.'))
  }
  const dispatch = deps.makeExecute(stopped)
  let actionStarted = false
  const execute: ReturnType<Deps['makeExecute']> = async (name, args) => {
    // A failed tool or exhausted task must not make the runner replay prior actions.
    if (!['screen.read', 'flow.read', 'flow.context', 'window_list', 'system_info', 'file_list', 'act.wait'].includes(name)) actionStarted = true
    return dispatch(name, args)
  }
  const markFailure = (error: unknown): never => {
    const err = error instanceof Error ? error : new Error(String(error))
    if (actionStarted) Object.assign(err, { inputMayHaveBeenSent: true })
    throw err
  }
  const tools = yapTools(node.allowCode !== false)
  let observed = false
  // Technical retries replace this one ephemeral observation; action/tool history remains intact.
  let retryObservation: ToolMessage | undefined
  const messages: ToolMessage[] = [{ role: 'system', content: deps.system?.trim() || YAP_PROMPT }, { role: 'user', content: JSON.stringify({ task: node.prompt, context }, (key, value) => ['icon', 'patch', 'sig', 'path', 'trace'].includes(key) ? undefined : value) }]
  const maxTurns = Math.max(budget * 4, 40)
  for (let used = 0, turns = 0; used < budget && turns < maxTurns; turns++) {
    check()
    let answer: ToolMessage
    const modelStarted = Date.now()
    waitingForModel = true
    try {
      answer = await repeatMethodCycle(async round => {
        if (round > 1) {
          // Observation only: never replay task actions to refresh a failed turn.
          try {
            const fresh = await execute('screen.read', {})
            const data = fresh.data ? { ...fresh.data } : undefined
            const image = data?.image as { data?: string; mime?: string } | undefined
            if (data) delete data.image
            const { data: _previousData, ...details } = fresh
            const text = JSON.stringify({ currentObservation: { ...details, ...(data ? { data } : {}) } }).slice(0, 30_000)
            const previous = retryObservation ? messages.indexOf(retryObservation) : -1
            if (previous >= 0) messages.splice(previous, 1)
            retryObservation = image?.data ? { role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: `data:${image.mime || 'image/png'};base64,${image.data}` } }] } : { role: 'user', content: text }
            messages.push(retryObservation)
            const frames = messages.filter(m => Array.isArray(m.content))
            for (const frame of frames.slice(0, -2)) frame.content = '[Eski ekran gözlemi.]'
            observed = fresh.ok && fresh.outcome === 'tamam'
          } catch (error) { deps.log('warn', `Yap güncel ekranı okuyamadı; modelin diğer araçları kullanılabilir: ${methodErrorText(error)}`) }
        }
        return deps.turn({ messages, tools, shouldStop: stopped, timeoutMs: Math.max(1, deadline - Date.now()) })
      }, {
        check: () => { if (deps.shouldStop()) throw new StoppedError() },
        wait: () => interruptibleSleep(3000, deps.shouldStop),
        retry: (error, round) => deps.log('warn', `YONTEM-TUR Yap tur=${round}: ${methodErrorText(error)}; güncel gözlemle model yöntemleri baştan deneniyor.`),
      })
    } catch (error) {
      if (deps.shouldStop()) throw new StoppedError()
      return markFailure(error)
    } finally {
      deadline += Math.max(0, Date.now() - modelStarted)
      waitingForModel = false
    }
    check()
    messages.push(answer)
    if (typeof answer.content === 'string' && answer.content.trim()) deps.log('info', `Yap: ${answer.content.slice(0, 1200)}`)
    if (!answer.tool_calls?.length) { messages.push({ role: 'user', content: 'Görevi araçlarla gerçekleştir; tamamlandıysa task_complete çağır.' }); continue }
    // All actions are sequential, including providers that send multiple calls in one turn.
    const pictures: ToolMessage[] = []
    for (const call of answer.tool_calls) {
      check()
      const toolName = call.function.name
      if (spendsAction(toolName) && used >= budget) break
      if (spendsAction(toolName) && !READ_OR_FINISH.has(toolName)) used++
      let result: RecoveryToolResult
      if (clearsScreen(toolName)) observed = false
      try {
        const definition = tools.find(t => t.function.name === toolName)
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
        if (toolName === 'task_give_up') {
          if (!observed || !args.reason.trim()) throw new Error('Bilinçli vazgeçme için önce güncel ekranı oku ve açık gerekçe ver.')
          throw new TaskNeedsRecoveryError(`Yap görevi tamamlayamadı; kurtarma gerekiyor: ${args.reason}`)
        }
        if (toolName === 'task_complete') {
          if (!args.summary.trim()) throw new Error('Tamamlandı açıklaması boş olamaz.')
          if (!observed) throw new Error('Tamamlandı demeden önce güncel ekranı OKU (screen_read) ve okuma başarılı olsun. Pencere/komut sonucu tek başına tamamlanma kanıtı sayılmaz.')
          deps.log('success', `Yap tamamlandı: ${args.summary.slice(0, 2000)}`)
          return true
        }
        deps.log('info', `Yap aracı: ${toolName} ${JSON.stringify(args)}`)
        result = await execute(names[toolName] || toolName, args)
        check()
        if (toolName === 'screen_read') observed = result.ok && result.outcome === 'tamam'
      } catch (error) {
        check()
        if (error instanceof TaskNeedsRecoveryError) return markFailure(error)
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
  return markFailure(new Error('Yap araç/adım sınırında görevi tamamlayamadı.'))
}
