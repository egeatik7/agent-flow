import { methodErrorText, TaskNeedsRecoveryError } from './method-cycle'
import { interruptibleSleep, StoppedError } from './runner'
import { YAP_PROMPT } from './llm-flow'
import { windowsTools } from './windows-tools'
import type { AgentNode, LogLevel } from './graph-types'
import type { ModelTool, ToolMessage } from './openrouter'
import { recoveryTools, type RecoveryToolResult } from './recovery'
import { DEFAULT_RECOVERY } from './recovery-settings'
import { yapActionRecord, yapFailureKind, yapFingerprint, yapInputEstimate, yapMessages, yapObservationKey, yapObservationValid, yapToolSummary, type YapActionRecord, type YapProgress } from './yap-context'

export function yapTools(allowCode = true, allowFlowRead = false): ModelTool[] {
  const excluded = new Set(['target_preview', 'step_run', 'recovery_retry', 'recovery_complete', 'recovery_stop', ...(!allowFlowRead ? ['flow_read', 'flow_context'] : [])])
  const tools = recoveryTools({ ...DEFAULT_RECOVERY, allowDesktop: true, allowNodes: false }).filter(t => !excluded.has(t.function.name) && !['window_action', 'powershell_run'].includes(t.function.name))
  const screen = tools.find(t => t.function.name === 'screen_read')!
  screen.function.description = 'Güncel ekranı ve kısa pencere listesini oku. Yazı gerekiyorsa details:true; query ile filtrele veya offset ile sonraki sayfayı iste (limit en çok 24). hwnd için pid de ver. Eşleşmeyen pencere başarı kanıtı değildir.'
  screen.function.parameters = { ...screen.function.parameters, properties: { windowTitle: { type: 'string' }, hwnd: { type: 'string' }, pid: { type: 'integer' }, details: { type: 'boolean' }, query: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' } } }
  return [...windowsTools(allowCode), ...tools, {
    type: 'function' as const, function: { name: 'task_complete', description: 'Son eylemden sonra güncel hedefi gözlemlediysen görevi kısa kanıtla tamamla.', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'], additionalProperties: false } },
  }, {
    type: 'function' as const, function: { name: 'task_give_up', description: 'Görevi tamamlayamıyorsan açık gerekçeyle kurtarmaya aktar. Koşuyu doğrudan durdurmaz.', parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'], additionalProperties: false } },
  }]
}

const names: Record<string, string> = { screen_read: 'screen.read', flow_read: 'flow.read', flow_context: 'flow.context', act_click: 'act.click', act_move: 'act.move', act_click_current: 'act.clickCurrent', act_click_point: 'act.clickPoint', act_type: 'act.type', act_key: 'act.key', act_wait: 'act.wait' }
const spendsAction = (name: string) => name.startsWith('act_') || name === 'window_action' || name === 'powershell_run'
const sendsInput = (name: string) => spendsAction(name) && name !== 'act_wait'
type Deps = {
  system?: string
  shouldStop: () => boolean
  log: (level: LogLevel, message: string) => void
  progress?: (state: YapProgress) => void
  /** Elapsed time, never the adjustable wall clock. */
  clock?: () => number
  makeExecute: (shouldStop: () => boolean) => (name: string, args: Record<string, unknown>) => Promise<RecoveryToolResult>
  turn: (args: { messages: ToolMessage[]; tools: ModelTool[]; shouldStop: () => boolean; timeoutMs: number }) => Promise<ToolMessage>
}

/** Fresh requests carry one observation and a code-owned action ledger, never a growing chat. */
export async function runYap(node: AgentNode, context: unknown, deps: Deps): Promise<boolean> {
  const budget = Math.min(60, Math.max(1, Math.floor(node.maxActions ?? 25)))
  const clock = deps.clock || (() => performance.now())
  let deadline = clock() + Math.min(900_000, Math.max(10_000, node.timeoutMs || 300_000))
  let waitingForModel = false, actionStarted = false, used = 0, compact = 0, failures = 0, idleReads = 0
  let observed = false, observation: RecoveryToolResult | undefined, lastResult: unknown, instruction = ''
  let lastObservationKey = '', lastActionKey = '', sameActionWithoutRead = 0, rejectedContext = ''
  let lastReadScope: Record<string, unknown> = {}
  const ledger: YapActionRecord[] = [], toolFailures = new Map<string, number>()
  const state: YapProgress = { phase: 'observing', lastModelAt: null, lastActionAt: null, failures: 0, message: 'Güncel ekran okunuyor' }
  const publish = (phase: YapProgress['phase'], message: string) => {
    Object.assign(state, { phase, message, failures })
    try { deps.progress?.({ ...state }) } catch { /* Monitoring must not replay an action or end a task. */ }
  }
  const handoff = (reason: string): never => {
    publish('recovery', 'İlerleme sağlanamadı; kurtarmaya aktarılıyor')
    const error = new TaskNeedsRecoveryError(`Yap kurtarma gerekiyor: ${reason}`)
    Object.assign(error, { inputMayHaveBeenSent: actionStarted, yapActions: ledger.map(entry => ({ ...entry })) })
    throw error
  }
  const stopped = () => deps.shouldStop() || (!waitingForModel && clock() >= deadline)
  const check = () => {
    if (deps.shouldStop()) throw new StoppedError()
    if (clock() >= deadline) handoff('Yap süresi doldu. Aynı görev ve öğe korunuyor.')
  }
  const execute = deps.makeExecute(stopped)
  const read = async (args: Record<string, unknown> = {}) => {
    check()
    publish('observing', 'Güncel ekran okunuyor')
    observed = false
    observation = undefined
    lastReadScope = Object.fromEntries(Object.entries(args).filter(([key]) => ['windowTitle', 'hwnd', 'pid'].includes(key)))
    const fresh = await execute('screen.read', args)
    check()
    observed = yapObservationValid(fresh)
    observation = fresh
    const key = yapObservationKey(fresh, args)
    idleReads = key === lastObservationKey ? idleReads + 1 : 0
    lastObservationKey = key
    sameActionWithoutRead = 0
    return fresh
  }
  const tools = yapTools(node.allowCode !== false, node.allowFlowRead === true)
  try { lastResult = yapToolSummary(await read()) } catch (error) {
    check()
    lastResult = { ok: false, message: methodErrorText(error) }
  }
  const maxTurns = Math.max(budget * 4, 40)
  for (let turns = 0; turns < maxTurns; turns++) {
    check()
    let answer: ToolMessage
    for (;;) {
      check()
      const messages = yapMessages({ system: deps.system?.trim() || YAP_PROMPT, task: node.prompt || '', context, observation, ledger, lastResult, instruction, compact })
      if (rejectedContext && yapFingerprint(messages) === rejectedContext) {
        if (compact < 2) { compact++; continue }
        handoff('Bağlam hatasından sonra daha küçük/farklı istek oluşturulamıyor. Aynı reddedilmiş istek yeniden gönderilmedi.')
      }
      const estimate = yapInputEstimate(messages, tools)
      if (estimate > 24_000) {
        if (compact < 2) { compact++; continue }
        handoff(`Yap giriş bütçesi küçültülmüş durumda da aşılıyor (korumacı tahmin ${estimate}; tokenizer ölçümü değil). Görev veya gönderilen eylemler sessizce kesilmedi.`)
      }
      publish('model', 'Model cevabı bekleniyor')
      const started = clock()
      waitingForModel = true
      try {
        answer = await deps.turn({ messages, tools, shouldStop: stopped, timeoutMs: Math.max(1, deadline - clock()) })
        if (deps.shouldStop()) throw new StoppedError()
        state.lastModelAt = clock()
        failures = 0
        rejectedContext = ''
        break
      } catch (error) {
        if (deps.shouldStop()) throw new StoppedError()
        failures++
        const kind = yapFailureKind(error)
        deps.log('warn', `YAP-TEKRAR tür=${kind} deneme=${failures}: ${methodErrorText(error)}`)
        if (kind === 'context') {
          rejectedContext = yapFingerprint(messages)
          if (compact >= 2) handoff(`Bağlam küçültülmesine rağmen istek sığmadı: ${methodErrorText(error)}`)
          compact++
          instruction = 'İstek bağlam sınırı nedeniyle küçültüldü. Görev ve gönderilen eylemler korundu; yeni yöntem seç.'
          continue
        }
        if (kind === 'permanent' || failures >= 6) handoff(`Model yöntemleri sonuç vermedi: ${methodErrorText(error)}`)
        publish('retry', 'Model yanıtlamadı; yeniden denenecek')
      } finally {
        deadline += Math.max(0, clock() - started)
        waitingForModel = false
      }
      await interruptibleSleep(3000, deps.shouldStop, clock)
      check()
      // Refresh the image, but retain the latest requested tool result (including a detail page or error).
      try { await read(lastReadScope) } catch (error) { check(); instruction = `Güncel ekran yenilenemedi: ${methodErrorText(error)}. Son araç sonucu korunuyor; görüntü kanıtı yok.` }
    }
    check()
    if (typeof answer.content === 'string' && answer.content.trim()) deps.log('info', `Yap: ${answer.content.slice(0, 1200)}`)
    if (!answer.tool_calls?.length) { instruction = 'Görevi araçlarla gerçekleştir; yalnız metin tamamlanma değildir.'; continue }
    for (const call of answer.tool_calls) {
      check()
      const toolName = call.function.name
      let args: Record<string, unknown> = {}, result: RecoveryToolResult
      let dispatched = false
      try {
        const definition = tools.find(t => t.function.name === toolName)
        if (!definition) throw new Error('Bu araç Yap ajanına açık değil.')
        args = JSON.parse(call.function.arguments)
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Araç argümanları nesne olmalı.')
        const schema = definition.function.parameters
        const properties = schema.properties as Record<string, { type: string; enum?: string[] }>
        for (const key of schema.required as string[]) if (!(key in args)) throw new Error(`Eksik alan: ${key}`)
        for (const [key, value] of Object.entries(args)) {
          const spec = properties[key]
          if (!spec || (spec.type === 'integer' ? !Number.isInteger(value) : typeof value !== spec.type) || (spec.enum && !spec.enum.includes(String(value)))) throw new Error(`Geçersiz alan: ${key}`)
        }
        if (toolName === 'task_give_up') handoff(String(args.reason || 'Model görevi tamamlayamadı.'))
        if (toolName === 'task_complete') {
          if (!String(args.summary || '').trim()) throw new Error('Tamamlandı açıklaması boş olamaz.')
          if (!observed) throw new Error('Tamamlandı demeden önce son eylemden sonra screen_read ile güncel hedefi başarıyla oku. Eşleşmeyen pencere yeterli değildir.')
          deps.log('success', `Yap tamamlandı: ${String(args.summary).slice(0, 2000)}`)
          publish('completed', 'Görev tamamlandı')
          return true
        }
        const action = spendsAction(toolName)
        if (action && used >= budget) handoff('Yap eylem sınırında; gönderilmiş eylemler tekrar oynatılmadan kurtarma gerekiyor.')
        const replayRisk = ['act_key', 'act_type', 'act_click', 'act_click_point', 'act_click_current', 'powershell_run'].includes(toolName)
        if (replayRisk && ledger.some(entry => !entry.ok && entry.key === yapFingerprint({ tool: toolName, args }))) {
          handoff('Önceki girdinin teslimi belirsiz; aynı işlem yeniden gönderilmeden kurtarma gerekiyor.')
        }
        const key = yapFingerprint({ toolName, args })
        if (action && key === lastActionKey && sameActionWithoutRead >= 2) handoff('Aynı eylem yeni gözlem olmadan yineleniyor.')
        if (action) {
          used++
          observed = false
          observation = undefined
          idleReads = 0
          sameActionWithoutRead = key === lastActionKey ? sameActionWithoutRead + 1 : 1
          lastActionKey = key
          if (sendsInput(toolName)) actionStarted = true
          state.lastActionAt = clock()
          publish('action', `Araç: ${toolName}`)
        }
        deps.log('info', `Yap aracı: ${toolName} ${JSON.stringify(args)}`)
        dispatched = action
        result = toolName === 'screen_read' ? await read(args) : await execute(names[toolName] || toolName, args)
        if (action) ledger.push(yapActionRecord(toolName, args, result))
        dispatched = false
        check()
        if (toolName === 'screen_read' && idleReads >= 6) handoff('Aynı ekran tekrar tekrar okunuyor; yeni yöntem veya kurtarma gerekiyor.')
      } catch (error) {
        result = { ok: false, outcome: 'hata', message: methodErrorText(error) }
        if (dispatched) ledger.push(yapActionRecord(toolName, args, result))
        check()
        if (error instanceof TaskNeedsRecoveryError) {
          Object.assign(error, { inputMayHaveBeenSent: actionStarted || (error as Error & { inputMayHaveBeenSent?: boolean }).inputMayHaveBeenSent === true, yapActions: ledger.map(entry => ({ ...entry })) })
          throw error
        }
      }
      lastResult = { tool: toolName, result: yapToolSummary(result, args.details === true) }
      deps.log(result.ok ? 'info' : 'warn', `YAP-SONUC araç=${toolName} durum=${result.outcome} ${JSON.stringify(yapToolSummary(result)).slice(0, 1200)}`)
      const failureKey = yapFingerprint({ toolName, args })
      if (!result.ok || result.outcome !== 'tamam') {
        const n = (toolFailures.get(failureKey) || 0) + 1
        toolFailures.set(failureKey, n)
        instruction = 'Son araç başarısız. Aynı çağrıyı körlemesine yineleme; farklı yöntem seç veya kurtarmaya aktar.'
        if (n >= 3) handoff(`Aynı araç üç kez sonuç vermedi: ${toolName}. ${result.message}`)
        // Later calls were planned before this failure was known. Ask again instead of executing them blind.
        break
      } else instruction = ''
    }
  }
  return handoff('Yap araç/adım sınırında görevi tamamlayamadı.')
}
