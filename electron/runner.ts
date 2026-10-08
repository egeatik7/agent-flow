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
import { outsideFolder, outsideVars, packageHost } from './enclosing'

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
  /** The loop item the current node is inside. Empty when the node is not in a loop. */
  setLoop?: (text: string) => void
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
/** A single lap went over the step budget. Keep this item; do not start the next job. */
class LapLimitError extends Error {}

type Budget = { used: number }

/** Counts shared by a whole run, including the packages it climbs out of. `failed` is loop items or laps that ended on an error. */
type Tally = { n: number; failed: number }

/** What a run reports when it ends without being stopped: steps taken, and loop items or laps that ended on an error. */
export type RunSummary = { steps: number; failed: number }

/** At most this many item names are listed in the end-of-loop summary. */
const FAILED_NAMES_SHOWN = 5

/**
 * The error text says the model service is down or refusing, so the rest of the list would fail the same way.
 * A bare 401, 402 or 429 does not count: it can be part of a file name or a coordinate. A code in parentheses counts
 * only when an API word sits right before it, because these messages carry user text too: "(401)" on its own matches
 * a file name like "video(429).glb" and would stop the whole list.
 */
export function isApiDown(message: string): boolean {
  return /(?:api|openrouter|anahtar|bakiye|kota|model|sunucu)[^()]{0,24}\((?:401|402|429)\)|resourceexhausted|rate limit|too many requests|quota|bakiye|upstream error|openrouter \d{3}/i.test(message)
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
  return e instanceof StoppedError || e instanceof EndFlow || e instanceof StepLimitError || e instanceof LapLimitError || e instanceof LoopHalted
}

export async function runGraph(
  graph: AgentGraph,
  ex: Executor,
  opts: {
    maxSteps: number
    stepDelayMs: number
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
    /** Shared step and failure count when a run climbs out of packages. */
    tally?: Tally
    /** Variables the run starts with. A package gets those of the loop lap it runs in. */
    vars?: Record<string, string>
  }
): Promise<RunSummary> {
  if (opts.packagePath?.length) {
    const layers: { parent: AgentGraph; pkg: AgentNode }[] = []
    let cursor = graph
    for (const id of opts.packagePath) {
      const pkg = cursor.nodes.find((n) => n.id === id && n.kind === 'package')
      if (!pkg?.inner) throw new Error('Açık paket bu akışta yok.')
      layers.push({ parent: cursor, pkg })
      cursor = pkg.inner
    }
    const shared = {
      maxSteps: opts.maxSteps,
      stepDelayMs: opts.stepDelayMs,
      root: opts.root ?? graph,
      resume: opts.resume,
      tally: opts.tally ?? { n: 0, failed: 0 },
    }
    await runGraph(cursor, ex, { ...shared, startId: opts.startId, nested: true })
    for (let i = layers.length - 1; i >= 0; i--) {
      const { parent, pkg } = layers[i]
      await runGraph(parent, ex, { ...shared, nested: !!opts.nested || i > 0, afterNodeId: pkg.id })
    }
    return { steps: shared.tally.n, failed: shared.tally.failed }
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const entry = opts.afterNodeId ? undefined : findEntry(graph, opts.startId)
  if (!opts.afterNodeId && !entry) throw new Error('Başlangıç node’u bulunamadı.')
  const root = opts.root ?? graph

  // A run that starts inside a package, or climbs back out through one, has no caller handing it variables.
  // Take them from the loop outside that package: its ticked row, or the lap the run was on.
  const host = !opts.vars && graph !== root ? packageHost(root, graph) : undefined
  let vars: Record<string, string> = opts.vars ?? (host ? outsideVars(root, host.id) : null) ?? { sira: '1' }
  const loopNotes: string[] = []
  const tally: Tally = opts.tally ?? { n: 0, failed: 0 }
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
        // Skipping would let the next step run as if this one had happened (a file that never arrived).
        throw new Error(`“${node.title}”: Bu node türü artık desteklenmiyor, akışı güncelleyin.`)
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
        // The package sees the variables of the lap it runs in; a loop inside it still lets its own item win.
        await runGraph(inner, ex, { maxSteps: opts.maxSteps, stepDelayMs: opts.stepDelayMs, nested: true, root, resume: opts.resume, tally, vars })
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
        tally.n++
        ex.step(node.id, 'running')
        try {
          const live = renderNode(node, vars)
          port = await execStep(node, live, tally.n, peekAhead(node, scope))
        } catch (e) {
          ex.step(node.id, 'error')
          throw e
        }
        ex.step(node.id, 'done')
        if (port === 'end') {
          if (opts.nested) ex.log('success', `Bitiş node’una ulaşıldı: “${node.title}”. Bu başlık, önceki adımların doğrulanmış sonucu değildir.`)
          else ex.log(...closing(`“${node.title}” ile akış bitti (${tally.n} adım).`))
          throw new EndFlow()
        }
      }

      if (NODE_SPECS[node.kind].outputs.length === 0) return
      const waitedOut = node.kind === 'condition' && port === 'timeout'
      if (waitedOut) port = 'false'
      const edge = graph.edges.find((e) => e.from === node.id && e.fromPort === port)
      if (!edge) {
        // Bağlanmamış başarısızlık çıkışı da bir node hatasıdır: araç katmanı hatayı yalnız bu olayla
        // öğrenir. Yoksa node "done" görünür, debug koşusu durmaz ve donmuş kayıt oluşmaz (ölçüldü:
        // node iki turda da "done" bildirildi, hiç "error" gönderilmedi).
        if (FAIL_PORTS.has(port) || waitedOut) ex.step(node.id, 'error')
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
  // YALNIZ debug koşusunda: mevcut kullanıcı akışlarının davranışı korunur (CLAUDE.md öncelik 2).
  // Ölçüldü: 197 saniyede 114 geçiş, 115 aynı hata — ve araç katmanı "0 hata" görüyordu.
  const turImzalari = new Map<string, string>()

  const runLoop = async (loop: AgentNode, scope: AgentNode | null, startAt?: AgentNode, skipItem = false): Promise<string> => {
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
        // Kutu kurulumundaki hata da bir adım hatasıdır: araç katmanı sayacı ve debug
        // durması yalnız bu olayla çalışır (canlıda 115 hata "0 hata" görünüyordu).
        ex.step(loop.id, 'error')
        throw new Error(`“${loop.title}”: dışarıdaki Her Öğe İçin’den klasör okunamadı (${folderRaw}).`)
      } else {
        const found = listDirEntries(resolved)
        if (!found) {
          // Kutu kurulumundaki hata da bir adım hatasıdır: araç katmanı sayacı ve debug
          // durması yalnız bu olayla çalışır (canlıda 115 hata "0 hata" görünüyordu).
          ex.step(loop.id, 'error')
          throw new Error(`“${loop.title}”: klasör yok: ${resolved}`)
        } else {
          fromFolder = found
          ex.log('info', `“${loop.title}”: ${resolved} içinde ${found.length} öğe.`)
          patch(loop.id, { items: found })
        }
      }
    }
    const keys = fromFolder ?? loopKeys(loop)
    const isList = fromFolder != null || listItems(loop).length > 0
    const fromBase = loopStartIndex(loop, keys.length, !!opts.resume)
    let from = skipItem ? Math.min(keys.length, fromBase + 1) : fromBase
    // Devam KİMLİKLE yapılır: klasör/liste yeniden okununca indeks başka dosyayı gösterir.
    // Ölçüldü: kayıtlı öğe "b.glb" iken liste başına "a.glb" eklenince koşu a.glb ile başlıyordu.
    if (opts.resume && opts.resumeItem && opts.resumeLoopId === loop.id) {
      const kimlik = keys.indexOf(opts.resumeItem)
      if (kimlik < 0) {
        throw new Error(`“${loop.title}”: kayıtlı öğe (“${opts.resumeItem}”) yeni listede yok; aynı dosyadan devam edilemez.`)
      }
      from = skipItem ? Math.min(keys.length, kimlik + 1) : kimlik
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

    const outer = vars
    let entry: AgentNode | undefined = startAt
    let lastFail = ''
    let succeeded = 0
    const failedItems: string[] = []
    loopNotes.push('')
    try {
      for (let idx = from; idx < keys.length; idx++) {
        const key = keys[idx]
        const label = isList ? baseName(key) : `${idx + 1}. tur`
        vars = { ...outer, ...itemVars(isList ? key : String(idx + 1), idx, keys.length) }
        patch(loop.id, { loopIndex: idx, startIndex: idx })
        loopNotes[loopNotes.length - 1] = isList ? `${loop.title} · ${idx + 1}/${keys.length} · ${label}` : `${loop.title} · ${idx + 1}/${keys.length}. tur`
        ex.setLoop?.(loopNotes.join('   ·   '))
        ex.log('info', `— “${loop.title}” ${idx + 1}/${keys.length}: ${label}`)
        try {
          await runChain(entry ?? first, loop, undefined, { used: 0 })
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
      loopNotes.pop()
      ex.setLoop?.(loopNotes.join('   ·   '))
      vars = outer
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
    const edge = graph.edges.find((e) => e.from === loop.id && e.fromPort === 'done')
    const nxt = edge ? enterable(edge.to, scope) : null
    if (nxt) await runChain(nxt, scope)
    if (scope) await continueAfter(scope)
  }

  try {
    const done = opts.afterNodeId ? byId.get(opts.afterNodeId) : undefined
    if (opts.afterNodeId && !done) throw new Error('Paketin devamı bu akışta yok.')
    if (done) {
      const owner = ownerOf(graph, done.id) ?? null
      const edge = graph.edges.find((e) => e.from === done.id && e.fromPort === 'next')
      const nxt = edge ? enterable(edge.to, owner) : null
      if (owner && nxt) {
        ex.log('info', `“${done.title}” bitti. “${owner.title}” “${nxt.title}” ile sürüyor.`)
        await runLoop(owner, ownerOf(graph, owner.id) ?? null, nxt)
        await continueAfter(owner)
      } else if (owner) {
        ex.log('info', `“${done.title}” bitti. “${owner.title}” kalan öğelerden sürüyor.`)
        await runLoop(owner, ownerOf(graph, owner.id) ?? null, undefined, true)
        await continueAfter(owner)
      } else if (nxt) {
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
        await runLoop(disKutu, ownerOf(graph, disKutu.id) ?? null, baslangic)
        await continueAfter(disKutu)
      } else {
        await runChain(entry, null)
      }
    }
  } catch (e) {
    if (e instanceof EndFlow) return { steps: tally.n, failed: tally.failed }
    throw e
  }
  if (!opts.nested) ex.log(...closing(`Akış tamamlandı (${tally.n} adım).`))
  return { steps: tally.n, failed: tally.failed }
}
