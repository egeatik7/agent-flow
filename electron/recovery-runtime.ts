import { createAgent } from './agent'
import { callTool, type ToolContext } from './tools'
import { runGraph, StoppedError, type RecoveryRequest, type Executor } from './runner'
import { findPlace } from './tool-context'
import { renderTemplate, type AgentNode, type AppSettings } from './graph-types'
import { RECOVERY_ACTION_KINDS, type RecoveryToolResult } from './recovery'
import { recoverySettings } from './recovery-settings'

/** An internal session owns the paused run; public tools still see `running:true`. */
export function recoveryExecutor(request: RecoveryRequest, base: ToolContext, shouldStop: () => boolean, sharedExecutor?: Executor) {
  const graph = structuredClone(request.graph)
  const allowed = new Set([request.node.id, ...recoverySettings(base.getSettings().recovery).allowedNodeIds])
  const check = () => { if (shouldStop()) throw new StoppedError() }
  const isolated = sharedExecutor ? { executor: sharedExecutor } : createAgent({
    log: (level, message) => base.log(level === 'error' ? 'warn' : level, `Kurtarma · ${message}`),
    send: () => {}, // Probe memory/paths and step telemetry must not overwrite the live run.
    settings: base.getSettings,
    shouldStop,
  })
  const readContext: ToolContext = { ...base, getGraph: () => structuredClone(graph), isRunning: () => false,
    userStop: shouldStop, clearStop: undefined, sendStep: () => {}, permission: () => 'auto',
    startRun: async () => { throw new Error('Kurtarma ajanı yeni koşu başlatamaz.') },
  }
  return async (name: string, args: Record<string, unknown>): Promise<RecoveryToolResult> => {
    check()
    if (['screen.read', 'flow.read', 'flow.context', 'target.preview'].includes(name)) {
      if (name === 'target.preview') {
        const node = findPlace(graph, String(args.nodeId ?? ''))?.node
        if (!node || !RECOVERY_ACTION_KINDS.includes(node.kind)) throw new Error('Bu node türü kurtarma ajanına açık değil.')
      }
      const result = await callTool(name, { ...args, ...(name === 'screen.read' ? { image: true } : {}), ...(name === 'target.preview' ? { fast: true } : {}) }, readContext, 'panel')
      check()
      return result
    }
    let node: AgentNode
    if (name === 'step.run') {
      const id = String(args.nodeId ?? '')
      const found = findPlace(graph, id)?.node
      if (!allowed.has(id) || !found || !RECOVERY_ACTION_KINDS.includes(found.kind)) throw new Error('Bu node’u çağırma yetkisi yok.')
      node = structuredClone(id === request.node.id ? request.live : found)
      // Use the paused lap's actual variables; no new folder listing or resumed loop is built.
      for (const field of ['prompt', 'text', 'keys', 'folder', 'pattern', 'source', 'url'] as const) node[field] = renderTemplate(node[field], request.vars)
    } else {
      const settings = recoverySettings(base.getSettings().recovery)
      if (!settings.allowDesktop) throw new Error('Ekran eylemleri kapalı.')
      const kinds: Record<string, 'click' | 'type' | 'key' | 'wait'> = { 'act.click': 'click', 'act.type': 'type', 'act.key': 'key', 'act.wait': 'wait' }
      const kind = kinds[name]
      if (!kind) throw new Error(`Kurtarma aracı yok: ${name}`)
      node = { id: `recovery-action-${Date.now()}`, kind, title: name, x: 0, y: 0,
        ...(kind === 'click' ? { prompt: String(args.target ?? ''), clickMode: args.mode as AgentNode['clickMode'] } : {}),
        ...(kind === 'type' ? { text: String(args.text ?? ''), prompt: String(args.into ?? ''), pressEnter: args.enter === true, clearFirst: args.clear !== false } : {}),
        ...(kind === 'key' ? { keys: String(args.keys ?? '') } : {}),
        ...(kind === 'wait' ? { ms: Math.max(0, Math.min(10_000, Number(args.ms) || 0)) } : {}),
      }
      if (kind === 'click' && !node.prompt?.trim() || kind === 'type' && !node.text?.trim() || kind === 'key' && !node.keys?.trim()) throw new Error('Kurtarma eyleminin hedefi/metni/tuşu boş.')
    }
    if (name === 'step.run' && !recoverySettings(base.getSettings().recovery).allowNodes) throw new Error('Node çağırma kapalı.')
    check()
    const s: AppSettings = base.getSettings()
    const source = sharedExecutor ?? isolated.executor
    const executor: Executor = { ...source, recover: undefined, shouldStop, patchNode: () => {}, step: () => {},
      click: (n, stepNo) => source.click(n, stepNo, n.id === request.node.id ? request.ahead : undefined),
      type: (n, stepNo) => source.type(n, stepNo, n.id === request.node.id ? request.ahead : undefined),
    }
    // A one-node graph cannot reach a sibling, a package or a loop.
    await runGraph({ nodes: [node], edges: [] }, executor, {
      maxSteps: 1, stepDelayMs: Math.max(0, s.stepDelayMs), vars: { ...request.vars },
    })
    check()
    return { ok: true, outcome: 'tamam', message: `“${node.title}” tek adım olarak çalıştı. Bağlı adımlar çalıştırılmadı; dış uygulamadaki sonuç ayrıca gözlemlenebilir.`, data: { nodeId: node.id, kind: node.kind, sent: node.kind !== 'wait' } }
  }
}
