import {
  NODE_SPECS,
  baseName,
  fileVars,
  itemVars,
  listItems,
  loopKeys,
  portLabel,
  renderTemplate,
  type AgentGraph,
  type AgentNode,
  type ItemStatus,
  type LogLevel,
  type StepStatus,
} from './graph-types'
import { firstMember, ownerOf } from './groups'

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
  openBrowser?: (node: AgentNode) => Promise<void>
  /** Returns the finished file, or null on timeout. */
  waitFile?: (node: AgentNode, stepNo: number) => Promise<string | null>
  /** Returns the final path. */
  moveFile?: (from: string, to: string, node: AgentNode) => Promise<string>
  /** Persist a change to a node (loop progress, results, memory) in the editor. */
  patchNode?: (id: string, patch: Partial<AgentNode>) => void
  /** An item of a box failed: keep a picture of the screen for later. */
  captureFailure?: (label: string) => Promise<void>
}

export class StoppedError extends Error {
  constructor() {
    super('Kullanıcı tarafından durduruldu.')
  }
}

/** A step ended on a failure port that leads nowhere (zaman aşımı, olmadı). */
export class StepFailedError extends Error {}

class EndFlow extends Error {}
class StepLimitError extends Error {}
/** A single lap went over the step budget: that item fails, the run goes on. */
class LapLimitError extends Error {}
class RecoveryError extends Error {}

type Budget = { used: number }

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
  return {
    ...node,
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
  return e instanceof StoppedError || e instanceof EndFlow || e instanceof StepLimitError
}

export async function runGraph(
  graph: AgentGraph,
  ex: Executor,
  opts: { maxSteps: number; stepDelayMs: number; startId?: string }
): Promise<void> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const entry = findEntry(graph, opts.startId)
  if (!entry) throw new Error('Başlangıç node’u bulunamadı.')

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
        if (!ex.openBrowser) throw new Error('Tarayıcı modu bu ortamda çalışmıyor.')
        ex.log('info', `[${stepNo}] Tarayıcı: ${live.url || '(boş sayfa)'}`)
        await ex.openBrowser(live)
        await settle()
        return 'next'
      case 'waitFile': {
        if (!ex.waitFile) throw new Error('Dosyayı Bekle bu ortamda çalışmıyor.')
        const file = await ex.waitFile(live, stepNo)
        if (!file) return 'timeout'
        vars = { ...vars, ...fileVars(file) }
        return 'found'
      }
      case 'moveFile': {
        if (!ex.moveFile) throw new Error('Dosyayı Taşı bu ortamda çalışmıyor.')
        const from = (live.source?.trim() || renderTemplate('{{dosya}}', vars) || '').trim()
        const to = (live.text ?? '').trim()
        if (!from || from.includes('{{')) throw new Error(`“${live.title}”: taşınacak dosya yok. Önce Dosyayı Bekle çalışmalı.`)
        if (!to) throw new Error(`“${live.title}”: hedef yolu boş.`)
        const final = await ex.moveFile(from, to, live)
        vars = { ...vars, ...fileVars(final) }
        return 'next'
      }
      case 'end':
        return 'end'
      case 'loop':
        return 'done'
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

  const runRecovery = async (loop: AgentNode, scope: AgentNode | null) => {
    const edge = graph.edges.find((e) => e.from === loop.id && e.fromPort === 'error')
    if (!edge) return
    const start = enterable(edge.to, scope)
    if (!start || start.id === loop.id) return
    ex.log('info', `Kurtarma zinciri çalışıyor (“${loop.title}” → hata olursa).`)
    try {
      await runChain(start, scope, new Set([loop.id]), { used: 0 })
    } catch (e) {
      if (isFatal(e)) throw e
      throw new RecoveryError(`Kurtarma zinciri başarısız oldu: ${(e as Error).message}`)
    }
  }

  /** Runs every pending item of a box. Returns the port to leave by. */
  const runLoop = async (loop: AgentNode, scope: AgentNode | null, startAt?: AgentNode): Promise<string> => {
    ex.step(loop.id, 'running')
    const keys = loopKeys(loop)
    const isList = listItems(loop).length > 0
    let results: Record<string, ItemStatus> = { ...(loop.results ?? {}) }
    for (const k of Object.keys(results)) if (!keys.includes(k)) delete results[k]
    let pending = keys.map((_, i) => i).filter((i) => results[keys[i]] !== 'ok')
    if (!pending.length) {
      results = {}
      pending = keys.map((_, i) => i)
    }
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
    const failedBefore = keys.filter((k) => results[k] === 'fail').length
    if (pending.length < keys.length) {
      ex.log(
        'info',
        `“${loop.title}”: ${keys.length - pending.length} öğe önceki çalıştırmada tamamlanmış${
          failedBefore ? `, ${failedBefore} hatalı öğe tekrar denenecek` : ''
        }. Kalan ${pending.length} öğe çalışacak.`
      )
    } else {
      ex.log('info', `“${loop.title}”: ${keys.length} ${isList ? 'öğe' : 'tur'} çalışacak.`)
    }

    const outer = vars
    const attempts = Math.max(1, Math.floor(loop.attempts ?? 2))
    let entry: AgentNode | undefined = startAt
    let recoveryFails = 0
    let recoverFirst = false

    /** Runs the recovery chain; a failing chain marks the item and is retried before the next item, three in a row stop the run. */
    const recover = async (): Promise<boolean> => {
      try {
        await runRecovery(loop, scope)
        recoveryFails = 0
        recoverFirst = false
        return true
      } catch (e) {
        if (isFatal(e) || !(e instanceof RecoveryError)) throw e
        recoveryFails++
        ex.log('error', `${e.message} (${recoveryFails}/3)`)
        if (recoveryFails >= 3) throw new Error(`“${loop.title}”: kurtarma zinciri üst üste 3 kez başarısız oldu, akış durduruldu.`)
        recoverFirst = true
        return false
      }
    }

    try {
      for (const idx of pending) {
        const key = keys[idx]
        const label = isList ? baseName(key) : `${idx + 1}. tur`
        vars = { ...outer, ...itemVars(isList ? key : String(idx + 1), idx, keys.length) }
        patch(loop.id, { loopIndex: idx })
        ex.log('info', `— “${loop.title}” ${idx + 1}/${keys.length}: ${label}`)
        if (recoverFirst) {
          ex.log('info', 'Önceki kurtarma yarım kaldı; bu öğeden önce bir kez daha deneniyor.')
          await recover()
        }
        let ok = false
        for (let t = 1; t <= attempts && !ok; t++) {
          try {
            await runChain(entry ?? first, loop, undefined, { used: 0 })
            ok = true
          } catch (e) {
            if (isFatal(e)) throw e
            ex.log('error', `${label}: ${(e as Error).message}`)
            await ex.captureFailure?.(label).catch(() => {})
            if (loop.onError === 'stop') {
              results[key] = 'fail'
              patch(loop.id, { results: { ...results } })
              throw e
            }
            const recovered = await recover()
            if (!recovered) break
            if (t < attempts) ex.log('info', `${label} baştan bir kez daha denenecek (${t + 1}/${attempts}).`)
          }
          entry = undefined
        }
        results[key] = ok ? 'ok' : 'fail'
        patch(loop.id, { results: { ...results } })
        if (ok) ex.log('success', `✓ ${label} tamam (${idx + 1}/${keys.length}).`)
        else ex.log('warn', `✗ ${label} atlandı; sıradakine geçiliyor.`)
      }
    } finally {
      vars = outer
    }

    const failed = keys.filter((k) => results[k] === 'fail')
    const okCount = keys.filter((k) => results[k] === 'ok').length
    if (failed.length) {
      ex.log(
        'warn',
        `“${loop.title}” bitti: ${okCount} tamam, ${failed.length} hatalı (${failed.map((k) => (isList ? baseName(k) : k)).slice(0, 8).join(', ')}${
          failed.length > 8 ? '…' : ''
        }). Tekrar çalıştırınca yalnızca bunlar denenir.`
      )
      patch(loop.id, { results: { ...results }, loopIndex: 0 })
    } else {
      ex.log('success', `“${loop.title}” bitti: ${okCount} öğenin hepsi tamam.`)
      patch(loop.id, { results: undefined, loopIndex: 0 })
    }
    ex.step(loop.id, failed.length ? 'error' : 'done')
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
  ex.log('success', `Akış tamamlandı (${steps} adım).`)
}
