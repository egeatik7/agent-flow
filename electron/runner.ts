import {
  NODE_SPECS,
  baseName,
  itemVars,
  hasTemplate,
  listItems,
  loopKeys,
  TEMPLATE_VARS,
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
import { outsideFolder } from './enclosing'

/** The next one or two nodes, already filled with the current loop variables. */
export type StepAhead = { next?: AgentNode; then?: AgentNode }

export type Executor = {
  log: (level: LogLevel, message: string) => void
  step: (id: string, status: StepStatus) => void
  shouldStop: () => boolean
  click: (node: AgentNode, stepNo: number, ahead?: StepAhead) => Promise<void>
  type: (node: AgentNode, stepNo: number, ahead?: StepAhead) => Promise<void>
  key: (node: AgentNode, ahead?: StepAhead) => Promise<void>
  exists: (text: string, node: AgentNode) => Promise<boolean>
  /** İnisiyatif: reach the goal in a few actions. */
  initiative?: (node: AgentNode, stepNo: number, ahead?: StepAhead, vars?: Record<string, string>) => Promise<boolean>
  /** Persist a change to a node (which item is on screen, memory) in the editor. */
  patchNode?: (id: string, patch: Partial<AgentNode>) => void
  /** A lap hit an error: keep a picture of the screen for later. */
  captureFailure?: (label: string) => Promise<void>
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

class EndFlow extends Error {}
class StepLimitError extends Error {}
/** A single lap went over the step budget. The lap stops; the next item still runs. */
class LapLimitError extends Error {}

type Budget = { used: number }

function isApiDown(message: string): boolean {
  return /resourceexhausted|rate limit|quota|too many requests|429|402|401|bakiye|upstream error|openrouter \d{3}/i.test(message)
}

export async function interruptibleSleep(ms: number, shouldStop: () => boolean) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (shouldStop()) throw new StoppedError()
    await new Promise((r) => setTimeout(r, Math.min(100, end - Date.now())))
  }
}

export function findEntry(graph: AgentGraph, startId?: string): AgentNode | undefined {
  if (startId) return graph.nodes.find((n) => n.id === startId)
  return graph.nodes.find((n) => n.kind === 'start') ?? graph.nodes.find((n) => !graph.edges.some((e) => e.to === n.id))
}

function renderNode(node: AgentNode, vars: Record<string, string>): AgentNode {
  const templated = [node.prompt, node.text, node.keys, node.url, node.pattern, node.source].some((f) => !!f && /\{\{[^{}]+\}\}/.test(f))
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
  return e instanceof StoppedError || e instanceof EndFlow || e instanceof StepLimitError || e instanceof LoopHalted
}

export async function runGraph(
  graph: AgentGraph,
  ex: Executor,
  opts: { maxSteps: number; stepDelayMs: number; startId?: string; nested?: boolean; root?: AgentGraph; resume?: boolean; packagePath?: string[] }
): Promise<void> {
  if (opts.packagePath?.length) {
    let inner = graph
    for (const id of opts.packagePath) {
      const pkg = inner.nodes.find((n) => n.id === id && n.kind === 'package')
      if (!pkg?.inner) throw new Error('Açık paket bu akışta yok.')
      inner = pkg.inner
    }
    await runGraph(inner, ex, {
      maxSteps: opts.maxSteps,
      stepDelayMs: opts.stepDelayMs,
      startId: opts.startId,
      nested: opts.nested,
      root: opts.root ?? graph,
      resume: opts.resume,
    })
    return
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const entry = findEntry(graph, opts.startId)
  if (!entry) throw new Error('Başlangıç node’u bulunamadı.')
  const root = opts.root ?? graph

  let vars: Record<string, string> = { sira: '1' }
  let steps = 0
  const warnedLeave = new Set<string>()

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
        const text = (live.text ?? '').trim()
        if (!text && !live.locator) throw new Error(`“${live.title}”: koşul için yazı gir ya da Ekrandan Seç ile bir öğe seç.`)
        const label = text ? `“${text}”` : 'seçilen öğe'
        const wait = Math.max(0, live.timeoutMs ?? 0)
        const until = Date.now() + wait
        if (wait > 0) ex.log('info', `[${stepNo}] ${label} bekleniyor (en çok ${Math.round(wait / 1000)} sn)…`)
        for (;;) {
          if (await ex.exists(text, live)) {
            ex.log('info', `[${stepNo}] Koşul ${label}: var`)
            return 'true'
          }
          if (Date.now() >= until) break
          await interruptibleSleep(700, ex.shouldStop)
        }
        ex.log('info', `[${stepNo}] Koşul ${label}: yok${wait > 0 ? ` (${Math.round(wait / 1000)} sn beklendi)` : ''}`)
        return wait > 0 ? 'timeout' : 'false'
      }
      case 'ai': {
        if (!live.prompt?.trim()) throw new Error(`“${live.title}”: İnisiyatif için hedefi yaz.`)
        if (!ex.initiative) throw new Error('İnisiyatif bu ortamda çalışmıyor.')
        ex.log('info', `[${stepNo}] İnisiyatif: ${live.prompt.trim()}`)
        const ok = await ex.initiative(live, stepNo, ahead, vars)
        await settle()
        return ok ? 'next' : 'fail'
      }
      case 'browser':
      case 'waitFile':
      case 'moveFile':
        ex.log('info', `“${node.title}” kaldırıldı, geçiliyor.`)
        return node.kind === 'waitFile' ? 'found' : 'next'
      case 'probe': {
        const picked = (node.text ?? '').trim()
        const names = picked ? [picked] : TEMPLATE_VARS
        const lines = names.map((v) => {
          const token = v.includes('{{') ? v : `{{${v}}}`
          const shown = renderTemplate(token, vars) ?? token
          return `${token} = ${shown === token ? 'boş' : shown}`
        })
        ex.log('info', `[${stepNo}] Kontrol: ${lines.join(' · ')}`)
        return 'next'
      }
      case 'end':
        return 'end'
      case 'loop':
        return 'done'
      case 'package': {
        const inner = node.inner
        if (!inner?.nodes.length) {
          ex.log('warn', `“${node.title}” boş.`)
          return 'next'
        }
        ex.log('info', `“${node.title}” paketi çalışıyor.`)
        await runGraph(inner, ex, { maxSteps: opts.maxSteps, stepDelayMs: opts.stepDelayMs, nested: true, root, resume: opts.resume })
        ex.log('success', `“${node.title}” bitti, sıradaki node’a geçiliyor.`)
        await settle()
        return 'next'
      }
    }
  }

  /** Runs from `start` until the flow leaves `scope` (or ends). `stopAt` ends the chain before entering those nodes. */
  const topBudget: Budget = { used: 0 }

  /**
   * Runs from `start` until the flow leaves `scope` (or ends). `stopAt` ends the chain before entering those nodes.
   * Steps count against `budget`: the whole top level, or one lap of a box.
   */
  const runChain = async (start: AgentNode, scope: AgentNode | null, stopAt?: Set<string>, budget: Budget = topBudget): Promise<void> => {
    let cur: AgentNode | null = start
    while (cur) {
      const node: AgentNode = cur
      if (stopAt?.has(node.id)) return
      if (ex.shouldStop()) throw new StoppedError()

      let port: string
      if (node.kind === 'loop') {
        port = await runLoop(node, scope)
      } else {
        if (budget.used >= opts.maxSteps) {
          if (budget === topBudget) {
            throw new StepLimitError(
              `Kutuların dışında ${opts.maxSteps} adım çalıştırıldı ve durduruldu. Sonsuz döngü olabilir; Ayarlar’dan “Maks. adım” değerini artırabilirsin.`
            )
          }
          throw new LapLimitError(`Bu tur ${opts.maxSteps} adımı geçti (sonsuz döngü olabilir: örn. Koşul → Zamanlayıcı döngüsü hiç bitmedi).`)
        }
        budget.used++
        steps++
        ex.step(node.id, 'running')
        try {
          const live = renderNode(node, vars)
          port = await execStep(node, live, steps, peekAhead(node, scope))
        } catch (e) {
          ex.step(node.id, 'error')
          throw e
        }
        ex.step(node.id, 'done')
        if (port === 'end') {
          ex.log('success', `“${node.title}” ile akış bitti (${steps} adım).`)
          throw new EndFlow()
        }
      }

      if (NODE_SPECS[node.kind].outputs.length === 0) return
      const waitedOut = node.kind === 'condition' && port === 'timeout'
      if (waitedOut) port = 'false'
      const edge = graph.edges.find((e) => e.from === node.id && e.fromPort === port)
      if (!edge) {
        if (waitedOut) throw new StepFailedError(`“${node.title}”: beklenen öğe süresi içinde görünmedi ve “yok” çıkışı bağlı değil.`)
        if (FAIL_PORTS.has(port)) {
          throw new StepFailedError(`“${node.title}”: ${portLabel(node.kind, port)}. Bu çıkış bir yere bağlı değil.`)
        }
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
      cur = nxt
    }
  }

  /**
   * Runs the box. A full run walks every item from the first.
   * A run that starts inside the box (`startAt`) continues from the ticked item through the end.
   */
  const runLoop = async (loop: AgentNode, scope: AgentNode | null, startAt?: AgentNode): Promise<string> => {
    ex.step(loop.id, 'running')
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
    const folderRaw = loop.folder?.trim() ?? ''
    let fromFolder: string[] | null = null
    if (hasTemplate(folderRaw)) {
      const resolved = outsideFolder(root, loop)
      if (!resolved) {
        ex.log('warn', `“${loop.title}”: dışarıdaki Her Öğe İçin’den klasör okunamadı (${folderRaw}).`)
        fromFolder = []
      } else {
        const found = listDirEntries(resolved)
        if (!found) {
          ex.log('warn', `“${loop.title}”: klasör yok: ${resolved}`)
          fromFolder = []
        } else {
          fromFolder = found
          ex.log('info', `“${loop.title}”: ${resolved} içinde ${found.length} öğe.`)
          patch(loop.id, { items: found })
        }
      }
    }
    const keys = fromFolder ?? loopKeys(loop)
    const isList = fromFolder != null || listItems(loop).length > 0
    const from = loopStartIndex(loop, keys.length, !!opts.resume)
    const noun = isList ? 'öğe' : 'tur'
    const fromWord = isList ? 'öğeden' : 'turdan'
    if (from > 0) {
      const name = isList ? baseName(keys[from]) : `${from + 1}. tur`
      ex.log('info', `“${loop.title}”: ${from + 1}. ${fromWord} devam (${name}). ${keys.length - from} ${noun} kaldı.`)
    } else {
      ex.log('info', `“${loop.title}”: ${keys.length} ${noun} çalışacak.`)
    }

    const outer = vars
    let entry: AgentNode | undefined = startAt
    let lastFail = ''
    try {
      for (let idx = from; idx < keys.length; idx++) {
        const key = keys[idx]
        const label = isList ? baseName(key) : `${idx + 1}. tur`
        vars = { ...outer, ...itemVars(isList ? key : String(idx + 1), idx, keys.length) }
        patch(loop.id, { loopIndex: idx, startIndex: idx })
        ex.log('info', `— “${loop.title}” ${idx + 1}/${keys.length}: ${label}`)
        try {
          await runChain(entry ?? first, loop, undefined, { used: 0 })
        } catch (e) {
          if (isFatal(e)) throw e
          const msg = (e as Error).message || String(e)
          ex.log('error', `${label}: ${msg}`)
          await ex.captureFailure?.(label).catch(() => {})
          const again = msg === lastFail
          lastFail = msg
          if (isApiDown(msg) || again) {
            ex.log('error', isApiDown(msg) ? 'API cevap vermiyor. Döngü durdu, işaret bu öğede kaldı.' : 'Aynı hata üst üste geldi. Döngü durdu, işaret bu öğede kaldı.')
            throw new LoopHalted(msg)
          }
          ex.log('info', `${label} bu turda yarım kaldı. Sıradaki öğeye geçiliyor.`)
        }
        entry = undefined
      }
    } finally {
      vars = outer
    }

    const ran = keys.length - from
    ex.log(
      'success',
      from > 0
        ? `“${loop.title}” bitti: ${from + 1}. ${fromWord} itibaren ${ran} ${noun} çalıştı.`
        : `“${loop.title}” bitti: ${keys.length} ${noun} çalıştı.`
    )
    patch(loop.id, { loopIndex: undefined })
    ex.step(loop.id, 'done')
    return 'done'
  }

  /** After a box started from inside, continue by its “bitti” exit on the level above. */
  const continueAfter = async (loop: AgentNode) => {
    const scope = ownerOf(graph, loop.id) ?? null
    const edge = graph.edges.find((e) => e.from === loop.id && e.fromPort === 'done')
    const nxt = edge ? enterable(edge.to, scope) : null
    if (nxt) await runChain(nxt, scope)
    if (scope) await continueAfter(scope)
  }

  try {
    const owner = ownerOf(graph, entry.id)
    if (owner) {
      ex.log('info', `“${entry.title}”, “${owner.title}” kutusunun içinde. Kutu bu node’dan başlıyor.`)
      await runLoop(owner, ownerOf(graph, owner.id) ?? null, entry)
      await continueAfter(owner)
    } else {
      await runChain(entry, null)
    }
  } catch (e) {
    if (e instanceof EndFlow) return
    throw e
  }
  if (!opts.nested) ex.log('success', `Akış tamamlandı (${steps} adım).`)
}
