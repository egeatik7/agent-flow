import { modelChain, type AgentGraph, type LogLevel } from './graph-types'
import { contextOf, findPlace } from './tool-context'
import { StoppedError, type RecoveryDecision, type RecoveryRequest } from './runner'
import { recoverySettings, type RecoverySettings } from './recovery-settings'
import type { ModelTool, ToolMessage } from './openrouter'

export const RECOVERY_ACTION_KINDS = ['click', 'type', 'key', 'wait']

export type RecoveryReport = {
  id: string
  startedAt: number
  endedAt: number
  model: string
  canvasId?: string
  nodeId: string
  nodeTitle: string
  error: string
  context: unknown
  result: 'retry' | 'completed' | 'stopped' | 'failed'
  probableCause: string
  evidence: string
  summary: string
  actions: { tool: string; args: Record<string, unknown>; outcome: string; message: string }[]
  resumed?: boolean
  resumeError?: string
  completionBasis?: 'node-executed' | 'model-observed'
}

export type RecoveryToolResult = { ok: boolean; outcome: string; message: string; data?: Record<string, unknown> }
type Dependencies = {
  settings: RecoverySettings
  shouldStop: () => boolean
  log: (level: LogLevel, message: string) => void
  turn: (args: { messages: ToolMessage[]; tools: ModelTool[]; shouldStop: () => boolean; timeoutMs: number }) => Promise<ToolMessage>
  makeExecute: (shouldStop: () => boolean) => (name: string, args: Record<string, unknown>) => Promise<RecoveryToolResult>
  recentLog: unknown
  previousReports?: unknown
  saveReport: (report: RecoveryReport) => void
}

const str = { type: 'string' }
function tool(name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ModelTool {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } }
}

export function recoveryTools(settings: RecoverySettings): ModelTool[] {
  const tools = [
    tool('screen_read', 'Güncel ekranı, açık pencereleri ve ekran görüntüsünü oku.', { windowTitle: str }),
    tool('flow_read', 'Bulunduğun tuvalin node ve paketlerini oku.'),
    tool('flow_context', 'Bir node için paket ve döngü bağlamını oku.', { nodeId: str }, ['nodeId']),
    tool('target_preview', 'Bir node hedefini güncel ekranda ara; girdi göndermez.', { nodeId: str }, ['nodeId']),
    tool('recovery_retry', 'Düzeltme hareketleri bitti. Motor aynı öğede hata veren node’u bir kez yeniden dener. Başarı bildirimi değildir.', { probableCause: str, evidence: str, summary: str }, ['probableCause', 'evidence', 'summary']),
    tool('recovery_complete', 'Güncel ekranı gördükten sonra mevcut node’un hedefinin başka yoldan gerçekleştiğini bildir. Motor mevcut node’u tekrarlamadan devam eder. Bu karar model gözlemine dayanır.', { probableCause: str, evidence: str, summary: str }, ['probableCause', 'evidence', 'summary']),
    tool('recovery_stop', 'Bu hatayı toparlayamadığını açık bir nedenle raporla.', { probableCause: str, evidence: str, summary: str }, ['probableCause', 'evidence', 'summary']),
  ]
  if (settings.allowDesktop) tools.push(
    tool('act_click', 'Ekrandaki hedefe tıkla.', { target: str, mode: { type: 'string', enum: ['left', 'double', 'right', 'move'] } }, ['target']),
    tool('act_type', 'Metni hedef alana veya odaktaki alana yaz.', { text: str, into: str, enter: { type: 'boolean' }, clear: { type: 'boolean' } }, ['text']),
    tool('act_key', 'Klavye kısayolu gönder. Gönderilmesi pencerenin kapandığını doğrulamaz.', { keys: str }, ['keys']),
    tool('act_wait', 'En fazla 10 saniye bekle.', { ms: { type: 'integer', minimum: 0, maximum: 10_000 } }, ['ms']),
  )
  if (settings.allowNodes) tools.push(tool('step_run', 'İzinli bir eylem node’unu mevcut döngü değişkenleriyle bir kez çalıştır. Bağlı sonraki node’lar çalışmaz. Hata veren node tamamlanırsa motor onu tekrarlamaz.', { nodeId: str }, ['nodeId']))
  return tools
}

/** Keep the executable JSON intact; embedded matching bitmaps are not task context. */
export function recoveryGraphJson(graph: AgentGraph): string {
  return JSON.stringify(graph, (key, value) => key === 'icon' || key === 'patch' || key === 'sig' ? undefined : value)
}

const names: Record<string, string> = { screen_read: 'screen.read', flow_read: 'flow.read', flow_context: 'flow.context', target_preview: 'target.preview', step_run: 'step.run', act_click: 'act.click', act_type: 'act.type', act_key: 'act.key', act_wait: 'act.wait' }

export async function runRecovery(request: RecoveryRequest, deps: Dependencies): Promise<{ decision: RecoveryDecision; report?: RecoveryReport }> {
  const settings = recoverySettings(deps.settings)
  if (!settings.enabled) return { decision: undefined }
  const startedAt = Date.now()
  const context = contextOf(request.graph, request.node.id)
  const report: RecoveryReport = {
    id: `recovery-${startedAt}-${Math.random().toString(36).slice(2, 10)}`,
    startedAt, endedAt: startedAt, model: modelChain(settings.model, settings.backups).join(' → '),
    nodeId: request.node.id, nodeTitle: request.node.title, error: request.error.message, context,
    result: 'failed', probableCause: '', evidence: '', summary: '', actions: [],
  }
  const deadline = startedAt + settings.timeoutMs
  const stopped = () => deps.shouldStop() || Date.now() >= deadline
  const check = () => { if (stopped()) throw new StoppedError() }
  const tools = recoveryTools(settings)
  const allowedTools = new Set(tools.map(t => t.function.name))
  const execute = deps.makeExecute(stopped)
  const allowedNodes = new Set([request.node.id, ...settings.allowedNodeIds])
  let completed = false
  let freshScreen = false
  const messages: ToolMessage[] = [{ role: 'system', content: `Nubbo kurtarma ajanısın. Yalnız hata sınırında devreye girdin; normal akış sen çalışırken bekliyor.
Akışı/JSON'u değiştirme veya baştan başlatma. Döngü öğesi ve yürütme yığını korunuyor. Yeni kod veya komut betiği üretme.
Yalnız Tıkla, Tuş Gönder, Yazı Yaz ve Zamanlayıcı eylemlerini kullan. İnisiyatif, Koşul, Paket ve Döngü çalıştıramazsın.
step_run yalnız izinli eylem node'larını mevcut öğeyle çalıştırır. Bitmiş işi tekrar etme. İşlem gönderildi ile sonuç gözlendi ayrımını koru.
Hata fırlaması, eylemin hiç gönderilmediğini kanıtlamaz. Kısmen veya tamamen yapılmış bir işlemi yeniden göndermeden güncel durumu ve günlüğü dikkate al.
Hata veren node step_run ile tamamlandıysa recovery_retry, motorun onu atlayıp sonraki adımı çalıştırmasını sağlar; bu node'u tekrar çağırma.
Hedefi alternatif hareketlerle gerçekleştirdiysen son hareketten sonra screen_read ile güncel ekranı gör ve recovery_complete çağır. Bu, mevcut hedefin tamamlandığına ilişkin model gözlemidir; raporda bu ayrımı koru.
Sırf metinle 'tamam' demek akışı ilerletmez. Sonunda recovery_retry, recovery_complete veya recovery_stop çağır; olası nedeni kesin kanıttan ayır ve Türkçe raporla.
${settings.instructions}` }, { role: 'user', content: JSON.stringify({
    task: settings.task || 'Mevcut tuvalde kullanıcının tanımladığı akışı tamamla.',
    failure: { node: request.live, error: request.error.message, stepNo: request.stepNo, ahead: request.ahead, vars: request.vars, context },
    allowedNodeIds: settings.allowNodes ? [...allowedNodes] : [], recentLog: deps.recentLog, previousRecoveryReports: deps.previousReports ?? [],
    canvasJson: JSON.parse(recoveryGraphJson(request.graph)),
  }, (key, value) => key === 'icon' || key === 'patch' || key === 'sig' ? undefined : value) }]
  deps.log('warn', `Kurtarma ajanı devrede: “${request.node.title}”. Mevcut döngü öğesi korunuyor.`)
  try {
    for (let calls = 0, turns = 0; calls < settings.maxCalls && turns < settings.maxCalls + 3; turns++) {
      check()
      const answer = await deps.turn({ messages, tools, shouldStop: stopped, timeoutMs: Math.max(1, deadline - Date.now()) })
      check()
      if (typeof answer.content === 'string' && answer.content.trim()) deps.log('info', `Kurtarma ajanı: ${answer.content.slice(0, 1200)}`)
      messages.push(answer)
      if (!answer.tool_calls?.length) {
        messages.push({ role: 'user', content: 'Harekete devam etmek için bir araç çağır. Yalnız açıklama başarı değildir; bitiriyorsan rapor alanlarıyla recovery_retry, recovery_complete veya recovery_stop çağır.' })
        continue
      }
      // Even if a provider ignores parallel_tool_calls:false, desktop input is sequential.
      const pictures: ToolMessage[] = []
      for (const call of answer.tool_calls) {
        check()
        if (calls++ >= settings.maxCalls) break
        let args: Record<string, unknown> = {}
        let result: RecoveryToolResult
        try {
          const parsed = JSON.parse(call.function.arguments)
          if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Araç argümanları nesne olmalı.')
          args = parsed
          const name = call.function.name
          if (!allowedTools.has(name)) throw new Error(`Bu araç için yetki yok: ${name}`)
          const schema = tools.find(t => t.function.name === name)!.function.parameters
          const properties = schema.properties as Record<string, { type?: string; enum?: string[] }>
          for (const key of schema.required as string[]) if (args[key] === undefined) throw new Error(`Eksik araç alanı: ${key}`)
          for (const [key, value] of Object.entries(args)) {
            const spec = properties[key]
            if (!spec) continue
            if ((spec.type === 'integer' && (typeof value !== 'number' || !Number.isInteger(value))) ||
              (spec.type !== 'integer' && typeof value !== spec.type) || (spec.enum && !spec.enum.includes(String(value)))) throw new Error(`Geçersiz araç alanı: ${key}`)
          }
          if (name === 'recovery_retry' || name === 'recovery_complete' || name === 'recovery_stop') {
            if (name === 'recovery_complete' && !completed && !freshScreen) throw new Error('Hedefin tamamlandığını bildirmeden önce son eylemden sonraki güncel ekranı screen_read ile gör.')
            report.probableCause = String(args.probableCause ?? '').slice(0, 6000)
            report.evidence = String(args.evidence ?? '').slice(0, 6000)
            report.summary = String(args.summary ?? '').slice(0, 6000)
            const done = completed || name === 'recovery_complete'
            report.result = name === 'recovery_stop' ? 'failed' : done ? 'completed' : 'retry'
            if (done) report.completionBasis = completed ? 'node-executed' : 'model-observed'
            return { decision: name === 'recovery_stop' ? 'stop' : done ? 'completed' : 'retry', report }
          }
          if (name === 'step_run' || name === 'target_preview') {
            const id = String(args.nodeId ?? '')
            const node = findPlace(request.graph, id)?.node
            if ((name === 'step_run' && !allowedNodes.has(id)) || !node || !RECOVERY_ACTION_KINDS.includes(node.kind)) throw new Error('Yalnız Tıkla, Tuş Gönder, Yazı Yaz ve Zamanlayıcı node’ları kullanılabilir; bu node için yetki yok.')
            if (name === 'step_run' && id === request.node.id && completed) throw new Error('Hata veren node zaten tamamlandı; tekrar çalıştırılmaz.')
          }
          // No injected graph, branch, timeout or settings arguments reach the tool layer.
          const keys = Object.keys(schema.properties as Record<string, unknown>)
          args = Object.fromEntries(Object.entries(args).filter(([key]) => keys.includes(key)))
          if (name === 'act_wait') args.ms = Math.max(0, Math.min(10_000, typeof args.ms === 'number' ? args.ms : 1000))
          deps.log('info', `Kurtarma aracı: ${names[name]} ${JSON.stringify(args).slice(0, 500)}`)
          if (name.startsWith('act_') || name === 'step_run') freshScreen = false
          result = await execute(names[name], args)
          check()
          if (name === 'screen_read') freshScreen = result.ok && result.outcome === 'tamam'
          if (name === 'step_run' && args.nodeId === request.node.id && result.ok && result.outcome === 'tamam') completed = true
        } catch (error) {
          if (error instanceof StoppedError) throw error
          result = { ok: false, outcome: 'hata', message: (error as Error).message }
        }
        const data = result.data ? { ...result.data } : undefined
        const img = data?.image as { data?: string; mime?: string } | undefined
        if (data) delete data.image
        const reply = { ...result, ...(data ? { data } : {}) }
        report.actions.push({ tool: call.function.name, args, outcome: result.outcome, message: result.message })
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(reply).slice(0, 30_000) })
        if (img?.data) pictures.push({ role: 'user', content: [{ type: 'text', text: 'Son screen_read gözleminin güncel ekran görüntüsü.' }, { type: 'image_url', image_url: { url: `data:${img.mime || 'image/png'};base64,${img.data}` } }] })
      }
      messages.push(...pictures)
      // Keep the latest two screenshots; the action/observation transcript stays intact.
      const frames = messages.filter(m => Array.isArray(m.content))
      for (const old of frames.slice(0, -2)) old.content = '[Önceki ekran görüntüsü; yazılı gözlemi araç cevabında.]'
    }
    report.summary = 'Kurtarma ajanının araç/adım sınırı doldu.'
    return { decision: 'stop', report }
  } catch (error) {
    report.result = deps.shouldStop() ? 'stopped' : 'failed'
    report.summary = deps.shouldStop() ? 'Kullanıcı durdurdu.' : Date.now() >= deadline ? 'Kurtarma süresi doldu.' : `Kurtarma çağrısı başarısız: ${(error as Error).message}`
    if (deps.shouldStop()) throw new StoppedError()
    return { decision: 'stop', report }
  } finally {
    report.endedAt = Date.now()
    try { deps.saveReport(report) } catch (error) { deps.log('warn', `Kurtarma raporu kaydedilemedi: ${(error as Error).message}`) }
    deps.log(report.result === 'retry' || report.result === 'completed' ? 'info' : 'warn', `Kurtarma raporu: ${report.summary || report.result}${report.probableCause ? ` Olası neden: ${report.probableCause}` : ''}`)
  }
}
