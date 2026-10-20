import { checkpointGraphPath, type CheckpointCursor, type CheckpointLoop, type CheckpointScope } from './checkpoint-types'
import { assertRunStructure } from './run-structure'
import { repeatMethodCycle, methodErrorText, DeliberateStopError, RecoveryFailedError } from './method-cycle'
import { type ObservationOptions } from './observation-budget'
import {
  NODE_SPECS,
  conditionCompatibilityError,
  baseName,
  itemVars,
  hasTemplate,
  listItems,
  loopKeys,
  loopStartIndex,
  portLabel,
  renderTemplate,
  type AgentGraph,
  type AgentNode,
  type LogLevel,
  type StepStatus,
} from './graph-types'
import { firstMember, ownerOf } from './groups'
import { listDirEntries } from './list-dir'
import { outsideFolder, outsideVars, packageHost } from './enclosing'
import type { DeliveryState, TypeProgress } from './graph-types'

/** The next one or two nodes, already filled with the current loop variables. */
export type StepAhead = { next?: AgentNode; then?: AgentNode }

export type RecoveryRequest = {
  graph: AgentGraph
  node: AgentNode
  live: AgentNode
  error: Error
  stepNo: number
  ahead: StepAhead
  vars: Record<string, string>
  /** The failed node already delivered a click, key or text to the OS. */
  inputAlreadySent?: boolean
  /** A native send started and its result is uncertain. Also blocks a blind second press. */
  inputMayHaveBeenSent?: boolean
  /** Focus, text and Enter each stay not_sent, uncertain or sent. */
  typeProgress?: TypeProgress
  /** not_sent: nothing reached the worker. uncertain: written, not confirmed. sent: worker succeeded. */
  inputDelivery?: DeliveryState
}

export type RecoveryDecision = 'retry' | 'completed' | 'stop' | 'disabled' | 'failed' | 'var' | 'yok' | undefined

export type LoopProgress = { id: string; title: string; index: number; total: number; item: string }

export type Executor = {
  checkpoint?: (label: string, cursor: CheckpointCursor) => Promise<void>
  /** Runs only at a failed action boundary; the existing loop stack remains paused. */
  recover?: (request: RecoveryRequest) => Promise<RecoveryDecision>
  recoveryFinished?: (nodeId: string, ok: boolean, error?: string) => void
  log: (level: LogLevel, message: string) => void
  step: (id: string, status: StepStatus) => void
  /** Display-only telemetry: an actual chosen connection, never a look-ahead. */
  edge?: (id: string, from: string, to: string) => void
  shouldStop: () => boolean
  click: (node: AgentNode, stepNo: number, ahead?: StepAhead) => Promise<void>
  /** Ephemeral pointer input; does not add fields or nodes to the saved graph. */
  pointerAction?: (action: { mode: 'move' | 'left' | 'double' | 'right'; x?: number; y?: number; current?: boolean }) => Promise<{ x: number; y: number; sent: boolean }>
  pointerPosition?: () => Promise<{ x: number; y: number } | undefined>
  type: (node: AgentNode, stepNo: number, ahead?: StepAhead) => Promise<void>
  key: (node: AgentNode, ahead?: StepAhead) => Promise<void>
  exists: (text: string, node: AgentNode, options?: ObservationOptions) => Promise<boolean>
  /** Yap: reach the goal in a few actions. */
  initiative?: (node: AgentNode, stepNo: number, ahead?: StepAhead, vars?: Record<string, string>) => Promise<boolean>
  /** Persist a change to a node (which item is on screen, memory) in the editor. */
  patchNode?: (id: string, patch: Partial<AgentNode>) => void
  /** A lap hit an error: keep a picture of the screen for later. */
  captureFailure?: (label: string) => Promise<void>
  /** The loop item the current node is inside. Empty when the node is not in a loop. */
  setLoop?: (text: string) => void
  setLoopProgress?: (loops: LoopProgress[]) => void
}

export class StoppedError extends Error {
  constructor() {
    super('Kullanıcı tarafından durduruldu.')
  }
}

/** A step ended on a failure port that leads nowhere (zaman aşımı, olmadı). */
export class StepFailedError extends Error {}

/** The loop stopped on this item. The tick stays here. */
export class LoopHalted extends Error {}

/** The condition could not decide (no reader gave a clear answer). Routed by the runner, never shown as "yok". */
export class ConditionUndecidedError extends Error {}

/** A condition answered no (or stayed undecided) and nothing downstream or in recovery can continue the flow. Stops the whole run. */
export class ConditionHaltError extends Error {}

/** A step that cannot succeed by retrying (boş koşul, kaldırılmış tür, paket içi hata). */
export class PermanentStepError extends Error {}

class EndFlow extends Error {}
class StepLimitError extends Error {}
/** A single lap went over the step budget. Keep this item; do not start the next job. */
class LapLimitError extends Error {}

type Budget = { used: number }

/**
 * Counts shared by a whole run, including the packages it climbs out of. `failed` is loop items or
 * laps that ended on an error; `stepFailures` is steps that ended on an error OUTSIDE a box (an
 * unconnected failure output, a step that threw). `loopDepth` is how many box laps are open right
 * now, so a step failure inside a lap is not counted twice (once as a step, once as an item).
 */
export type Tally = { n: number; failed: number; stepFailures: number; loopDepth: number }

/** A fresh tally for one run. */
export function newTally(): Tally {
  return { n: 0, failed: 0, stepFailures: 0, loopDepth: 0 }
}

/** What a run reports when it ends without being stopped: steps taken, and the failures it counted. */
export type RunSummary = { steps: number; failed: number; incomplete?: boolean; reachedEnd?: boolean; packageExitReached?: boolean }

/** At most this many item names are listed in the end-of-loop summary. */
const FAILED_NAMES_SHOWN = 5

/**
 * The error text says the model service is down or refusing, so the rest of the list would fail the same way.
 * A bare 401, 402 or 429 does not count: it can be part of a file name or a coordinate. A code in parentheses counts
 * only when an API word sits right before it, because these messages carry user text too: "(401)" on its own matches
 * a file name like "video(429).glb" and would stop the whole list.
 */
export function isApiDown(message: string): boolean {
  return /^(?:OpenRouter\b.*(?:\b(?:401|402|429|5\d\d)\b|anahtar.*geçersiz|bakiy.*yetersiz|insufficient credits|rate limit)|(?:API|Model|Yerel sunucu|Sunucu|Bağlantı hatası)\b.*(?:\((?:401|402|429)\)|rate limit|too many requests|quota exceeded|resourceexhausted|upstream error|cevap vermedi|bağlantı))|^resourceexhausted\b|^rate limit\b|^too many requests\b|^upstream error\b/i.test(message)
}

export async function interruptibleSleep(ms: number, shouldStop: () => boolean, clock: () => number = () => Date.now()) {
  const end = clock() + ms
  while (clock() < end) {
    if (shouldStop()) throw new StoppedError()
    await new Promise((r) => setTimeout(r, Math.min(100, end - clock())))
  }
}

export function findEntry(graph: AgentGraph, startId?: string): AgentNode | undefined {
  if (startId) return graph.nodes.find((n) => n.id === startId)
  return graph.nodes.find((n) => n.kind === 'start') ?? graph.nodes.find((n) => !graph.edges.some((e) => e.to === n.id))
}

export function renderNode(node: AgentNode, vars: Record<string, string>): AgentNode {
  // O11 (yönerge): `templated` bir KÖKEN bilgisidir (hedefinde şablon var mıydı) ve bir kez doğruysa
  // render sonrası KAYBOLMAMALIDIR. Önceden her çağrıda yeniden hesaplanıp mevcut değer EZİLİYORDU;
  // kurtarma `step.run` yolunda alanlar ZATEN render edilmiş geldiği için (runner.ts:382 → ex.recover →
  // recovery-runtime) bayrak false'a düşüyordu. Sonuç: `agent.ts` `mem = node.templated ? undefined :
  // memoFor(node)` hafızayı AÇIYOR ve `{{öğe}}` hedefli düğüm SON TURUN öğesine yönelebiliyordu
  // ("{{öğe}} içeren hedef değişir, son turun yeri yanlış öğeyi gösterir" kuralı devre dışı kalıyordu).
  // Artık var olan `true` korunur; hiçbir düğüm şablonlu SAYILMAZ (bayrak yalnız true'ya yükselir).
  const templated = node.templated === true || [node.prompt, node.text, node.keys, node.url, node.pattern, node.source].some((f) => !!f && /\{\{[^{}]+\}\}/.test(f))
  return {
    ...node,
    templated,
    prompt: renderTemplate(node.prompt, vars),
    text: renderTemplate(node.text, vars),
    keys: renderTemplate(node.keys, vars),
    url: renderTemplate(node.url, vars),
    folder: node.kind === 'loop' ? node.folder : renderTemplate(node.folder, vars),
    pattern: renderTemplate(node.pattern, vars),
    source: renderTemplate(node.source, vars),
  }
}

const FAIL_PORTS = new Set(['timeout', 'fail'])

function isFatal(e: unknown) {
  return e instanceof ConditionHaltError || e instanceof RecoveryFailedError || e instanceof DeliberateStopError || e instanceof StoppedError || e instanceof EndFlow || e instanceof StepLimitError || e instanceof LapLimitError || e instanceof LoopHalted
}

export async function runGraph(
  graph: AgentGraph,
  ex: Executor,
  opts: {
    maxSteps: number
    stepDelayMs: number
    checkpointResume?: CheckpointCursor
    checkpointUsed?: Set<string>
    checkpointLoops?: CheckpointLoop[]
    checkpointScopes?: CheckpointScope[]
    /** Opt-in evidence for canvas sequencing; normal runs keep their existing result shape. */
    reportEnd?: boolean
    startId?: string
    nested?: boolean
    root?: AgentGraph
    resume?: boolean
    /** Debug koşusu: ilk hatalı adımda durur ve o anın bağlamını saklar. */
    debug?: boolean
    /** Hatadan devam ederken kayıtlı öğenin kimliği: devam İNDEKSE değil bu öğeye göre yapılır. */
    resumeLoopId?: string
    resumeItem?: string
    packagePath?: string[]
    /** This node already finished. Continue from its sonraki step, then climb out of the boxes around it. */
    afterNodeId?: string
    /** Runtime-only boundary evidence; never written into a canvas JSON. */
    packageExit?: AgentNode['packageExit']
    afterNodePort?: 'next' | 'blocked'
    resumeState?: { identityUsed: boolean }
    /** Shared step and failure count when a run climbs out of packages. */
    tally?: Tally
    /** Variables the run starts with. A package gets those of the loop lap it runs in. */
    vars?: Record<string, string>
    /** Runtime telemetry inherited through packages; never saved in graph JSON. */
    loopProgress?: LoopProgress[]
  }
): Promise<RunSummary> {
  // Non-UI/tool callers receive the same structural rejection before execution.
  if (!opts.nested && !opts.afterNodeId) assertRunStructure(graph, { startId: opts.startId, packagePath: opts.packagePath })
  const checkpointUsed = opts.checkpointUsed ?? new Set<string>()
  const resumeState = opts.resumeState ?? { identityUsed: false }
  if (opts.packagePath?.length) {
    const layers: { parent: AgentGraph; pkg: AgentNode }[] = []
    let cursor = graph
    for (const id of opts.packagePath) {
      const pkg = cursor.nodes.find((n) => n.id === id && n.kind === 'package')
      if (!pkg?.inner) throw new Error('Açık paket bu akışta yok.')
      layers.push({ parent: cursor, pkg })
      cursor = pkg.inner
    }
    // Validate the outside cursor BEFORE a package-local node can send input.
    if (opts.resume && opts.resumeItem && opts.resumeLoopId && !resumeState.identityUsed) {
      const findLoop = (g: AgentGraph): AgentNode | undefined => {
        for (const n of g.nodes) {
          if (n.id === opts.resumeLoopId && n.kind === 'loop') return n
          if (n.inner) { const found = findLoop(n.inner); if (found) return found }
        }
      }
      const loop = findLoop(opts.root ?? graph)
      if (!loop) throw new Error('Kayıtlı döngü bulunamadı; girdi gönderilmedi.')
      const keys = loopKeys(loop)
      const matches = keys.flatMap((item, index) => item === opts.resumeItem ? [index] : [])
      if (matches.length !== 1) throw new Error(`“${loop.title}”: kayıtlı öğe (“${opts.resumeItem}”) ${matches.length ? 'birden fazla satırda; devam konumu belirsiz' : 'yeni listede yok'}; girdi gönderilmedi.`)
      loop.startIndex = matches[0]
      loop.loopIndex = matches[0]
    }
    const shared = {
      checkpointResume: opts.checkpointResume, checkpointUsed,
      maxSteps: opts.maxSteps,
      stepDelayMs: opts.stepDelayMs,
      root: opts.root ?? graph,
      resume: opts.resume,
      debug: opts.debug,
      reportEnd: opts.reportEnd,
      resumeLoopId: opts.resumeLoopId,
      resumeItem: opts.resumeItem,
      resumeState,
      tally: opts.tally ?? newTally(),
    }
    // Manual package entry has no live callers. Carry the frozen ancestor frames/scopes
    // into newly captured checkpoints until those callers are rebuilt on the way out.
    const inheritedCheckpoint = (home: AgentGraph) => {
      const path = checkpointGraphPath(opts.root ?? graph, home)
      const scopes = opts.checkpointResume?.scopes.filter(s => s.path.length < path.length && s.path.every((id, i) => path[i] === id)) ?? []
      const ancestorIds = new Set<string>()
      let ancestor = opts.root ?? graph
      for (const id of path) {
        for (const n of ancestor.nodes) ancestorIds.add(n.id)
        ancestor = ancestor.nodes.find(n => n.id === id)!.inner!
      }
      return { checkpointLoops: opts.checkpointResume?.loops.filter(f => ancestorIds.has(f.id)) ?? [], checkpointScopes: scopes }
    }
    let summary = await runGraph(cursor, ex, { ...shared, ...inheritedCheckpoint(cursor), startId: opts.startId, nested: true, packageExit: layers[layers.length - 1].pkg.packageExit })
    for (let i = layers.length - 1; i >= 0; i--) {
      if (ex.shouldStop()) throw new StoppedError()
      const { parent, pkg } = layers[i]
      summary = await runGraph(parent, ex, { ...shared, ...inheritedCheckpoint(parent), nested: !!opts.nested || i > 0, afterNodeId: pkg.id,
        afterNodePort: pkg.packageExit && !summary.packageExitReached ? 'blocked' : 'next',
        packageExit: i > 0 ? layers[i - 1].pkg.packageExit : opts.packageExit })
    }
    // The final summary belongs to the outer canvas. A package-local End is not
    // enough to start the next canvas, and legacy runs retain their result shape.
    return summary
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const entry = opts.afterNodeId ? undefined : findEntry(graph, opts.startId)
  if (!opts.afterNodeId && !entry) throw new Error('Başlangıç node’u bulunamadı.')
  let packageExitReached = false
  let incomplete = false
  const observeExit = (node: AgentNode, port: string, _scope: AgentNode | null) => {
    // The recorded package exit is the node and port, including when that node sits inside a
    // Her Öğe İçin box. Scope still stops an ordinary edge from leaving the loop; it must not
    // drop the exit the package was saved with.
    if (opts.packageExit?.from === node.id) packageExitReached = opts.packageExit.fromPort === port
  }
  const exitEvidence = () => opts.packageExit ? { packageExitReached } : {}
  const root = opts.root ?? graph

  // A run that starts inside a package, or climbs back out through one, has no caller handing it variables.
  // Take them from the loop outside that package: its ticked row, or the lap the run was on.
  const host = !opts.vars && graph !== root ? packageHost(root, graph) : undefined
  const scopePath = checkpointGraphPath(root, graph)
  const savedScope = opts.checkpointResume?.scopes.find(s => JSON.stringify(s.path) === JSON.stringify(scopePath))
  let vars: Record<string, string> = opts.vars ?? savedScope?.vars ?? (host ? outsideVars(root, host.id) : null) ?? { sira: '1' }
  const checkpointScopes = [...(opts.checkpointScopes ?? []), { path: scopePath, vars: { ...vars } }]
  const checkpointFrames: CheckpointLoop[] = []
  // Gözlemlenebilirlik yazımı otomasyonu durdurmaz (CLAUDE.md §19): checkpoint diske yazılamazsa
  // (EPERM/EBUSY/ENOSPC) koşu checkpoint'siz sürer. İlk hatada bir kez uyarılır; sonra her öğede
  // aynı hatayı yinelemek günlüğü doldurmaktan başka işe yaramaz.
  let checkpointBroken = false
  const captureCheckpoint = async (label: string, cursor: CheckpointCursor) => {
    if (!ex.checkpoint || checkpointBroken) return
    try { await ex.checkpoint(label, cursor) }
    catch (e) {
      checkpointBroken = true
      ex.log('warn', `Checkpoint yazılamadı; koşu checkpoint olmadan sürüyor (bu koşuda hatadan devam kullanılamaz): ${(e as Error).message}`)
    }
  }
  const inheritedLoops = opts.loopProgress ?? []
  const liveLoops: LoopProgress[] = []
  const publishLoops = () => ex.setLoopProgress?.([...inheritedLoops, ...liveLoops].map(loop => ({ ...loop })))
  publishLoops()
  const loopNotes: string[] = []
  const tally: Tally = opts.tally ?? newTally()
  const warnedLeave = new Set<string>()

  /** The closing line of a run: green only if no loop item ended on an error. */
  const closing = (text: string): [LogLevel, string] =>
    tally.failed > 0 ? ['warn', `${text} ${tally.failed} öğe/tur hatayla bitti; hataları yukarıdaki kayıtlarda bul.`] : ['success', text]

  const patch = (id: string, p: Partial<AgentNode>) => {
    const n = byId.get(id)
    if (n) Object.assign(n, p)
    ex.patchNode?.(id, p)
  }

  /** The node to run when an edge points at `id` from inside `scope`: itself, the box in scope that holds it, or null if it lies outside. */
  const enterable = (id: string, scope: AgentNode | null): AgentNode | null => {
    let cur = byId.get(id)
    const seen = new Set<string>()
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      const owner = ownerOf(graph, cur.id)
      if ((owner?.id ?? null) === (scope?.id ?? null)) return cur
      if (!owner) return null
      cur = owner
    }
    return null
  }

  const lapStart = (loop: AgentNode) => firstMember(graph, loop)

  const primaryPort = (n: AgentNode) =>
    n.kind === 'waitFile' ? 'found' : n.kind === 'condition' ? 'true' : n.kind === 'loop' ? 'done' : 'next'

  /** Where the flow goes after `node` if all goes well, as the executor should expect it. */
  const nextAfter = (node: AgentNode, scope: AgentNode | null): AgentNode | undefined => {
    const edge = graph.edges.find((e) => e.from === node.id && e.fromPort === primaryPort(node))
    let n = edge ? enterable(edge.to, scope) ?? undefined : undefined
    if (!n && scope) n = lapStart(scope)
    let guard = 0
    while (n?.kind === 'loop' && guard++ < 6) n = lapStart(n) ?? n
    return n
  }

  const peekAhead = (node: AgentNode, scope: AgentNode | null): StepAhead => {
    const next = nextAfter(node, scope)
    if (!next) return {}
    const nextScope = ownerOf(graph, next.id) ?? null
    const then = nextAfter(next, nextScope)
    return { next: renderNode(next, vars), then: then ? renderNode(then, vars) : undefined }
  }

  const settle = () => interruptibleSleep(opts.stepDelayMs, ex.shouldStop)

  /** Last condition answer that was "no" or undecided; runChain decides its route. */
  let pendingCondition: { nodeId: string; title: string; text: string; live: AgentNode; ahead: StepAhead; stepNo: number; undecided: boolean; error?: Error } | undefined
  const execStep = async (node: AgentNode, live: AgentNode, stepNo: number, ahead: StepAhead): Promise<string> => {
    switch (node.kind) {
      case 'start':
        ex.log('info', 'Akış başladı.')
        return 'next'
      case 'click':
        ex.log('info', `[${stepNo}] Tıkla: ${live.prompt || live.locator?.name || live.title}`)
        await ex.click(live, stepNo, ahead)
        await settle()
        return 'next'
      case 'type':
        ex.log('info', `[${stepNo}] Yaz: “${live.text ?? ''}”`)
        await ex.type(live, stepNo, ahead)
        await settle()
        return 'next'
      case 'key':
        ex.log('info', `[${stepNo}] Tuş: ${live.keys}`)
        await ex.key(live, ahead)
        await settle()
        return 'next'
      case 'wait': {
        const ms = Math.max(0, live.ms ?? 0)
        ex.log('info', `[${stepNo}] Zamanlayıcı: ${(ms / 1000).toLocaleString('tr-TR')} sn`)
        await interruptibleSleep(ms, ex.shouldStop)
        return 'next'
      }
      case 'condition': {
        const compatibility = conditionCompatibilityError(live)
        if (compatibility) throw new PermanentStepError(compatibility)
        const text = (live.text ?? '').trim()
        if (!text) throw new PermanentStepError(`“${live.title}”: koşul için ne aradığını yaz.`)
        ex.log('info', `[${stepNo}] Koşul “${text}” yöntemlerle değerlendiriliyor…`)
        let answer: boolean | undefined
        let observationError: Error | undefined
        try { answer = await ex.exists(text, live) }
        catch (error) {
          if (isFatal(error) || error instanceof PermanentStepError) throw error
          observationError = error instanceof Error ? error : new Error(String(error))
          ex.log('warn', `Koşul gözlemi tamamlanamadı; aynı koşul ve öğe kurtarmaya devrediliyor: ${observationError.message}`)
        }
        if (ex.shouldStop()) throw new StoppedError()
        if (answer === true) { ex.log('info', `[${stepNo}] Koşul “${text}”: var`); return 'true' }
        ex.log('info', `[${stepNo}] Koşul “${text}”: ${answer === false ? 'yok' : 'karar verilemedi'}`)
        // "No" or undecided: the route is chosen in runChain, where this scope's edges are known.
        pendingCondition = { nodeId: node.id, title: node.title, text, live, ahead, stepNo, undecided: answer === undefined, error: observationError }
        return 'false'
      }
      case 'ai': {
        if (!live.prompt?.trim()) throw new PermanentStepError(`“${live.title}”: Yap için hedefi yaz.`)
        if (!ex.initiative) throw new PermanentStepError('Yap bu ortamda çalışmıyor.')
        ex.log('info', `[${stepNo}] Yap: ${live.prompt.trim()}`)
        const ok = await ex.initiative(live, stepNo, ahead, vars)
        await settle()
        return ok ? 'next' : 'fail'
      }
      case 'browser':
      case 'waitFile':
      case 'moveFile':
        // Skipping would let the next step run as if this one had happened (a file that never arrived).
        throw new PermanentStepError(`“${node.title}”: Bu node türü artık desteklenmiyor, akışı güncelleyin.`)
      case 'end':
        return 'end'
      case 'loop':
        return 'done'
      case 'package': {
        const inner = node.inner
        if (!inner?.nodes.length) {
          ex.log('warn', `“${node.title}” boş.`)
          return node.packageExit ? 'blocked' : 'next'
        }
        ex.log('info', `“${node.title}” paketi çalışıyor.`)
        // The package sees the variables of the lap it runs in; a loop inside it still lets its own item win.
        let result: Awaited<ReturnType<typeof runGraph>>
        try {
          result = await runGraph(inner, ex, { checkpointResume: opts.checkpointResume, checkpointUsed, checkpointLoops: [...(opts.checkpointLoops ?? []), ...checkpointFrames], checkpointScopes, packageExit: node.packageExit, debug: opts.debug, resumeState, maxSteps: opts.maxSteps, stepDelayMs: opts.stepDelayMs, nested: true, root, resume: opts.resume, resumeLoopId: opts.resumeLoopId, resumeItem: opts.resumeItem, tally, vars, loopProgress: [...inheritedLoops, ...liveLoops] })
        } catch (error) {
          if (isFatal(error)) throw error
          // Paket içinde kalan bir hata paketi BAŞTAN oynatmayı hak etmez: içerideki tıklama/yazma
          // ikinci kez gönderilirdi. Kalıcı hata olarak yukarı verilir; öğe hatası olarak raporlanır.
          const wrapped = new PermanentStepError(`“${node.title}” paketi hata verdi: ${(error as Error).message}`)
          // İşaretleri koru: aksi hâlde aynı hata her paket katmanında yeniden sayılıyor (failed=2).
          if (error && typeof error === 'object') Object.assign(wrapped, {
            runnerSaydi: (error as { runnerSaydi?: boolean }).runnerSaydi,
            haltLoop: (error as { haltLoop?: boolean }).haltLoop,
            serviceFailure: (error as { serviceFailure?: boolean }).serviceFailure,
          })
          throw wrapped
        }
        if (result.incomplete) incomplete = true
        if (node.packageExit && !result.packageExitReached) {
          incomplete = true
          ex.log('info', `“${node.title}” kayıtlı çıkışına ulaşmadı; dışarıdaki sonraki adım çalıştırılmıyor.`)
          return 'blocked'
        }
        ex.log('success', `“${node.title}” bitti, sıradaki node’a geçiliyor.`)
        await settle()
        return 'next'
      }
    }
  }

  // A technical failure belongs to the SAME node and loop item. Never replay a
  // possibly dispatched action just because the surrounding method failed.
  const persistentStep = async (node: AgentNode, live: AgentNode, stepNo: number, ahead: StepAhead): Promise<string> => {
    let blocked: unknown
    // Set when recovery asked for a retry; the report is then closed by the final outcome of this step.
    let retriedAfterRecovery = false
    // Kalıcı yapılandırma/graf hataları paketi baştan oynatmaz. Koşul gözlem hataları
    // execStep/runChain içinde aynı node ve öğe korunarak salt-okunur kurtarmaya gider.
    const outcome = repeatMethodCycle(async () => {
      let error: unknown
      if (blocked !== undefined) error = blocked
      else {
        try { return await execStep(node, live, stepNo, ahead) }
        catch (caught) { if (isFatal(caught)) throw caught; error = caught }
      }
      const marked = (error && typeof error === 'object' ? error : {}) as {
        inputAlreadySent?: boolean; inputMayHaveBeenSent?: boolean; inputDelivery?: DeliveryState; typeProgress?: TypeProgress
      }
      const progress = marked.typeProgress
      const resumableType = node.kind === 'type' && !!progress && progress.focus === 'sent' &&
        progress.text !== 'uncertain' && progress.enter === 'not_sent' &&
        (progress.text === 'not_sent' || !!live.pressEnter)
      if (resumableType) live.resumeTypeProgress = { ...progress! }
      const unsafeReplay = !resumableType && (marked.inputAlreadySent === true || marked.inputMayHaveBeenSent === true || marked.inputDelivery === 'uncertain' || marked.inputDelivery === 'sent')
      if (unsafeReplay) blocked = error
      if (ex.recover && ['click', 'type', 'key', 'wait', 'ai'].includes(node.kind)) {
        ex.log('warn', `“${node.title}”: normal yöntemler sonuç vermedi; aynı adım ve öğe korunarak kurtarma aşamasına geçiliyor.`)
        try {
          const decision = await ex.recover({ graph: root, node, live, error: error instanceof Error ? error : new Error(String(error)), stepNo, ahead, vars: { ...vars },
            inputAlreadySent: marked.inputAlreadySent === true, inputMayHaveBeenSent: marked.inputMayHaveBeenSent === true,
            typeProgress: progress, inputDelivery: marked.inputDelivery })
          if (ex.shouldStop()) throw new StoppedError()
          if (decision === 'completed') { ex.recoveryFinished?.(node.id, true); await settle(); return 'next' }
          if (decision === 'stop') throw new DeliberateStopError(`Kurtarma ajanı bilinçli olarak vazgeçti: “${node.title}”. ${methodErrorText(error)}`)
          if (decision !== 'retry') throw new RecoveryFailedError(decision === 'failed'
            ? `Kurtarma başarısız oldu; “${node.title}” adımında koşu durduruldu. ${methodErrorText(error)}`
            : `Kurtarma aşamasına ulaşıldı ancak kurtarma ajanı kapalı veya kullanılamıyor; “${node.title}” adımında koşu durduruldu. ${methodErrorText(error)}`)
          // A retry is allowed only when it cannot duplicate a dispatched action.
          if (decision === 'retry') retriedAfterRecovery = true
          if (decision === 'retry' && !unsafeReplay) blocked = undefined
        } catch (recoveryError) {
          if (ex.shouldStop()) throw new StoppedError()
          if (recoveryError instanceof DeliberateStopError || recoveryError instanceof RecoveryFailedError) throw recoveryError
          throw new RecoveryFailedError(`Kurtarma çağrısı başarısız; “${node.title}” adımında koşu durduruldu: ${methodErrorText(recoveryError)}`)
        }
      }
      else if (['click', 'type', 'key', 'wait', 'ai'].includes(node.kind)) {
        throw new RecoveryFailedError(`Kurtarma aşamasına ulaşıldı ancak kurtarma ajanı bağlı değil; “${node.title}” adımında koşu durduruldu. ${methodErrorText(error)}`)
      }
      if (unsafeReplay) ex.log('warn', 'Girdi gönderilmiş olabilir; aynı komut yeniden gönderilmeden güncel durumun toparlanması bekleniyor.')
      throw error
    }, {
      check: () => { if (ex.shouldStop()) throw new StoppedError() },
      wait: () => interruptibleSleep(3000, ex.shouldStop),
      terminal: (error) => isFatal(error) || error instanceof PermanentStepError,
      retry: (error, round) => { ex.log('warn', `DUGUM-TEKRAR “${node.title}” tur=${round}: ${methodErrorText(error)}; aynı düğüm ve öğe korunuyor.`) },
    })
    try {
      const port = await outcome
      if (retriedAfterRecovery) ex.recoveryFinished?.(node.id, true)
      return port
    } catch (error) {
      if (retriedAfterRecovery) ex.recoveryFinished?.(node.id, false, methodErrorText(error))
      throw error
    }
  }

  /** Runs from `start` until the flow leaves `scope` (or ends). `stopAt` ends the chain before entering those nodes. */
  const topBudget: Budget = { used: 0 }

  /**
   * Runs from `start` until the flow leaves `scope` (or ends). `stopAt` ends the chain before entering those nodes.
   * Steps count against `budget`: the whole top level, or one lap of a box.
   */
  const runChain = async (start: AgentNode, scope: AgentNode | null, stopAt?: Set<string>, budget: Budget = topBudget, firstLapPath?: AgentNode[]): Promise<void> => {
    let resumeRoute = firstLapPath
    let cur: AgentNode | null = start
    while (cur) {
      const node: AgentNode = cur
      if (stopAt?.has(node.id)) return
      if (ex.shouldStop()) throw new StoppedError()

      if (budget.used >= opts.maxSteps) {
        if (budget === topBudget) throw new StepLimitError(`Kutuların dışında ${opts.maxSteps} adım/kutu çağrısı çalıştırıldı ve durduruldu. Sonsuz döngü olabilir.`)
        throw new LapLimitError(`Bu tur ${opts.maxSteps} adımı geçti (sonsuz döngü olabilir).`)
      }
      budget.used++
      let port: string
      if (node.kind === 'loop') {
        const route = resumeRoute?.[0]?.id === node.id ? resumeRoute : undefined
        // Consume before invoking: a self/back edge must not replay the chosen entry.
        if (route) resumeRoute = undefined
        port = await runLoop(node, scope, route?.[1], false, undefined, route?.slice(1))
      } else {
        tally.n++
        ex.step(node.id, 'running')
        let recovering = false
        try {
          const live = renderNode(node, vars)
          const ahead = peekAhead(node, scope)
          if (!opts.debug) port = await persistentStep(node, live, tally.n, ahead)
          else try {
            port = await execStep(node, live, tally.n, ahead)
          } catch (error) {
            if (isFatal(error) || !ex.recover || !['click', 'type', 'key', 'wait'].includes(node.kind)) throw error
            const marked = error as { inputAlreadySent?: boolean; inputMayHaveBeenSent?: boolean; typeProgress?: TypeProgress; inputDelivery?: DeliveryState }
            const decision = await ex.recover({ graph: root, node, live, error: error instanceof Error ? error : new Error(String(error)), stepNo: tally.n, ahead, vars: { ...vars }, inputAlreadySent: marked.inputAlreadySent === true, inputMayHaveBeenSent: marked.inputMayHaveBeenSent === true, typeProgress: marked.typeProgress, inputDelivery: marked.inputDelivery })
            recovering = decision === 'retry' || decision === 'completed'
            if (ex.shouldStop()) throw new StoppedError()
            if (decision === 'completed') port = 'next'
            else if (decision === 'retry') {
              ex.log('info', `Kurtarma sonrası “${node.title}” aynı öğede yeniden deneniyor.`)
              if (marked.typeProgress) live.resumeTypeProgress = marked.typeProgress
              try { port = await execStep(node, live, tally.n, ahead) }
              catch (again) {
                if (isFatal(again)) throw again
                throw new LoopHalted(`Kurtarma sonrası “${node.title}” yine hata verdi: ${(again as Error).message}`)
              }
            } else if (decision === 'stop') throw new LoopHalted(`Kurtarma ajanı “${node.title}” adımını toparlayamadı: ${(error as Error).message}`)
            else throw error
          }
        } catch (e) {
          if (recovering) ex.recoveryFinished?.(node.id, false, (e as Error).message)
          ex.step(node.id, 'error')
          throw e
        }
        if (recovering) ex.recoveryFinished?.(node.id, true)
        ex.step(node.id, 'done')
        if (port === 'end') {
          if (opts.nested) ex.log('success', `Bitiş node’una ulaşıldı: “${node.title}”. Bu başlık, önceki adımların doğrulanmış sonucu değildir.`)
          else ex.log(...closing(`“${node.title}” ile akış bitti (${tally.n} adım).`))
          throw new EndFlow()
        }
      }

      if (NODE_SPECS[node.kind].outputs.length === 0) return
      // KOŞUL YÖNLENDİRMESİ (tek kural, her kapsamda):
      //  • kesin "yok" + "yok" çıkışı bağlı → o kol çalışır;
      //  • kesin "yok" + çıkış bağlı değil → kökte salt-okunur kurtarma sorulur, kutu/pakette tur hatası;
      //  • BELİRSİZ ("karar verilemedi") → ASLA "yok" sayılmaz; her kapsamda kurtarma karar verir.
      const packageExitNo = opts.packageExit?.from === node.id && opts.packageExit.fromPort === 'false'
      const hasFalse = graph.edges.some((e) => e.from === node.id && e.fromPort === 'false')
      if (node.kind === 'condition' && port === 'false' && pendingCondition?.nodeId === node.id) {
        const pending = pendingCondition
        pendingCondition = undefined
        const askRecovery = async (why: string): Promise<boolean> => {
          if (!ex.recover) throw new ConditionHaltError(`“${node.title}”: ${why}; kurtarma ajanı kapalı. Akış durduruldu.${pending.error ? ` Gözlem hatası: ${pending.error.message}` : ''}`)
          const decision = await ex.recover({ graph: root, node, live: pending.live, error: pending.error ?? new ConditionUndecidedError(`Koşul “${pending.text}” ekranda cevaplanamadı.`), stepNo: pending.stepNo, ahead: pending.ahead, vars: { ...vars } })
          if (ex.shouldStop()) throw new StoppedError()
          if (decision === 'var') {
            ex.log('success', `[${pending.stepNo}] Kurtarma ajanı koşulu doğruladı: “${pending.text}”: var`)
            ex.recoveryFinished?.(node.id, true)
            port = 'true'
            return true
          }
          if (decision === 'yok' && hasFalse) {
            ex.log('warn', `[${pending.stepNo}] Kurtarma ajanı koşulu “yok” olarak doğruladı.`)
            ex.recoveryFinished?.(node.id, false, 'Kurtarma ajanı koşulu “yok” olarak bildirdi.')
            port = 'false'
            return true
          }
          ex.recoveryFinished?.(node.id, false, 'Kurtarma ajanı koşulu güvenle karara bağlayamadı.')
          throw new ConditionHaltError(`“${node.title}”: koşul “${pending.text}” ${why}; kurtarma ajanı da güvenle karara bağlayamadı. Akış durduruldu.`)
        }
        if (pending.undecided) {
          await askRecovery('karar veremedi')
        } else if (!hasFalse) {
          // Kapsam içinde kesin "yok" + bağlı çıkış yok: tur/paket burada biter (mevcut anlam).
          // Yalnız KÖK seviyede, "yok" çıkışı bağlı değilken kurtarma sorulur; belirsizlik ise
          // her kapsamda yukarıdaki kurtarma yolundan geçer.
          if (!packageExitNo && !scope && !opts.nested && !stopAt) {
            await askRecovery('yok dedi ve “yok” çıkışı bağlı değil')
          }
        }
      }
      observeExit(node, port, scope)
      const edge = graph.edges.find((e) => e.from === node.id && e.fromPort === port)
      if (!edge) {
        // Packaging removed this external edge. A chosen failure/timeout exit is
        // connected at the caller and must not become an unconnected-step error.
        if (!scope && opts.packageExit?.from === node.id && opts.packageExit.fromPort === port) return
        // Bağlanmamış başarısızlık çıkışı da bir node hatasıdır: araç katmanı hatayı yalnız bu olayla
        // öğrenir. Yoksa node "done" görünür, debug koşusu durmaz ve donmuş kayıt oluşmaz (ölçüldü:
        // node iki turda da "done" bildirildi, hiç "error" gönderilmedi).
        if (FAIL_PORTS.has(port)) ex.step(node.id, 'error')
        if (FAIL_PORTS.has(port)) {
          throw new StepFailedError(`“${node.title}”: ${portLabel(node.kind, port)}. Bu çıkış bir yere bağlı değil.`)
        }
        if (!scope && !stopAt && node.kind === 'condition' && port === 'false') { incomplete = true; ex.log('warn', `“${node.title}”: koşul sağlanmadı, “yok” çıkışı bağlı değil; akış tamamlanmadan sonlandı.`) }
        if (!scope && !stopAt) ex.log('info', `“${node.title}” node’unun “${portLabel(node.kind, port)}” çıkışı bağlı değil, akış burada bitti.`)
        return
      }
      const nxt = enterable(edge.to, scope)
      if (!nxt) {
        if (scope && !warnedLeave.has(edge.id)) {
          warnedLeave.add(edge.id)
          ex.log('info', `“${node.title}” kutunun dışına bağlı. Tur burada biter; kutudan çıkış “bitti” noktasındadır.`)
        }
        return
      }
      if (!stopAt?.has(nxt.id)) ex.edge?.(edge.id, edge.from, nxt.id)
      cur = nxt
    }
  }

  /**
   * Runs the box. A full run walks every item from the first.
   * A run that starts inside the box (`startAt`) continues from the ticked item through the end.
   */
  // YALNIZ debug koşusunda: mevcut kullanıcı akışlarının davranışı korunur (CLAUDE.md öncelik 2).
  // Ölçüldü: 197 saniyede 114 geçiş, 115 aynı hata — ve araç katmanı "0 hata" görüyordu.
  const turImzalari = new Map<string, string>()

  const runLoop = async (loop: AgentNode, scope: AgentNode | null, startAt?: AgentNode, skipItem = false, incomingEdge?: { id: string; from: string }, firstLapPath?: AgentNode[]): Promise<string> => {
    ex.step(loop.id, 'running')
    if (startAt && incomingEdge) ex.edge?.(incomingEdge.id, incomingEdge.from, startAt.id)
    const first = lapStart(loop)
    if (!first) {
      ex.log('warn', `“${loop.title}” kutusu boş. İçine node sürükle.`)
      ex.step(loop.id, 'done')
      return 'done'
    }
    if (!warnedLeave.has(`orphans:${loop.id}`)) {
      warnedLeave.add(`orphans:${loop.id}`)
      const ids = new Set(loop.members ?? [])
      const reached = new Set<string>([first.id])
      const q = [first.id]
      while (q.length) {
        const id = q.shift()!
        for (const e of graph.edges) if (e.from === id && ids.has(e.to) && !reached.has(e.to)) reached.add(e.to) && q.push(e.to)
      }
      const orphans = [...ids].filter((id) => !reached.has(id)).map((id) => byId.get(id)?.title ?? id)
      if (orphans.length) {
        ex.log('warn', `“${loop.title}” içinde bağlı olmayan node var: ${orphans.join(', ')}. Tur “${first.title}”dan başlar, oklarla gidilmeyen node’lar çalışmaz.`)
      }
    }
    const savedLoop = !checkpointUsed.has(loop.id) ? opts.checkpointResume?.loops.find(f => f.id === loop.id) : undefined
    if (savedLoop) checkpointUsed.add(loop.id)
    const folderRaw = loop.folder?.trim() ?? ''
    let fromFolder: string[] | null = null
    if (!savedLoop && hasTemplate(folderRaw)) {
      const readFolder = async () => {
        const resolved = outsideFolder(root, loop)
        if (!resolved) {
          if (opts.debug) ex.step(loop.id, 'error')
          throw new Error(`“${loop.title}”: dışarıdaki Her Öğe İçin’den klasör okunamadı (${folderRaw}).`)
        }
        const found = listDirEntries(resolved)
        if (!found) {
          if (opts.debug) ex.step(loop.id, 'error')
          throw new Error(`“${loop.title}”: klasör yok: ${resolved}`)
        }
        fromFolder = found
        ex.log('info', `“${loop.title}”: ${resolved} içinde ${found.length} öğe.`)
        patch(loop.id, { items: found })
      }
      if (opts.debug) await readFolder()
      else await repeatMethodCycle(readFolder, {
        check: () => { if (ex.shouldStop()) throw new StoppedError() },
        wait: () => interruptibleSleep(3000, ex.shouldStop),
        retry: (error, round) => ex.log('warn', `DUGUM-TEKRAR “${loop.title}” tur=${round}: ${methodErrorText(error)}`),
        // Eksik klasör KALICI bir hatadır: sınırlı denemeden sonra hata yukarı verilir; kutu
        // sonsuza kadar aynı yerde beklemez (öğe hatası olarak sayılır, sıradaki öğeye geçilir).
        maxRounds: 3,
      })
    }
    const keys = savedLoop?.keys ?? fromFolder ?? loopKeys(loop)
    const isList = savedLoop?.isList ?? (fromFolder != null || listItems(loop).length > 0)
    const fromBase = savedLoop?.index ?? loopStartIndex(loop, keys.length, !!opts.resume)
    let from = skipItem ? Math.min(keys.length, fromBase + 1) : fromBase
    // Devam KİMLİKLE yapılır: klasör/liste yeniden okununca indeks başka dosyayı gösterir.
    // Ölçüldü: kayıtlı öğe "b.glb" iken liste başına "a.glb" eklenince koşu a.glb ile başlıyordu.
    if (opts.resume && !resumeState.identityUsed && opts.resumeItem && opts.resumeLoopId === loop.id) {
      const kimlik = keys.indexOf(opts.resumeItem)
      if (kimlik < 0) {
        throw new Error(`“${loop.title}”: kayıtlı öğe (“${opts.resumeItem}”) yeni listede yok; aynı dosyadan devam edilemez.`)
      }
      from = skipItem ? Math.min(keys.length, kimlik + 1) : kimlik
      resumeState.identityUsed = true
    }
    const noun = isList ? 'öğe' : 'tur'
    const fromWord = isList ? 'öğeden' : 'turdan'
    if (!keys.length) {
      ex.log('warn', `“${loop.title}”: liste boş; bu kutu hiç çalışmayacak.`)
    } else if (from >= keys.length) {
      ex.log('info', `“${loop.title}”: işaret son öğede; kalan ${noun} yok.`)
    } else if (from > 0) {
      const name = isList ? baseName(keys[from]) : `${from + 1}. tur`
      ex.log('info', `“${loop.title}”: ${from + 1}. ${fromWord} devam (${name}). ${keys.length - from} ${noun} kaldı.`)
    } else {
      ex.log('info', `“${loop.title}”: ${keys.length} ${noun} çalışacak.`)
    }

    const outer = savedLoop?.outerVars ?? vars
    let entry: AgentNode | undefined = startAt
    let lastFail = ''
    let succeeded = 0
    const failedItems: string[] = []
    loopNotes.push('')
    liveLoops.push({ id: loop.id, title: loop.title, index: 0, total: keys.length, item: '' })
    // Bir tur açıkken adım hataları ÖĞE hatası olarak sayılır (aşağıdaki catch): aynı hata
    // runGraph'un çıkışında bir kez daha "adım hatası" diye sayılmasın.
    tally.loopDepth++
    checkpointFrames.push({ id: loop.id, keys, index: from, isList, outerVars: { ...outer } })
    try {
      for (let idx = from; idx < keys.length; idx++) {
        checkpointFrames[checkpointFrames.length - 1].index = idx
        const key = keys[idx]
        const label = isList ? baseName(key) : `${idx + 1}. tur`
        vars = { ...outer, ...itemVars(isList ? key : String(idx + 1), idx, keys.length) }
        liveLoops[liveLoops.length - 1] = { id: loop.id, title: loop.title, index: idx + 1, total: keys.length, item: label }
        publishLoops()
        patch(loop.id, { loopIndex: idx, startIndex: idx })
        loopNotes[loopNotes.length - 1] = isList ? `${loop.title} ${idx + 1}/${keys.length} · ${label}` : `${loop.title} ${idx + 1}/${keys.length}. tur`
        // Kart: iç/dış döngü konumu tek satırda ve OKUNUR (1.9.120). Uzun " · " ayırıcısı kartta taşıyordu;
        // " › " iç içe geçişi gösterir: "Grup 3/12 · Image Folder › Öğe 7/20 · kedi.png".
        ex.setLoop?.(loopNotes.join(' › '))
        ex.log('info', `— “${loop.title}” ${idx + 1}/${keys.length}: ${label}`)
        if (ex.shouldStop()) throw new StoppedError()
        await captureCheckpoint(`${loop.title} · ${idx + 1}/${keys.length} · ${label}`, {
          startId: entry && firstLapPath?.length ? firstLapPath[firstLapPath.length - 1].id : (entry ?? first).id,
          packagePath: scopePath,
          loops: structuredClone([
            ...(opts.checkpointLoops ?? []), ...checkpointFrames,
            // Starting from a nested selected node opens outer boxes first. Keep the
            // still-pending inner frozen lists in checkpoints captured on that descent.
            ...(opts.checkpointResume?.loops.filter(f => !checkpointUsed.has(f.id) &&
              ![...(opts.checkpointLoops ?? []), ...checkpointFrames].some(live => live.id === f.id)) ?? []),
          ]),
          scopes: structuredClone(checkpointScopes),
        })
        if (ex.shouldStop()) throw new StoppedError()
        try {
          await runChain(entry ?? first, loop, undefined, { used: 0 }, entry ? firstLapPath : undefined)
          succeeded++
          // A lap that finished cleanly breaks the chain: only two failures in a row
          // mean the loop should stand still, not two failures far apart.
          lastFail = ''
        } catch (e) {
          if (isFatal(e)) throw e
          const msg = (e as Error).message || String(e)
          failedItems.push(label)
          // Tur içi hata: araç katmanının görmesi için adım olayı (sayaç + debug durması).
          ex.step(loop.id, 'error')
          tally.failed++
          ex.log('error', `${label}: ${msg}`)
          await ex.captureFailure?.(label).catch(error => ex.log('warn', `Hata ekran görüntüsü kaydedilemedi: ${(error as Error).message}`))
          if ((e as { haltLoop?: boolean }).haltLoop === true) {
            ex.log('error', 'Hedefleme tamamlanamadı; döngü bu öğede durdu. Sonraki öğeye geçilmedi.')
            throw new LoopHalted(msg)
          }
          const serviceFailure = (e as { serviceFailure?: boolean }).serviceFailure === true || isApiDown(msg)
          // Only infrastructure failures may be normalized across item-specific text.
          const signature = serviceFailure ? msg.replace(/[“"'][^“"']*[”"']/g, '<öğe>').replace(/\b\d+\b/g, '#') : msg
          const again = signature === lastFail
          lastFail = signature
          if (serviceFailure || again) {
            ex.log('error', isApiDown(msg) ? 'API cevap vermiyor. Döngü durdu, işaret bu öğede kaldı.' : 'Aynı hata üst üste geldi. Döngü durdu, işaret bu öğede kaldı.')
            throw new LoopHalted(msg)
          }
          ex.log('info', `${label} bu turda yarım kaldı. Sıradaki öğeye geçiliyor.`)
        }
        entry = undefined
      }
    } finally {
      checkpointFrames.pop()
      liveLoops.pop()
      publishLoops()
      loopNotes.pop()
      ex.setLoop?.(loopNotes.join('   ·   '))
      vars = outer
      tally.loopDepth--
    }

    // Aynı hata kümesi ikinci kez görülürse dur: yüzlerce öğeyi boşa geçirmenin önü kesilir.
    const imza = failedItems.join('|')
    // Yalnız ÜST DÜZEY kutu: iç kutu, dış öğe başına meşru olarak yeniden çağrılır ve aynı
    // imzayı üretir (mevcut test bunu doğruluyor). Sonsuz tekrar üst düzey kutuda oluyordu.
    const ustKutu = (ownerOf(graph, loop.id) as AgentNode | null)?.kind === 'loop'
    if (imza && !ustKutu && opts.debug === true) {
      const onceki = turImzalari.get(loop.id)
      turImzalari.set(loop.id, imza)
      if (onceki === imza) {
        ex.log('error', `“${loop.title}”: aynı hata kümesi tekrar etti (${failedItems.length} öğe: ${failedItems.slice(0, 3).join(', ')}). Döngü durdu.`)
        throw new LoopHalted(`“${loop.title}”: aynı hata kümesi tekrar etti.`)
      }
    }

    const ran = keys.length - from
    if (from < keys.length) {
      if (failedItems.length) {
        const shown = failedItems.slice(0, FAILED_NAMES_SHOWN).join(', ')
        const more = failedItems.length > FAILED_NAMES_SHOWN ? ` ve ${failedItems.length - FAILED_NAMES_SHOWN} tane daha` : ''
        ex.log('warn', `“${loop.title}” bitti: ${ran} ${noun} içinde ${succeeded} tamam, ${failedItems.length} hatalı (${shown}${more}).`)
      } else {
        ex.log(
          'success',
          from > 0
            ? `“${loop.title}” bitti: ${from + 1}. ${fromWord} itibaren ${ran} ${noun} çalıştı.`
            : `“${loop.title}” bitti: ${keys.length} ${noun} çalıştı.`
        )
      }
    }
    const held = loop.startIndex
    patch(loop.id, { loopIndex: undefined, startIndex: 0 })
    if (typeof held === 'number' && held > 0) ex.log('info', `“${loop.title}”: işaret 1. öğeye döndü.`)
    ex.step(loop.id, 'done')
    return 'done'
  }

  /** After a box started from inside, continue by its “bitti” exit on the level above. */
  const continueAfter = async (loop: AgentNode) => {
    const scope = ownerOf(graph, loop.id) ?? null
    observeExit(loop, 'done', scope)
    const edge = graph.edges.find((e) => e.from === loop.id && e.fromPort === 'done')
    const nxt = edge ? enterable(edge.to, scope) : null
    if (scope) {
      // Manual package entry bypassed the caller's loop stack. Finish this
      // outer lap from the actual continuation, then run its remaining items.
      await runLoop(scope, ownerOf(graph, scope.id) ?? null, nxt ?? undefined, !nxt, edge)
      await continueAfter(scope)
    } else if (nxt && edge) {
      ex.edge?.(edge.id, edge.from, nxt.id)
      await runChain(nxt, null)
    }
  }

  try {
    const done = opts.afterNodeId ? byId.get(opts.afterNodeId) : undefined
    if (opts.afterNodeId && !done) throw new Error('Paketin devamı bu akışta yok.')
    if (done) {
      const owner = ownerOf(graph, done.id) ?? null
      const port = opts.afterNodePort ?? 'next'
      observeExit(done, port, owner)
      const edge = graph.edges.find((e) => e.from === done.id && e.fromPort === port)
      const nxt = edge ? enterable(edge.to, owner) : null
      if (owner && nxt) {
        ex.log('info', `“${done.title}” bitti. “${owner.title}” “${nxt.title}” ile sürüyor.`)
        await runLoop(owner, ownerOf(graph, owner.id) ?? null, nxt, false, edge)
        await continueAfter(owner)
      } else if (owner) {
        ex.log('info', `“${done.title}” bitti. “${owner.title}” kalan öğelerden sürüyor.`)
        await runLoop(owner, ownerOf(graph, owner.id) ?? null, undefined, true)
        await continueAfter(owner)
      } else if (nxt) {
        if (edge) ex.edge?.(edge.id, edge.from, nxt.id)
        ex.log('info', `“${done.title}” bitti, “${nxt.title}” ile devam ediliyor.`)
        await runChain(nxt, null)
      } else {
        ex.log('info', `“${done.title}” sonrası bağlı bir adım yok.`)
      }
    } else if (entry) {
      // Kutular DIŞTAN İÇE açılır. Ölçülen kusur: koşu bir node'dan başlarken yalnız en içteki
      // kutuya giriliyordu; dış kutunun değişkenleri ({{öğe}}) hiç kurulmuyor, iç kutunun sayısal
      // öğesi metne yazılıyor ve dış kutunun kalan öğeleri (ikinci dosya) hiç çalışmıyordu.
      const zincir: AgentNode[] = []
      let sahip = ownerOf(graph, entry.id)
      while (sahip) {
        zincir.unshift(sahip)
        sahip = ownerOf(graph, sahip.id)
      }
      const owner = zincir[zincir.length - 1]
      if (zincir.length > 0) {
        const disKutu = zincir[0]
        const baslangic = zincir.length > 1 ? zincir[1] : entry
        ex.log(
          'info',
          zincir.length > 1
            ? `“${entry.title}” ${zincir.length} kutu içinde. Kutular dıştan içe açılıyor: “${disKutu.title}” → “${zincir[1].title}”.`
            : `“${entry.title}”, “${owner?.title}” kutusunun içinde. Kutu bu node'dan başlıyor.`
        )
        await runLoop(disKutu, ownerOf(graph, disKutu.id) ?? null, baslangic, false, undefined, [...zincir.slice(1), entry])
        await continueAfter(disKutu)
      } else {
        await runChain(entry, null)
      }
    }
  } catch (e) {
    if (e instanceof EndFlow) return { steps: tally.n, failed: tally.failed + tally.stepFailures, ...(incomplete ? { incomplete: true } : {}), ...(opts.packageExit ? { packageExitReached: false } : {}), ...(opts.reportEnd ? { reachedEnd: true } : {}) }
    // Döngü DIŞINDA kalan bir adım hatası: hata yine yukarı çıkar (davranış aynı), ama sayaç
    // doğruyu söyler. Ölçülen kusur: sayaç yalnız öğe hatasında artıyordu, bu yüzden koşu
    // "hata: …" ile biterken "hatalı öğe yok" yazıyordu.
    if (!isFatal(e)) {
      const sayilan = (typeof e === 'object' && e !== null ? e : {}) as { runnerSaydi?: boolean }
      // Paket katmanlarından yukarı çıkarken aynı hata yeniden sayılmaz; tur içindeyse öğe
      // sayacı zaten sayar (yukarıdaki catch).
      if (!sayilan.runnerSaydi) {
        sayilan.runnerSaydi = true
        if (tally.loopDepth === 0) tally.stepFailures++
      }
    }
    throw e
  }
  if (!opts.nested) {
    if (incomplete) ex.log('warn', `Akış tamamlanmadan sonlandı (${tally.n} adım): koşul sağlanmadı.`)
    else ex.log(...closing(`Akış tamamlandı (${tally.n} adım).`))
  }
  return { steps: tally.n, failed: tally.failed + tally.stepFailures, ...(incomplete ? { incomplete: true } : {}), ...exitEvidence(), ...(opts.reportEnd ? { reachedEnd: false } : {}) }
}
