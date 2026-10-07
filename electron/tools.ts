/**
 * The tool layer: everything an outside agent is allowed to do, in one place.
 *
 * The Ajan panel, the local endpoint and (later) an MCP adapter all call these functions, so
 * limits, permissions and logging are enforced once instead of per transport. Tools drive the
 * engine that already exists; none of them re-implements target finding, focus or input.
 *
 * Every call answers with the same shape, so a caller can tell apart: was the target found,
 * was the action sent, what was observed, did it fail or was it stopped, and where the run is.
 * `ok` means "the tool answered". A missing target is an answer, not an error.
 */
import {
  NODE_SPECS,
  loopKeys,
  loopStartIndex,
  normalizeGraph,
  summarize,
  type AgentGraph,
  type AppSettings,
  type CanvasBook,
  type LogLevel,
} from './graph-types'
import type { TargetTrace } from './target-trace'
import { ADDABLE_KINDS, EDITABLE_FIELDS, applyPlan, describePlan, diffGraphs, planOps, type EditOp } from './tool-edit'
import {
  MAX_BRANCHES,
  MAX_GROUPS,
  addGroup,
  baseTabOf,
  branchOps,
  branchesOf,
  derivePath,
  findBranch,
  groupPrefix,
  materialize,
  newBranch,
  newGroupId,
  pruneBypassed,
  summaryOf,
  targetGraph,
  undoLast,
  viewBranch,
  type BranchRecord,
} from './tool-branch'
import { contextOf, countEdges, findPlace, walkGraph } from './tool-context'
import { actionGraph, runAction, type ActSpec } from './tool-act'
import { beginProbe, endProbe, frozenReport, isDebugRun, noteUserStop, probing, recentReports, recentSteps, reviewCount, lastReviewLine, setStopAt, snapshot, stopReason, actPointWithin, noteActPoint } from './tool-state'

export type ToolOutcome = 'tamam' | 'hedef-yok' | 'eylem-belirsiz' | 'hata' | 'durduruldu' | 'plan-gecersiz'

export type NodeRef = { id: string; kind: string; title: string; packagePath: string[] }

export type LoopRef = {
  id: string
  title: string
  item?: string
  index?: number
  total?: number
  vars?: Record<string, string>
  /** Where the items come from, so a caller never has to guess. */
  folder?: string
  count?: number
  templated?: boolean
  startIndex?: number
}

export type ToolResult = {
  ok: boolean
  tool: string
  outcome: ToolOutcome
  /** One plain sentence, built from what the engine reported, for the user and the agent. */
  message: string
  node?: NodeRef
  target?: {
    found: boolean
    stage?: string
    x?: number
    y?: number
    label?: string
    window?: string
    candidates?: number
    reason?: string
  }
  action?: { kind: string; sent: boolean }
  observed?: { note?: string }
  loop?: LoopRef
  /** Every box around the node, outermost first (run.state). */
  loopChain?: LoopRef[]
  suggestion?: string
  data?: Record<string, unknown>
}

/** What the panel needs to draw the catalogue, including tools that are not built yet. */
export type ToolSpec = { name: string; summary: string; sendsInput: boolean; ready: boolean }

export type ToolContext = {
  /** The saved flow. A caller may pass its live canvas as `args.graph` instead. */
  getGraph: () => AgentGraph
  getSettings: () => AppSettings
  log: (level: LogLevel, message: string) => void
  isRunning: () => boolean
  /** True while the user's own stop is in effect. */
  userStop: () => boolean
  /** Sends the transient canvas highlight. Nothing else may be written by a tool. */
  sendStep: (payload: unknown) => void
  /** What an outside caller may do without asking. The panel is never gated. */
  permission: () => 'off' | 'ask' | 'auto'
  /** Asks the person in front of the app. Resolves false when refused or not answered. */
  askApproval: (summary: string, note: string) => Promise<boolean>
  /** The user's own stop, for `run.stop`. */
  requestStop: () => void
  /**
   * Forgets a stop request that is still standing. A run clears it when it starts; a single step
   * has to do the same, or a stop left over from before would end the next step before it begins.
   */
  clearStop?: () => void
  /** Starts a real run on the engine. Returns when the run has finished. */
  startRun: (
    graph: AgentGraph,
    startId?: string,
    packagePath?: string[],
    opts?: { derived?: boolean; debug?: boolean; fast?: boolean }
  ) => Promise<{ ok: boolean; failed?: number; stopped?: boolean }>
  /** The canvas book: the flows of the app plus the agent branches that sit over them. */
  getCanvases: () => CanvasBook
  saveCanvases: (book: CanvasBook) => void
  /**
   * Applies a merged flow to a canvas. The window owns the canvas book — it saves it on every
   * change — so the merge is handed to it and this resolves with its answer instead of writing
   * the book from here, where a pending save from the window could undo it.
   */
  applyMerge: (
    payload: { tabId: string; graph: AgentGraph; branchId: string; branchName: string; reason?: 'merge' | 'undo' },
    opts?: { snapshot?: boolean }
  ) => Promise<{ ok: boolean; error?: string }>
  /**
   * Takes the flow as it was just before the last merge, and puts the branch recipe back. One
   * use only, and it lives in memory: after a restart there is nothing to go back to.
   */
  /** The last merge, without consuming it: the undo right is spent only on a confirmed restore. */
  peekMergeUndo?: () => { tabId: string; graph: AgentGraph } | null
  /** Asks the window to show a branch on the canvas, or to close the view. */
  showBranch?: (payload: { branchId: string; branchName: string }, opts?: { timeoutMs?: number }) => Promise<{ ok: boolean; error?: string }>
  /** One action at a time may step aside from the desktop: the window minimizes so the screen is usable. */
  hideApp?: () => Promise<boolean>
  /**
   * Brings the window back. `focus: false` restores it without taking the foreground, which is what
   * a sequence of actions needs: the dialog the next action types into must keep the focus.
   */
  showApp?: (opts?: { focus?: boolean }) => Promise<boolean>
  /** Spends the undo right: clears the snapshot and puts the recipe back. */
  commitMergeUndo?: () => boolean
}

/** `panel` is a person pressing a button in the app, which is its own approval. */
export type ToolSource = 'panel' | 'agent'

type Args = Record<string, unknown>

type ToolDef = {
  name: string
  summary: string
  /** True when the tool can send keyboard or mouse input to the desktop. */
  sendsInput: boolean
  ready: boolean
  /** What the approval dialog should say about this tool's effect on the flow. */
  approvalNote?: string
  run?: (args: Args, ctx: ToolContext, source: ToolSource) => Promise<ToolResult>
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/**
 * Was a branch asked for, and which one? An empty or unreadable `branchId` is an *error*, never
 * "no branch": reading it as absent once started the user's whole flow from the beginning.
 */
function branchArg(args: Args): { asked: boolean; id: string } {
  return { asked: args.branchId !== undefined && args.branchId !== null, id: text(args.branchId) }
}

const EMPTY_BRANCH =
  'branchId boş ya da yazı değil. Bir branch demek istiyorsan geçerli kimliğini ver; demek istemiyorsan alanı hiç gönderme. Boş kimlik, akışı baştan çalıştırmak anlamına gelmez.'

/** The stages that look at the screen itself: no model call, so a look stays fast. */
const FAST_STAGES = ['chrome', 'uia', 'icon', 'windows', 'onnx']

/**
 * Settings for a quick look: the model stages are dropped from the ladder. Called for
 * `fast: true`, so an agent can check where a step would aim without waiting for a model round
 * trip — and it follows the project rule that a certain, local job is not sent to a model.
 */
export function withFastFind(settings: AppSettings): AppSettings {
  const order = settings.findOrder.filter((stage) => FAST_STAGES.includes(stage))
  return { ...settings, findOrder: order.length ? order : ['uia'], findOff: [] }
}

/** The flow the caller means: its live canvas when it sent one, otherwise the saved flow. */
function graphOf(args: Args, ctx: ToolContext): AgentGraph {
  const raw = args.graph
  if (raw && typeof raw === 'object') {
    try {
      return normalizeGraph(raw)
    } catch {
      /* an unusable canvas falls back to the saved flow */
    }
  }
  return ctx.getGraph()
}

function nodeRef(place: { node: { id: string; kind: string; title: string }; packagePath: string[] }): NodeRef {
  return { id: place.node.id, kind: place.node.kind, title: place.node.title, packagePath: place.packagePath }
}

function loopOf(graph: AgentGraph, nodeId: string): LoopRef | undefined {
  const ctx = contextOf(graph, nodeId)
  if (!ctx?.loop) return undefined
  return ctx.loop
}

function failed(tool: string, message: string): ToolResult {
  return { ok: false, tool, outcome: 'hata', message }
}

type TraceSummary = {
  text: string
  stage?: string
  window?: string
  candidates?: number
  label?: string
  x?: number
  y?: number
  stages: { stage: string; candidates?: number }[]
}

/** Turns the resolution trace the engine already emits into a plain sentence. */
function describeTrace(traces: TargetTrace[]): TraceSummary {
  const stages: { stage: string; candidates?: number }[] = []
  const counts = new Map<string, number>()
  let stage: string | undefined
  let window = ''
  let label: string | undefined
  let x: number | undefined
  let y: number | undefined
  for (const t of traces) {
    if (t.kind === 'request') window = t.windowTitle || ''
    if (t.kind === 'observation') {
      const n = t.scan?.items?.length
      stages.push({ stage: t.source, candidates: n })
      if (typeof n === 'number') counts.set(t.source, n)
    }
    if (t.kind === 'resolved') {
      stage = t.source
      label = t.item?.text || t.target.label
      x = t.target.x
      y = t.target.y
    }
  }
  const seen = stages
    .filter((s) => s.candidates !== undefined)
    .map((s) => `${s.stage} ${s.candidates}`)
    .join(', ')
  const text = seen ? `Basamaklar: ${seen}.` : 'Hiçbir basamak aday listesi vermedi.'
  return { text, stage, window, candidates: stage ? counts.get(stage) : undefined, label, x, y, stages }
}

/**
 * Did this step actually send something to the desktop?
 *
 * A click leaves an input trace, which is the strongest signal. Keys and typing keep no such
 * trace, so for those a node that reported done is the evidence. A wait, a condition or a probe
 * sends no input, so it is never reported as one.
 */
export function actionSent(kind: string, nodeStatus: string, traces: TargetTrace[]): boolean {
  if (traces.some((e) => e.kind === 'input')) return true
  if (kind === 'key' || kind === 'type') return nodeStatus === 'done'
  return false
}

const flowSuggest: ToolDef = {
  name: 'flow.suggest',
  summary: 'Bir düzenleme planını denetler ve neyi değiştireceğini yazar. Hiçbir şey yazmaz.',
  sendsInput: false,
  ready: true,
  run: async (args, ctx) => {
    const graph = graphOf(args, ctx)
    // Without a plan this answers the other useful question: what may be touched here at all.
    if (args.ops === undefined) {
      const kinds = ADDABLE_KINDS.map((k) => `${k} (${NODE_SPECS[k].label})`).join(', ')
      const message = `Düzenleme yüzeyi — kök: ${graph.nodes.length} node · ${graph.edges.length} bağlantı (paketlerin içi hariç; flow.read hepsini sayar). Eklenebilen türler: ${kinds}. Değiştirilebilen alanlar: ${EDITABLE_FIELDS.join(', ')}. Hedef kanıtı (locator, simge, hafıza, çapa) ve koşu durumu değiştirilemez; paketlerin içi packagePath ile düzenlenebilir ve denetlenebilir.`
      ctx.log('info', `Ajan · öneri · ${message}`)
      return {
        ok: true,
        tool: flowSuggest.name,
        outcome: 'tamam',
        message,
        observed: { note: 'Yalnız bilgi verildi; akışa hiçbir şey yazılmadı.' },
        data: {
          valid: null,
          editableFields: [...EDITABLE_FIELDS],
          addableKinds: ADDABLE_KINDS,
          nodes: graph.nodes.length,
          edges: graph.edges.length,
        },
      }
    }

    const check = planOps(
      /* Paket içi planlar da denetlenir: flow.edit paketin içini düzenleyebiliyor, denetleyici de
         aynı yeri görmeli. Aksi hâlde var olan bir node için "bulunamadı" deniyordu. */
      (Array.isArray(args.packagePath) && args.packagePath.length
        ? ((targetGraph(graph, args.packagePath as string[])?.graph as AgentGraph) ?? graph)
        : graph),
      args.ops
    )
    const lines = describePlan(graph, check.plan)
    if (!check.ok) {
      const head = check.errors.slice(0, 3).join(' ')
      const rest = check.errors.length > 3 ? ` (+${check.errors.length - 3} hata daha)` : ''
      const message = `Plan geçersiz, hiçbir şey yazılmadı. ${head}${rest}`
      ctx.log('warn', `Ajan · öneri · ${message}`)
      return {
        ok: true,
        tool: flowSuggest.name,
        outcome: 'plan-gecersiz',
        message,
        observed: { note: 'Akışa hiçbir şey yazılmadı.' },
        data: { valid: false, errors: check.errors, warnings: check.warnings, lines },
      }
    }

    const diff = diffGraphs(
      (Array.isArray(args.packagePath) && args.packagePath.length
        ? ((targetGraph(graph, args.packagePath as string[])?.graph as AgentGraph) ?? graph)
        : graph),
      applyPlan(
        (Array.isArray(args.packagePath) && args.packagePath.length
          ? ((targetGraph(graph, args.packagePath as string[])?.graph as AgentGraph) ?? graph)
          : graph),
        check.plan
      )
    )
    const warn = check.warnings.length ? ` Uyarı: ${check.warnings.join(' ')}` : ''
    const message = `Plan geçerli: ${diff.summary}. Hiçbir şey yazılmadı; uygulamak için flow.edit kullan. Yeni node’ların gerçek id’lerini uygulamadan sonra flow.read ile al.${warn}`
    ctx.log('info', `Ajan · öneri · ${message}`)
    return {
      ok: true,
      tool: flowSuggest.name,
      outcome: 'tamam',
      message,
      observed: { note: 'Yalnız denetlendi; akışa hiçbir şey yazılmadı.' },
      data: { valid: true, errors: [], warnings: check.warnings, diff, lines },
    }
  },
}

/** A write by an outside caller needs the permission to be open; the panel is its own approval. */
function writeGate(ctx: ToolContext, source: ToolSource): string | null {
  if (source === 'panel') return null
  return ctx.permission() === 'off' ? 'Ajan izni kapalı; yazma yapılmaz (Ajan sekmesinden aç).' : null
}

/** A branch named by the caller, with its derived graph ready, or the reason it cannot be used. */
function pickBranch(
  args: Args,
  ctx: ToolContext
): { book: CanvasBook; branch: BranchRecord; view: ReturnType<typeof viewBranch> } | { error: string } {
  const id = text(args.branchId)
  if (!id) return { error: 'branchId gerekli; önce branch.create ile bir branch aç.' }
  const book = ctx.getCanvases()
  const branch = findBranch(book, id)
  if (!branch) return { error: `Branch bulunamadı: ${id}.` }
  const view = viewBranch(book, branch)
  if (!view.base || !view.derived) return { error: `“${branch.name}” branch’inin temel tuvali artık yok.` }
  return { book, branch, view }
}

const branchCreate: ToolDef = {
  name: 'branch.create',
  summary: 'Kendi branch’ini açar: seçili tuvali temel alan bir düzenleme tarifi. Akışın kopyası değil.',
  sendsInput: false,
  ready: true,
  run: async (args, ctx, source) => {
    const denied = writeGate(ctx, source)
    if (denied) return failed(branchCreate.name, denied)
    const book = ctx.getCanvases()
    const open = branchesOf(book)
    if (open.length >= MAX_BRANCHES) {
      return failed(
        branchCreate.name,
        `Aynı anda en fazla ${MAX_BRANCHES} branch açık olabilir (şu an ${open.length}). Önce birini kapat: ${open.map((b) => `${b.id} (“${b.name}”)`).join(', ')}.`
      )
    }
    const wanted = text(args.canvasId)
    const base = wanted ? book.tabs.find((t) => t.id === wanted) ?? null : book.tabs.find((t) => t.id === book.activeId) ?? book.tabs[0] ?? null
    if (!base) return failed(branchCreate.name, wanted ? `Tuval bulunamadı: ${wanted}.` : 'Temel alınacak tuval yok.')
    const branch = newBranch(base, args.name)
    book.branches = [...open, branch]
    ctx.saveCanvases(book)
    // A new branch starts from the canvas, not from another branch's recipe, so any edits already
    // made elsewhere are not in it. Saying so is what stops a second repair from quietly undoing
    // the first one: the earlier fix lives in its own branch, and continuing there keeps it.
    const holding = open.filter((b) => b.groups.length > 0 && b.baseTabId === base.id)
    const carry =
      holding.length && args.allowCarry !== true
        ? ` UYARI: “${holding.map((b) => b.name).join('”, “')}” branch’inde ${holding.reduce((n, b) => n + b.groups.length, 0)} düzenleme var ve bu yeni branch onları İÇERMEZ (temel tuvalden başlar). Önceki düzeltmeyi kaybetmemek için aynı branch’te devam et (flow.edit) ya da bilerek yeni bir yol istiyorsan allowCarry: true gönder.`
        : ''
    const message = `Branch açıldı: “${branch.name}” (${branch.id}) · temel: “${base.name}”. Akışın kopyası değil, düzenleme tarifi; akışa hiçbir şey yazılmadı. Düzenlemek için flow.edit, görmek için branch.diff.${carry}`
    ctx.log(holding.length ? 'warn' : 'info', `Ajan · branch · ${message}`)
    return {
      ok: true,
      tool: branchCreate.name,
      outcome: 'tamam',
      message,
      observed: { note: 'Branch kaydı açıldı; koşan akışa ve tuvale dokunulmadı.' },
      data: { branchId: branch.id, name: branch.name, baseTabId: base.id, baseName: base.name, baseStamp: branch.baseStamp, open: open.length + 1, carriesEarlier: holding.map((b) => ({ branchId: b.id, name: b.name, groups: b.groups.length })) },
    }
  },
}

const branchList: ToolDef = {
  name: 'branch.list',
  summary: 'Açık branch’leri, kaç düzenleme tuttuklarını ve neyi değiştirdiklerini listeler.',
  sendsInput: false,
  ready: true,
  run: async (_args, ctx) => {
    const book = ctx.getCanvases()
    const views = branchesOf(book).map((b) => viewBranch(book, b))
    const message = views.length
      ? `Açık branch’ler (${views.length}/${MAX_BRANCHES}): ${views.map((v) => `“${v.branch.name}” (${v.branch.id}) — ${summaryOf(v)}`).join(' | ')}`
      : 'Açık branch yok.'
    return {
      ok: true,
      tool: branchList.name,
      outcome: 'tamam',
      message,
      observed: { note: 'Yalnız okundu.' },
      data: {
        open: views.length,
        max: MAX_BRANCHES,
        branches: views.map((v) => ({
          branchId: v.branch.id,
          name: v.branch.name,
          baseTabId: v.branch.baseTabId,
          baseName: v.base?.name ?? null,
          groups: v.branch.groups.length,
          ops: branchOps(v.branch).length,
          baseChanged: v.baseChanged,
          failed: v.failed,
          diff: v.diff,
          /** The whole record, to show that a branch is a recipe and not a copy of the flow. */
          size: JSON.stringify(v.branch).length,
        })),
      },
    }
  },
}

const branchDiff: ToolDef = {
  name: 'branch.diff',
  summary: 'Bir branch’in temel tuvaline göre neyi değiştirdiğini gösterir. Yazmaz.',
  sendsInput: false,
  ready: true,
  run: async (args, ctx) => {
    const picked = pickBranch(args, ctx)
    if ('error' in picked) return failed(branchDiff.name, picked.error)
    const { branch, view } = picked
    const notes: string[] = []
    if (view.baseChanged) notes.push('temel tuval değişmiş; tarif güncel hâle uygulanıyor.')
    if (view.failed.length) notes.push(`${view.failed.length} grup artık uymuyor: ${view.failed[0]}`)
    const message = `“${branch.name}”: ${view.diff?.summary ?? '—'} (${branch.groups.length} düzenleme · ${branchOps(branch).length} işlem)${notes.length ? ` · ${notes.join(' ')}` : ''}`
    ctx.log('info', `Ajan · branch · ${message}`)
    return {
      ok: true,
      tool: branchDiff.name,
      outcome: 'tamam',
      message,
      observed: { note: 'Yalnız hesaplandı; akışa ve tuvale yazılmadı.' },
      data: {
        diff: view.diff,
        lines: view.lines,
        applied: view.applied,
        failed: view.failed,
        baseChanged: view.baseChanged,
        baseName: view.base?.name ?? null,
        /** The derived flow itself, so the window can show the branch on the canvas. */
        graph: view.derived,
        baseGraph: view.base?.graph ?? null,
        tabId: branch.baseTabId,
        /** Where on the canvas this branch lives, so the window can mark and jump to it. */
        anchors: view.anchors,
        /** The alternative's shape, so a caller (and the stored record) can see it, not guess it. */
        path: view.path,
      },
    }
  },
}

const flowEdit: ToolDef = {
  name: 'flow.edit',
  summary: 'Kendi branch’ine düzenleme ekler. Akışına dokunmaz; uygulamak için merge gerekir.',
  sendsInput: false,
  ready: true,
  run: async (args, ctx, source) => {
    const denied = writeGate(ctx, source)
    if (denied) return failed(flowEdit.name, denied)
    const picked = pickBranch(args, ctx)
    if ('error' in picked) return failed(flowEdit.name, picked.error)
    const { book, branch, view } = picked
    // A full recipe is refused, not trimmed: its groups build on each other, so dropping the
    // oldest would take away the edits the later ones stand on.
    if (branch.groups.length >= MAX_GROUPS) {
      return failed(
        flowEdit.name,
        `“${branch.name}” tarifi dolu (${branch.groups.length}/${MAX_GROUPS} düzenleme). Yeni bir branch aç ya da flow.undo ile yer aç; eski gruplar kendiliğinden silinmez.`
      )
    }
    // The group id is chosen before checking so the ids this answer reports are the same ones a
    // later look at the branch will show.
    const groupId = newGroupId()
    // A package holds a flow of its own. The ops are written against one level, and the group
    // remembers which: without this an edit inside a package could never be expressed at all.
    const targetPath = Array.isArray(args.packagePath) ? args.packagePath.filter((x): x is string => typeof x === 'string' && !!x) : []
    const where = targetGraph(view.derived as AgentGraph, targetPath)
    if (!where) {
      return failed(flowEdit.name, `Paket bulunamadı: ${targetPath.join(' › ') || '(boş yol)'}. Yolu flow.read’in verdiği packagePath ile ver.`)
    }
    const prefix = where.title ? `[${where.title}] ` : ''
    // Boş plan: ne değişeceğini söylemeyen bir çağrı "oldu" diyemez. Sessiz başarı, hiçbir şey
    // yapılmadığını gizler (batarya testinde tam olarak bu görüldü).
    if (!Array.isArray(args.ops) || args.ops.length === 0) {
      return failed(flowEdit.name, 'İşlem listesi boş: ne değişeceğini yaz ({ ops: [...] }). Boş plan kabul edilmez.')
    }
    const check = planOps(where.graph, args.ops, groupPrefix(groupId))
    if (!check.ok) {
      const head = check.errors.slice(0, 3).join(' ')
      const rest = check.errors.length > 3 ? ` (+${check.errors.length - 3} hata daha)` : ''
      const message = `Düzenleme reddedildi, hiçbir şey eklenmedi. ${prefix}${head}${rest}`
      ctx.log('warn', `Ajan · branch · ${message}`)
      return {
        ok: true,
        tool: flowEdit.name,
        outcome: 'plan-gecersiz',
        message,
        observed: { note: 'Branch’e hiçbir şey eklenmedi.' },
        data: { valid: false, errors: check.errors, warnings: check.warnings },
      }
    }
    const lines = describePlan(where.graph, check.plan).map((l) => prefix + l)
    const group = addGroup(branch, args.ops as EditOp[], text(args.note), groupId, targetPath)
    // The alternative's shape goes into the record straight away, so the stored recipe says
    // "leaves at A, comes back at B" instead of leaving that to be read out of the ops by hand.
    const shaped = derivePath((picked.view.base?.graph ?? view.derived) as AgentGraph, branch)
    if (shaped) branch.path = shaped
    else delete branch.path
    ctx.saveCanvases(book)
    const after = viewBranch(book, branch)
    const shape = after.path ? ` · alternatif yol: ${after.path.entry.nodeId} → ${after.path.exit.nodeId}` : ''
    const inPackage = targetPath.length ? ` · hedef: paket “${where.title}” içinde` : ''
    // A warning nobody sees is not a warning: the checker's findings belong in the answer.
    const warn = check.warnings.length ? ` Uyarı: ${check.warnings.join(' ')}` : ''
    const message = `“${branch.name}” branch’ine eklendi: ${prefix}${after.diff?.summary ?? '—'} (${branch.groups.length} düzenleme · ${branchOps(branch).length} işlem)${shape}${inPackage}.${warn} Geri almak için flow.undo (${group.id}). Akışına hiçbir şey yazılmadı.`
    ctx.log(check.warnings.length ? 'warn' : 'info', `Ajan · branch · ${message}`)
    return {
      ok: true,
      tool: flowEdit.name,
      outcome: 'tamam',
      message,
      observed: { note: 'Branch tarifine eklendi; çalışan akışa ve tuvale yazılmadı.' },
      data: {
        valid: true,
        branchId: branch.id,
        groupId: group.id,
        lines,
        diff: after.diff,
        applied: after.applied,
        failed: after.failed,
        baseChanged: after.baseChanged,
        path: after.path,
        warnings: check.warnings,
      },
    }
  },
}

const flowUndo: ToolDef = {
  name: 'flow.undo',
  summary: 'Branch’teki son düzenlemeyi geri alır.',
  sendsInput: false,
  ready: true,
  run: async (args, ctx, source) => {
    const denied = writeGate(ctx, source)
    if (denied) return failed(flowUndo.name, denied)
    const id = text(args.branchId)
    const book = ctx.getCanvases()
    const branch = findBranch(book, id)
    if (!branch) return failed(flowUndo.name, `Branch bulunamadı: ${id || '(boş)'}.`)
    const group = undoLast(branch)
    if (!group) return failed(flowUndo.name, `“${branch.name}” branch’inde geri alınacak düzenleme yok.`)
    // The shape is recomputed after an undo: a stored path that belonged to the group just removed
    // must not survive it, or a later merge would delete a stretch this recipe no longer describes.
    const shaped = derivePath((baseTabOf(book, branch)?.graph ?? { nodes: [], edges: [] }) as AgentGraph, branch)
    if (shaped) branch.path = shaped
    else delete branch.path
    ctx.saveCanvases(book)
    const after = viewBranch(book, branch)
    const message = `“${branch.name}” branch’inde son düzenleme geri alındı (${group.id}, ${group.ops.length} işlem). Kalan: ${after.diff?.summary ?? 'değişiklik yok'} (${branch.groups.length} düzenleme).`
    ctx.log('info', `Ajan · branch · ${message}`)
    return {
      ok: true,
      tool: flowUndo.name,
      outcome: 'tamam',
      message,
      observed: { note: 'Branch tarifinden çıkarıldı; akışa ve tuvale dokunulmadı.' },
      data: { branchId: branch.id, groupId: group.id, removed: group.ops.length, groups: branch.groups.length, diff: after.diff, lines: after.lines },
    }
  },
}

const branchDrop: ToolDef = {
  name: 'branch.drop',
  summary: 'Bir branch kaydını siler. Akışa hiçbir şey olmaz (branch zaten uygulanmamıştı).',
  sendsInput: false,
  ready: true,
  run: async (args, ctx, source) => {
    const denied = writeGate(ctx, source)
    if (denied) return failed(branchDrop.name, denied)
    const id = text(args.branchId)
    const book = ctx.getCanvases()
    const branch = findBranch(book, id)
    if (!branch) return failed(branchDrop.name, `Branch bulunamadı: ${id || '(boş)'}.`)
    book.branches = branchesOf(book).filter((b) => b.id !== branch.id)
    ctx.saveCanvases(book)
    const message = `Branch silindi: “${branch.name}” (${branch.groups.length} düzenleme). Akışa hiçbir şey olmadı.`
    ctx.log('info', `Ajan · branch · ${message}`)
    return { ok: true, tool: branchDrop.name, outcome: 'tamam', message, observed: { note: 'Yalnız kayıt silindi.' }, data: { branchId: branch.id, open: book.branches.length } }
  },
}

const branchMerge: ToolDef = {
  name: 'branch.merge',
  summary: 'Branch’in tarifini temel tuvaline uygular. Varsayılan yalnız denemedir; uygulamak için apply.',
  sendsInput: false,
  ready: true,
  run: async (args, ctx, source) => {
    const picked = pickBranch(args, ctx)
    if ('error' in picked) return failed(branchMerge.name, picked.error)
    const { book, branch, view } = picked
    const base = view.base
    const derived = view.derived as AgentGraph
    const wanted = args.apply === true
    // Trying a merge writes nothing, so anyone may ask for it; applying it does, so that is the
    // user's own move from the window.
    if (wanted && source !== 'panel') {
      return failed(branchMerge.name, 'Merge’ü uygulamak için Nubbo penceresini kullan (Ajan sekmesi · Mergele · Uygula). Deneme için apply göndermeden çağırabilirsin.')
    }
    const notes: string[] = []
    if (view.baseChanged) notes.push('temel tuval, branch açıldığından beri değişmiş.')
    if (view.failed.length) notes.push(`${view.failed.length} grup artık uymuyor ve atlanacak: ${view.failed.join(' | ')}`)
    const tail = notes.length ? ` ${notes.join(' ')}` : ''
    // The alternative's shape, if it has one: where it leaves the flow and where it comes back.
    const path = branch.path ?? (view.base ? derivePath(view.base.graph, branch) : null)
    if (path && !branch.path) {
      branch.path = path
      ctx.log('info', `Ajan · merge · “${branch.name}” alternatif yol olarak okundu: giriş ${path.entry.nodeId} · çıkış ${path.exit.nodeId}.`)
    }

    if (!wanted) {
      const preview = path && view.base ? pruneBypassed(derived, view.base.graph, path) : { removed: [], keptBack: [], ambiguous: undefined }
      const shape = path ? ` · alternatif yol: ${path.entry.nodeId} → ${path.exit.nodeId}` : ''
      const would = preview.removed.length ? ` · yerini aldığı ${preview.removed.length} node silinecek (${preview.removed.join(', ')})` : ''
      const kept = preview.keptBack.length ? ` · ${preview.keptBack.length} node erişilemez kalacak ama silinmeyecek (paket/kutu)` : ''
      const unclear = preview.ambiguous ? ` · eski kol belirsiz (${preview.ambiguous}): silme yapılmayacak` : ''
      const message = `Merge denemesi (uygulanmadı): ${view.diff?.summary ?? '—'} · “${base?.name ?? '—'}” tuvaline yazılacak.${shape}${would}${kept}${unclear}${tail} Uygulamak için apply: true.`
      ctx.log('info', `Ajan · merge · ${message}`)
      return {
        ok: true,
        tool: branchMerge.name,
        outcome: 'tamam',
        message,
        observed: { note: 'Yalnız denendi; hiçbir şey yazılmadı.' },
        data: {
          applied: false,
          branchId: branch.id,
          tabId: branch.baseTabId,
          diff: view.diff,
          lines: view.lines,
          failed: view.failed,
          baseChanged: view.baseChanged,
          path,
          wouldRemove: preview.removed,
          keptBack: preview.keptBack,
        },
      }
    }

    // An alternative path replaces the stretch it was written against. What the new flow can still
    // reach stays; what was only there for the old path goes, so the alternative becomes the flow
    // rather than sitting next to it. Nodes holding a package or a box are reported, never deleted.
    const pruned = path && view.base ? pruneBypassed(derived, view.base.graph, path) : { graph: derived, removed: [], keptBack: [] }
    if (pruned.removed.length) notes.push(`alternatifin yerini aldığı ${pruned.removed.length} node silindi (${pruned.removed.join(', ')}).`)
    if (pruned.keptBack.length) notes.push(`${pruned.keptBack.length} node artık erişilemez ama silinmedi, paket/kutu içeriği taşıyor: ${pruned.keptBack.join(', ')}.`)
    if (pruned.ambiguous) notes.push(`eski kol belirsiz olduğu için hiçbir şey silinmedi (${pruned.ambiguous}); alternatif yine de akışa yazıldı.`)

    const answer = await ctx.applyMerge({ tabId: branch.baseTabId, graph: pruned.graph, branchId: branch.id, branchName: branch.name })
    if (!answer.ok) {
      const message = `Merge uygulanamadı: ${answer.error ?? 'pencere yanıt vermedi'}. Kullanıcının akışına hiçbir şey yazılmadı.`
      ctx.log('warn', `Ajan · merge · ${message}`)
      return failed(branchMerge.name, message)
    }
    // The recipe is now part of the base: keeping it would apply the same edits a second time.
    book.branches = branchesOf(book).filter((b) => b.id !== branch.id)
    ctx.saveCanvases(book)
    const message = `Merge edildi: “${branch.name}” → “${base?.name ?? branch.baseTabId}” (${view.diff?.summary ?? '—'}). Tarif silindi, çünkü aynı düzenlemeler artık tuvalin kendisinde.${tail}`
    ctx.log('info', `Ajan · merge · ${message}`)
    return {
      ok: true,
      tool: branchMerge.name,
      outcome: 'tamam',
      message,
      observed: { note: 'Tuval pencereye devredildi; pencere kendi kaydını yapar.' },
      data: { applied: true, branchId: branch.id, tabId: branch.baseTabId, diff: view.diff, failed: view.failed, baseChanged: view.baseChanged },
    }
  },
}

const mergeUndo: ToolDef = {
  name: 'merge.undo',
  summary: 'Son merge’ü geri alır: tuvali merge öncesi hâline döndürür. Yalnız panelden, bir kez.',
  sendsInput: false,
  ready: true,
  run: async (_args, ctx, source) => {
    if (source !== 'panel') return failed(mergeUndo.name, 'Merge geri almayı yalnız Nubbo penceresinden yapabilirsin.')
    const peek = ctx.peekMergeUndo
    if (!peek) return failed(mergeUndo.name, 'Bu sürümde merge geri alma yok.')
    // Reading the undo does not consume it: only a confirmed restore may do that.
    const snap = peek()
    if (!snap) {
      return failed(mergeUndo.name, 'Geri alınacak merge yok. (Geri alma yalnız aynı oturumda ve bir kez çalışır; uygulama yeniden başladıysa unutulur.)')
    }
    const answer = await ctx.applyMerge(
      { tabId: snap.tabId, graph: snap.graph, branchId: '', branchName: 'merge geri alma', reason: 'undo' },
      { snapshot: false }
    )
    if (!answer.ok) {
      const message = `Merge geri alınamadı: ${answer.error ?? 'pencere yanıt vermedi'}. Tuval olduğu gibi kaldı; geri alma hakkı duruyor, tekrar deneyebilirsin.`
      ctx.log('warn', `Ajan · merge · ${message}`)
      return failed(mergeUndo.name, message)
    }
    ctx.commitMergeUndo?.()
    const message = 'Son merge geri alındı: tuval merge öncesi hâline döndü, tarif yeniden açıldı. (Bir kez geri alınabilir.)'
    ctx.log('info', `Ajan · merge · ${message}`)
    return {
      ok: true,
      tool: mergeUndo.name,
      outcome: 'tamam',
      message,
      observed: { note: 'Tuval pencereye devredildi; pencere kendi kaydını yapar.' },
      data: { applied: true, undone: true, tabId: snap.tabId },
    }
  },
}

const flowRead: ToolDef = {
  name: 'flow.read',
  summary: 'Akıştaki node’ları, paketleri ve döngüleri listeler. Yazmaz.',
  sendsInput: false,
  ready: true,
  run: async (args, ctx) => {
    const graph = graphOf(args, ctx)
    const nodes: (NodeRef & { summary: string })[] = []
    const loops: (LoopRef & { packagePath: string[]; memberIds: string[] })[] = []
    const packages: { id: string; title: string; packagePath: string[]; nodes: number }[] = []
    walkGraph(graph, ({ node, packagePath }) => {
      nodes.push({ ...nodeRef({ node, packagePath }), summary: summarize(node) })
      if (node.kind === 'loop') {
        const keys = loopKeys(node)
        const tick = loopStartIndex(node, keys.length, true)
        loops.push({
          id: node.id,
          title: node.title,
          total: keys.length,
          item: keys[tick],
          index: tick,
          packagePath,
          memberIds: [...(node.members ?? [])],
          folder: typeof node.folder === 'string' ? node.folder : undefined,
          count: typeof node.count === 'number' ? node.count : undefined,
          templated: !!node.templated,
          startIndex: typeof node.startIndex === 'number' ? node.startIndex : undefined,
        })
      }
      if (node.kind === 'package') packages.push({ id: node.id, title: node.title, packagePath, nodes: node.inner?.nodes.length ?? 0 })
    })
    // A box's members are the nodes a lap runs, so name them where the caller can see them.
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const loopsWithMembers = loops.map(({ memberIds, ...loop }) => ({
      ...loop,
      members: memberIds.map((id) => ({ id, title: byId.get(id)?.title ?? id, kind: byId.get(id)?.kind ?? '?' })),
    }))
    const edges = countEdges(graph)
    // Which canvas this is matters: a flow of 249 nodes can have several, and a caller that does
    // not know where it is reading from cannot know what it is about to change.
    const book = ctx.getCanvases?.() ?? null
    const active = book ? book.tabs.find((t) => t.id === book.activeId) ?? book.tabs[0] : null
    const where = active ? ` · tuval: “${active.name}”${book && book.tabs.length > 1 ? ` (${book.tabs.length} tuval)` : ''}` : ''
    const message = `${nodes.length} node · ${packages.length} paket · ${loops.length} döngü · ${edges} bağlantı (paketlerin içi dahil)${where}.`
    ctx.log('info', `Ajan · akışı oku · ${message}`)
    return {
      ok: true,
      tool: flowRead.name,
      outcome: 'tamam',
      message,
      data: {
        nodes,
        loops: loopsWithMembers,
        packages,
        edges,
        tabId: active?.id ?? null,
        tabName: active?.name ?? null,
        tabs: book?.tabs.map((t) => ({ id: t.id, name: t.name, active: t.id === book.activeId })) ?? [],
      },
    }
  },
}

/** Node kinds that resolve a target on screen; everything else never searches. */
const TARGET_KINDS = new Set(['click', 'type', 'probe', 'ai'])

const targetPreview: ToolDef = {
  name: 'target.preview',
  summary: 'Bir node için Nubbo’nun nereyi hedefleyeceğini gösterir. Ekrana girdi göndermez. fast: yalnız ekran aşamaları.',
  sendsInput: false,
  ready: true,
  run: async (args, ctx) => {
    // A branch is looked at as its derived graph, exactly like a single step.
    let graph = graphOf(args, ctx)
    let branchNote = ''
    const ask = branchArg(args)
    if (ask.asked) {
      if (!ask.id) return failed(targetPreview.name, EMPTY_BRANCH)
      const picked = pickBranch(args, ctx)
      if ('error' in picked) return failed(targetPreview.name, picked.error)
      graph = picked.view.derived as AgentGraph
      branchNote = ` · branch “${picked.branch.name}”`
      if (picked.view.failed.length) branchNote += ` (${picked.view.failed.length} grup uymuyor)`
    }
    const nodeId = text(args.nodeId)
    if (!nodeId) return failed(targetPreview.name, 'nodeId gerekli.')
    const place = findPlace(graph, nodeId)
    if (!place) return failed(targetPreview.name, `Node bulunamadı: ${nodeId}${branchNote}`)
    const node = place.node
    // A node that sends keys, waits or ends does not go looking for anything on screen. Saying
    // "not found" for it reads like a fault when nothing was ever searched, so say what it does.
    if (!TARGET_KINDS.has(node.kind)) {
      const what =
        node.kind === 'key'
          ? 'tuş gönderir; hedef aramaz (tuş odaktaki pencereye gider)'
          : node.kind === 'wait'
            ? 'zamanlar; hedef aramaz'
            : node.kind === 'end'
              ? 'akışı bitirir; hedef aramaz'
              : node.kind === 'condition'
                ? 'ekranda bir yazı arar ama tıklamaz; aranan yazı prompt alanında olmalı'
                : 'hedef aramaz'
      const message = `“${node.title}” (${node.kind}) ${what}.${branchNote}`
      ctx.log('info', `Ajan · hedef önizleme · ${message}`)
      return {
        ok: true,
        tool: targetPreview.name,
        outcome: 'tamam',
        message,
        observed: { note: 'Ekrana hiç dokunulmadı; aranacak bir hedef yok.' },
        data: { kind: node.kind, targets: false, candidates: [] },
      }
    }
    const fast = args.fast === true
    // The engine is loaded only when a tool actually needs it, so the tool layer stays light
    // and testable. A separate, silent agent: a preview writes no memory, sends no patch and
    // keeps no log of its own.
    const { createAgent } = await import('./agent')
    const traces: TargetTrace[] = []
    const agent = createAgent({
      log: () => {},
      send: () => {},
      settings: () => (fast ? withFastFind(ctx.getSettings()) : ctx.getSettings()),
      shouldStop: () => false,
      onTargetTrace: (event) => {
        if (traces.length < 200) traces.push(event)
      },
      captureTargetImages: false,
    })
    try {
      const target = await agent.previewTarget(node)
      const t = describeTrace(traces)
      const label = target.label || '—'
      const message = `“${node.title}” için aradım. ${t.text} Seçilen: ${label} (${Math.round(target.x)}, ${Math.round(target.y)}). Tıklama gönderilmedi.`
      ctx.log('info', `Ajan · hedefi önizle · ${message}`)
      return {
        ok: true,
        tool: targetPreview.name,
        outcome: 'tamam',
        message,
        node: nodeRef(place),
        target: { found: true, stage: t.stage, x: target.x, y: target.y, label: target.label, window: t.window, candidates: t.candidates },
        action: { kind: 'none', sent: false },
        observed: { note: 'Önizleme: ekrana hiçbir girdi gönderilmedi.' },
        loop: loopOf(graph, nodeId),
        data: { stages: t.stages },
      }
    } catch (e) {
      const reason = (e as Error).message
      const t = describeTrace(traces)
      const message = `“${node.title}” için aradım, bulamadım. ${t.text} Sebep: ${reason}`
      ctx.log('warn', `Ajan · hedefi önizle · ${message}`)
      return {
        ok: true,
        tool: targetPreview.name,
        outcome: 'hedef-yok',
        message,
        node: nodeRef(place),
        target: { found: false, reason, window: t.window },
        action: { kind: 'none', sent: false },
        observed: { note: 'Önizleme: ekrana hiçbir girdi gönderilmedi.' },
        loop: loopOf(graph, nodeId),
        data: { stages: t.stages },
        suggestion: 'Hedef bulunamadıysa node’un hedefini Ekrandan Seç ile yenilemek gerekebilir.',
      }
    }
  },
}

const flowContext: ToolDef = {
  name: 'flow.context',
  summary: 'Bir node’un paket yolunu, içindeki kutuları ve o anki öğeyi söyler.',
  sendsInput: false,
  ready: true,
  run: async (args, ctx) => {
    const graph = graphOf(args, ctx)
    const nodeId = text(args.nodeId)
    if (!nodeId) return failed(flowContext.name, 'nodeId gerekli.')
    const place = findPlace(graph, nodeId)
    if (!place) return failed(flowContext.name, `Node bulunamadı: ${nodeId}`)
    const context = contextOf(graph, nodeId)
    const chain = context?.loops ?? []
    const parts = [`“${place.node.title}”`]
    parts.push(place.packagePath.length ? `${place.packagePath.length} katman paket içinde` : 'kök seviyesinde')
    if (chain.length) {
      const last = chain[chain.length - 1]
      parts.push(
        `kutular: ${chain
          .map((l) => `${l.title}${typeof l.index === 'number' ? ` ${l.index + 1}/${l.total}` : ''}${l.item ? ` (“${l.item}”)` : ''}`)
          .join(' › ')}`
      )
      // A folder-backed box fills its list while it runs, so the saved item is a placeholder.
      if (last.templated || last.folder) parts.push('dikkat: bu kutunun öğe listesi çalışırken klasörden doldurulur')
    }
    parts.push('Yazma yok.')
    const message = parts.join(' · ')
    ctx.log('info', `Ajan · bağlam · ${message}`)
    return {
      ok: true,
      tool: flowContext.name,
      outcome: 'tamam',
      message,
      node: nodeRef(place),
      loop: chain.length ? chain[chain.length - 1] : undefined,
      loopChain: chain,
      data: { packagePath: place.packagePath, loops: chain },
    }
  },
}

const stepRun: ToolDef = {
  name: 'step.run',
  summary: 'Tek adım: seçilen node’u mevcut motorla çalıştırır, akışı ilerletmez. fast: model aşamalarını atlar.',
  sendsInput: true,
  ready: true,
  approvalNote: 'Tek adım: akış ilerlemez; döngü işareti, hafıza ve kayıtlı yol değişmez. Hedef bulmak uzun sürebilir.',
  run: async (args, ctx) => {
    // A branch is stepped through as its derived graph: the saved flow and the open canvas stay
    // as they are, and the step highlight is not sent to a canvas that is not showing it.
    let graph = graphOf(args, ctx)
    let onBranch = false
    let branchNote = ''
    const ask = branchArg(args)
    if (ask.asked) {
      if (!ask.id) return failed(stepRun.name, EMPTY_BRANCH)
      const picked = pickBranch(args, ctx)
      if ('error' in picked) return failed(stepRun.name, picked.error)
      graph = picked.view.derived as AgentGraph
      onBranch = true
      branchNote = ` · branch “${picked.branch.name}”`
      if (picked.view.failed.length) branchNote += ` (${picked.view.failed.length} grup uymuyor)`
    }
    const nodeId = text(args.nodeId)
    if (!nodeId) return failed(stepRun.name, 'nodeId gerekli.')
    if (ctx.isRunning()) return failed(stepRun.name, 'Bir koşu sürüyor; tek adım için önce durdur.')
    const place = findPlace(graph, nodeId)
    if (!place) return failed(stepRun.name, `Node bulunamadı: ${nodeId}${branchNote}`)
    const node = place.node
    if (node.kind === 'start' || node.kind === 'end') {
      return failed(stepRun.name, `“${NODE_SPECS[node.kind].label}” node’u tek adımda çalıştırılmaz.`)
    }
    const loop = loopOf(graph, nodeId)
    // The slot is claimed before the first await, so two callers cannot both get through and a
    // run cannot start on top of a step. It is released in the finally below.
    if (!beginProbe(nodeId)) return failed(stepRun.name, 'Başka bir tek adım sürüyor.')
    // A stop asked for earlier (or for a run that has since ended) must not end this step, while
    // one asked for *during* the step still does: it is the panel's Durdur for a long look.
    ctx.clearStop?.()
    const fast = args.fast === true
    const s = fast ? withFastFind(ctx.getSettings()) : ctx.getSettings()
    const timeoutMs = Math.min(15 * 60_000, Math.max(5_000, num(args.timeoutMs) ?? 120_000))
    const logs: string[] = []
    const traces: TargetTrace[] = []
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const { createAgent } = await import('./agent')
      const { probeOnce } = await import('./tool-probe')
      const agent = createAgent({
        log: (level, message) => {
          if (logs.length < 200) logs.push(`${level}: ${message}`)
          ctx.log(level, message)
        },
        send: (channel, payload) => {
          // Only the transient step highlight reaches the canvas: a probe writes nothing.
          if (channel === 'agent:step' && !onBranch) ctx.sendStep(payload)
        },
        settings: ctx.getSettings,
        shouldStop: () => timedOut || ctx.userStop(),
        setLoop: () => {},
        setMethod: () => {},
        onTargetTrace: (event) => {
          if (traces.length < 200) traces.push(event)
        },
        captureTargetImages: false,
      })
      timer = setTimeout(() => {
        timedOut = true
      }, timeoutMs)
      const started = Date.now()
      const r = await probeOnce(graph, nodeId, agent.executor, {
        packagePath: place.packagePath,
        maxSteps: Math.max(1, s.maxSteps),
        stepDelayMs: Math.max(0, s.stepDelayMs),
        userStop: () => timedOut || ctx.userStop(),
      })
      const ms = Date.now() - started
      const t = describeTrace(traces)
      const acted = actionSent(node.kind, r.nodeStatus, traces)

      if (r.interrupted) {
        const why = timedOut ? `süre doldu (${Math.round(timeoutMs / 1000)} sn)` : 'kullanıcı durdurdu'
        const message = `“${node.title}” çalıştırılamadı: ${why}.`
        ctx.log('warn', `Ajan · tek adım · ${message}`)
        return { ok: true, tool: stepRun.name, outcome: 'durduruldu', message, node: nodeRef(place), action: { kind: node.kind, sent: acted }, loop, log: logs.slice(-12) }
      }

      // A box can catch a failing member (a bad loop item does not stop the flow), so the run
      // may end saying nothing while this very node failed. That must not read as success.
      if (r.nodeStatus === 'error') {
        const failed = r.summary?.failed ? ` Akış bu turu hatalı saydı (${r.summary.failed}).` : ''
        const message = `“${node.title}” hata verdi.${t.text ? ` ${t.text}` : ''}${failed}`
        ctx.log('warn', `Ajan · tek adım · ${message}`)
        return {
          ok: true,
          tool: stepRun.name,
          outcome: 'hata',
          message,
          node: nodeRef(place),
          action: { kind: node.kind, sent: acted },
          loop,
          log: logs.slice(-12),
          data: { ms, nodeStatus: r.nodeStatus, official: r.summary ?? null },
        }
      }

      // The chain may also end without this node ever reporting: then there is no evidence that
      // anything happened, and saying "çalıştırıldı" would be a claim the tool cannot support.
      if (!r.reachedNode) {
        const message = `“${node.title}” için zincir bitti ama node sonucunu bildirmedi; bu adım doğrulanmış sayılmıyor.`
        ctx.log('warn', `Ajan · tek adım · ${message}`)
        return {
          ok: true,
          tool: stepRun.name,
          outcome: 'eylem-belirsiz',
          message,
          node: nodeRef(place),
          action: { kind: node.kind, sent: acted },
          loop,
          log: logs.slice(-12),
          data: { ms, nodeStatus: r.nodeStatus, official: r.summary ?? null },
        }
      }

      const parts = [`“${node.title}” çalıştırıldı${branchNote}.`]
      if (t.stage) {
        parts.push(
          `Hedef: ${t.stage}${t.candidates !== undefined ? ` · ${t.candidates} aday` : ''}${t.label ? ` · “${t.label}”` : ''}${
            typeof t.x === 'number' ? ` (${Math.round(t.x)}, ${Math.round(t.y ?? 0)})` : ''
          }.`
        )
      }
      parts.push(acted ? 'Eylem gönderildi.' : 'Eylem gönderilmedi.')
      if (loop) parts.push(`Döngü: ${loop.title}${typeof loop.index === 'number' ? ` · ${loop.index + 1}/${loop.total}` : ''}${loop.item ? ` (“${loop.item}”)` : ''}.`)
      parts.push(`Zincir bu adımdan sonra durduruldu (${ms} ms); akış ilerlemedi.`)
      const message = parts.join(' ')
      ctx.log('info', `Ajan · tek adım · ${message}`)
      return {
        ok: true,
        tool: stepRun.name,
        outcome: 'tamam',
        message,
        node: nodeRef(place),
        target: t.stage ? { found: true, stage: t.stage, label: t.label, x: t.x, y: t.y, window: t.window, candidates: t.candidates } : undefined,
        action: { kind: node.kind, sent: acted },
        observed: { note: 'Tek adım: kopya akış üzerinde koştu; işaret, hafıza ve kayıtlı yol değişmedi.' },
        loop,
        log: logs.slice(-12),
        data: { ms, reachedNode: r.reachedNode, nodeStatus: r.nodeStatus, official: r.summary ?? null },
      }
    } catch (e) {
      const reason = (e as Error).message
      const outcome: ToolOutcome = /bulunamadı/.test(reason) ? 'hedef-yok' : 'hata'
      const message = `“${node.title}” çalıştırılamadı: ${reason}`
      ctx.log(outcome === 'hedef-yok' ? 'warn' : 'error', `Ajan · tek adım · ${message}`)
      return { ok: true, tool: stepRun.name, outcome, message, node: nodeRef(place), action: { kind: node.kind, sent: false }, loop, log: logs.slice(-12) }
    } finally {
      if (timer) clearTimeout(timer)
      endProbe()
    }
  },
}

const runFrom: ToolDef = {
  name: 'run.from',
  summary: 'Belirtilen node’dan akışı sürdürür. Koşu başlar ve hemen döner.',
  sendsInput: true,
  ready: true,
  approvalNote: 'Koşu başlar ve akış ilerler; run.stop ile durdurulabilir.',
  run: async (args, ctx) => {
    // A branch run works on the derived graph: it is not the saved flow, so it is neither stored
    // as the active flow nor highlighted on the canvas the user is looking at.
    let graph = graphOf(args, ctx)
    let derived = false
    let branchNote = ''
    const ask = branchArg(args)
    if (ask.asked) {
      if (!ask.id) return failed(runFrom.name, EMPTY_BRANCH)
      const picked = pickBranch(args, ctx)
      if ('error' in picked) return failed(runFrom.name, picked.error)
      graph = picked.view.derived as AgentGraph
      derived = true
      branchNote = ` · branch “${picked.branch.name}”`
      if (picked.view.failed.length) branchNote += ` (${picked.view.failed.length} grup uymuyor)`
    }
    if (ctx.isRunning()) return failed(runFrom.name, 'Bir koşu zaten sürüyor.')
    if (probing()) return failed(runFrom.name, 'Tek adım sürüyor; bitmesini bekle.')
    const nodeId = text(args.nodeId)
    // Starting a whole flow from its beginning is not something to fall into: without a node the
    // caller has to say so on purpose.
    if (!nodeId && args.fromStart !== true) {
      return failed(
        runFrom.name,
        'Baştan koşu için açık onay gerekir: { fromStart: true }. Bu, akışın tamamını ilk adımdan çalıştırır. Tek bir node’dan başlatmak için nodeId ver.'
      )
    }
    const place = nodeId ? findPlace(graph, nodeId) : null
    if (nodeId && !place) return failed(runFrom.name, `Node bulunamadı: ${nodeId}${branchNote}`)
    // Resuming where the failure left off: the boxes around it and the item they were on are only
    // known from the frozen report, and setting them back in the graph is what keeps a lap from
    // starting its list over. It only ever happens on a branch copy, never on the saved flow.
    let resumeNote = ''
    if (args.resumeFromFailure === true) {
      if (!derived) {
        return failed(runFrom.name, 'Hatadan devam yalnız bir branch koşusunda yapılır; kayıtlı akışta işaretler değiştirilmez.')
      }
      const report = frozenReport(text(args.resumeRunId) || undefined)
      if (!report) return failed(runFrom.name, 'Devam edilecek donmuş hata yok; önce debug: true ile koş.')
      if (!report.loops.length) return failed(runFrom.name, 'Donmuş hatada kutu yok; devam edilecek öğe de yok.')
      const missing: string[] = []
      for (const box of report.loops) {
        // The box may be inside a package, so it is looked up through the tree, not in the root list.
        const at = box.id ? findPlace(graph, box.id)?.node : undefined
        const idx = typeof box.index === 'number' ? box.index : 0
        if (!at) {
          missing.push(box.title)
          continue
        }
        at.loopIndex = idx
        at.startIndex = idx
        // The index is not the item. If files were added or the list changed, position 2 is a
        // different file now; continuing would quietly work on the wrong one. The record says which
        // item it was, so it is compared before anything starts.
        const member = (at as { members?: string[] }).members?.[0]
        if (member && typeof box.item === 'string' && box.item) {
          const now = contextOf(graph, member)?.loops?.find((l) => l.id === box.id)
          if (now && String(now.item ?? '') !== String(box.item)) {
            return failed(
              runFrom.name,
              `Liste değişmiş: “${box.title}” kutusunun ${idx + 1}. öğesi artık “${now.item ?? ''}”, kayıtlı öğe “${box.item}”. Yanlış öğeden devam etmemek için duruyorum.`
            )
          }
        }
      }
      if (missing.length) return failed(runFrom.name, `Bazı kutular bu branch’te yok: ${missing.join(', ')}. Devam edilemez.`)
      const inner = report.loops[report.loops.length - 1]
      const vars = inner?.vars ? Object.entries(inner.vars).slice(0, 6).map(([k, v]) => `${k}=${v}`).join(', ') : ''
      resumeNote = ` · hatadan devam (koşu ${report.runId}, ${report.failureId}): “${inner?.title ?? '?'}” ${(inner?.index ?? 0) + 1}/${inner?.total ?? '?'}${inner?.item ? ` (“${inner.item}”)` : ''}${vars ? ` · değişkenler: ${vars}` : ''}`
      ctx.log('info', `Ajan · buradan devam · koşu ${report.runId} hatasından, aynı öğeden: ${inner?.title ?? '?'} ${(inner?.index ?? 0) + 1}/${inner?.total ?? '?'}${inner?.item ? ` (“${inner.item}”)` : ''}.`)
    }
    const untilId = text(args.untilNodeId)
    const untilPlace = untilId ? findPlace(graph, untilId) : null
    if (untilId && !untilPlace) return failed(runFrom.name, `Duracak node bulunamadı: ${untilId}${branchNote}`)
    if (untilId && !nodeId) {
      return failed(runFrom.name, 'Sınırlı test için başlangıç node’u da gerekir (nodeId); bölge iki ucuyla belirtilir.')
    }
    // The stop is checked between steps, so a single-node region cannot be measured this way: the
    // chain is over before any boundary arrives. Saying so is better than pretending it stopped.
    if (untilId && untilId === nodeId) {
      return failed(
        runFrom.name,
        'Sınır başlangıçla aynı: tek adımlık bölge bu yolla ölçülemez (durdurma adımlar arasında denetlenir). Tek bir node denemek için step.run kullan.'
      )
    }
    const asked = Array.isArray(args.packagePath) ? (args.packagePath as string[]) : []
    const packagePath = asked.length ? asked : place?.packagePath ?? []
    const from = nodeId ? `“${place?.node.title ?? nodeId}”` : 'baştan'
    void ctx
      .startRun(graph, nodeId || undefined, packagePath.length ? packagePath : undefined, {
        ...(derived ? { derived: true } : {}),
        ...(args.debug === true ? { debug: true } : {}),
        ...(args.fast === true ? { fast: true } : {}),
      })
      .catch((e: Error) => ctx.log('error', `Koşu hatası: ${e.message}`))
    // The boundary is set after the run starts, because beginRun clears it: it belongs to this run.
    setStopAt(untilId || null)
    // The run begins synchronously, so its id is already known: this answer means the run
    // started, never that it finished.
    const runId = snapshot().runId
    const untilNote = untilId ? ` · “${untilPlace?.node.title ?? untilId}” bitince duracak (sınırlı bölge testi)` : ''
    const message = `Koşu başladı (${from})${branchNote}${runId ? ` · ${runId}` : ''}${untilNote}${resumeNote}; sonucu run.state ile oku, durdurmak için run.stop.${derived ? ' Bu bir branch koşusu: kayıtlı akışa yazılmaz.' : ''}${args.debug === true ? ' Debug: ilk hatalı adımda durur ve o anın bağlamını saklar (run.report).' : ''}`
    ctx.log('info', `Ajan · buradan devam · ${message}`)
    return {
      ok: true,
      tool: runFrom.name,
      outcome: 'tamam',
      message,
      node: place ? nodeRef(place) : undefined,
      loop: nodeId ? loopOf(graph, nodeId) : undefined,
      action: { kind: 'run', sent: true },
      observed: { note: 'Koşu başlatıldı; bu cevap koşunun bittiği anlamına gelmez.' },
      data: { started: true, runId: runId ?? null, startId: nodeId || null, packagePath, untilId: untilId || null },
    }
  },
}

/**
 * True when a scan was asked for one window and read another. The engine falls back to the
 * window in front when the asked-for title is not found, which is fine for a look but must never
 * be reported as if the asked-for window had been read: acting on the wrong window is the first
 * thing this project refuses to do.
 */
export function windowMismatch(wanted: string, got: string | undefined): boolean {
  const want = wanted.trim().toLowerCase()
  if (!want) return false
  const have = (got ?? '').trim().toLowerCase()
  return have !== want && !have.includes(want)
}

/**
 * Tek tek eylemler: akış kurmadan çalışmanın kapısı.
 *
 * Her çağrı tek kullanımlık bir grafik kurar (tek node), motoru onun kopyasında koşturur ve node
 * bitince durur. Tuval, branch ve kayıtlı akış görülmez; hiçbir şey yazılmaz. Motorun hedef bulma,
 * odak ve güvenlik yolları aynen kullanılır. Uygulama eylem sırasında küçültülür (koşularda olduğu
 * gibi) ki masaüstünde ne olduğu görülebilsin; sonda geri açılır.
 */
async function runOneAction(name: string, spec: ActSpec, args: Args, ctx: ToolContext): Promise<ToolResult> {
  // A running flow owns the desktop. The single-step slot is not enough: a normal run uses the mouse
  // too, and an action slipping into the middle of one would fight it for the same cursor.
  if (ctx.isRunning()) return failed(name, 'Bir koşu sürüyor; tek eylem için önce bitmesini bekle ya da durdur.')
  if (probing()) return failed(name, 'Tek adım sürüyor; bitmesini bekle.')
  const { node } = actionGraph(spec)
  if (!beginProbe(node.id)) return failed(name, 'Tek adım sürüyor; bitmesini bekle.')
  // The desktop is ours now: a stop left over from an earlier run or a debug failure must not cut
  // this action short. A stop that arrives from here on is honoured.
  ctx.clearStop?.()
  const s = ctx.getSettings()
  const timeoutMs = num(args.timeoutMs) ?? (spec.kind === 'wait' ? 60_000 : 90_000)
  const logs: string[] = []
  const traces: TargetTrace[] = []
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let hidden = false
  try {
    const { createAgent } = await import('./agent')
    // The previous action's target is a hint, not an answer: it only helps tell two same-named
    // controls apart, and only while it is recent.
    const near = actPointWithin(60_000)
    if (near && !spec.fields.locator && spec.kind !== 'wait' && spec.kind !== 'key') {
      spec.fields.locator = { x: near.x, y: near.y }
    }
    const agent = createAgent({
      log: (level, message) => {
        if (logs.length < 200) logs.push(`${level}: ${message}`)
        ctx.log(level, `Ajan · eylem · ${message}`)
      },
      send: (channel, payload) => {
        if (channel === 'agent:step') ctx.sendStep(payload)
      },
      settings: ctx.getSettings,
      shouldStop: () => timedOut || ctx.userStop(),
      setLoop: () => {},
      setMethod: () => {},
      onTargetTrace: (event) => {
        if (traces.length < 200) traces.push(event)
      },
      captureTargetImages: false,
    })
    if (args.hide !== false && ctx.hideApp) hidden = await ctx.hideApp().catch(() => false)
    timer = setTimeout(() => {
      timedOut = true
    }, timeoutMs)
    const r = await runAction(spec, agent.executor, {
      maxSteps: Math.max(1, s.maxSteps),      stepDelayMs: Math.max(0, s.stepDelayMs),
      userStop: () => timedOut || ctx.userStop(),
      onTrace: (e) => {
        if (traces.length < 200) traces.push(e as TargetTrace)
      },
    })
    const t = describeTrace(traces)
    // Remember where this action aimed: the next one uses it only to tell two same-named controls
    // apart, and only for a minute.
    if (r.status === 'done') {
      const hit = [...traces].reverse().find((e) => (e as { kind?: string }).kind === 'resolved') as
        | { target?: { x?: number; y?: number } }
        | undefined
      if (hit?.target && typeof hit.target.x === 'number' && typeof hit.target.y === 'number') {
        noteActPoint({ x: hit.target.x, y: hit.target.y })
      }
    }
    const where = `${t.text}${spec.kind === 'wait' ? '' : ` Seçilen: ${t.stage ?? '—'}${t.candidates !== undefined ? ` · ${t.candidates} aday` : ''}.`}`
    if (timedOut) {
      const message = `${spec.title} zaman aşımına uğradı (${Math.round(timeoutMs / 1000)} sn). ${where}`
      ctx.log('warn', `Ajan · eylem · ${message}`)
      return { ok: false, tool: name, outcome: 'hata', message, data: { logs: logs.slice(-16), status: r.status, ms: r.ms, stages: t.stages } }
    }
    if (r.status === 'done') {
      // "Gönderildi" ile "oldu" arasındaki fark: moturun kendi uyarısı varsa bu adım doğrulanmış
      // sayılmaz. Sessizce "tamam" demek, ekranda hiçbir şey olmamışken başarı raporlamak olur.
      const unclear = logs.some((l) => /Tepki net değil|Akış bozulmadan sıradaki adım/.test(l))
      if (unclear) {
        const message = `${spec.title} gönderildi ama tepkisi net değil; ekranda beklenen sonuç doğrulanmadı, bakılmalı (${r.ms} ms). ${where}`
        ctx.log('warn', `Ajan · eylem · ${message}`)
        return {
          ok: true,
          tool: name,
          outcome: 'eylem-belirsiz',
          message,
          action: { kind: spec.kind, sent: true },
          observed: { note: 'Girdi gönderildi; sonuç doğrulanamadı. Başarı sayılmaz.' },
          data: { logs: logs.slice(-16), status: 'done-unclear', ms: r.ms, stages: t.stages },
        }
      }
      const message = `${spec.title} yapıldı (${r.ms} ms). ${where}`
      ctx.log('info', `Ajan · eylem · ${message}`)
      return { ok: true, tool: name, outcome: 'tamam', message, action: { kind: spec.kind, sent: true }, data: { logs: logs.slice(-16), status: 'done', ms: r.ms, stages: t.stages } }
    }
    if (r.status === 'error') {
      const message = `${spec.title} yapılamadı: hedef bulunamadı ya da eylem reddedildi. ${where}`
      ctx.log('warn', `Ajan · eylem · ${message}`)
      return { ok: false, tool: name, outcome: /ekranda bulunamadı|bulunamadı/.test(t.text) ? 'hedef-yok' : 'hata', message, action: { kind: spec.kind, sent: false }, data: { logs: logs.slice(-16), status: 'error', ms: r.ms, stages: t.stages } }
    }
    const message = `${spec.title} sonucu belirsiz: node sonuç bildirmedi (${r.ms} ms). ${where}`
    ctx.log('warn', `Ajan · eylem · ${message}`)
    return { ok: true, tool: name, outcome: 'eylem-belirsiz', message, action: { kind: spec.kind, sent: false }, data: { logs: logs.slice(-16), status: 'none', ms: r.ms, stages: t.stages } }
  } finally {
    if (timer) clearTimeout(timer)
    endProbe()
    // Bringing the window back must not take the focus back: in a sequence like Win+R, type, Enter
    // that would pull the foreground out of the dialog the next action has to type into.
    if (hidden) await ctx.showApp?.({ focus: false }).catch(() => false)
  }
}

function actFields(args: Args): { spec: ActSpec; problem?: string } {
  const target = text(args.target) || text(args.text)
  const into = text(args.into)
  const keys = text(args.keys)
  return { spec: { kind: 'click', title: '', fields: {} }, problem: undefined }
}

const actClick: ToolDef = {
  name: 'act.click',
  summary: 'Şu an ekranda olan bir şeye tıkla (akış kurmadan). Hedefi metniyle söyle.',
  sendsInput: true,
  ready: true,
  run: async (args, ctx, source) => {
    const denied = writeGate(ctx, source)
    if (denied) return failed(actClick.name, denied)
    const target = text(args.target)?.trim()
    if (!target) return failed(actClick.name, 'Ne tıklanacağını söyle: { target: "Kaydet" }.')
    return runOneAction(
      actClick.name,
      { kind: 'click', title: `Tıkla: “${target}”`, fields: { prompt: target, ...(args.mode ? { clickMode: text(args.mode) } : {}) } },
      args,
      ctx
    )
  },
}

const actType: ToolDef = {
  name: 'act.type',
  summary: 'Ekrandaki alana yaz (akış kurmadan). Alanı metniyle söyle; boş bırakılırsa odaktaki alana yazar.',
  sendsInput: true,
  ready: true,
  run: async (args, ctx, source) => {
    const denied = writeGate(ctx, source)
    if (denied) return failed(actType.name, denied)
    // Kırpılır: yalnız boşluktan oluşan bir "yazı" guard'ı geçip motora ulaşırsa odaktaki pencereye
    // boşluk yazardı (batarya testinde tam olarak bu oldu).
    const body = text(args.text)?.trim()
    if (!body) return failed(actType.name, 'Ne yazılacağını söyle: { text: "merhaba" }.')
    const into = text(args.into)?.trim()
    return runOneAction(
      actType.name,
      {
        kind: 'type',
        title: into ? `“${into}” alanına yaz` : 'Odaktaki alana yaz',
        fields: { text: body, ...(into ? { prompt: into } : {}), pressEnter: args.enter === true, clearFirst: args.clear !== false },
      },
      args,
      ctx
    )
  },
}

const actKey: ToolDef = {
  name: 'act.key',
  summary: 'Klavye kısayolu gönder (akış kurmadan): "win+r", "ctrl+s", "enter".',
  sendsInput: true,
  ready: true,
  run: async (args, ctx, source) => {
    const denied = writeGate(ctx, source)
    if (denied) return failed(actKey.name, denied)
    const keys = text(args.keys)?.trim()
    if (!keys) return failed(actKey.name, 'Hangi tuş: { keys: "win+r" }.')
    return runOneAction(actKey.name, { kind: 'key', title: `Tuş: ${keys}`, fields: { keys } }, args, ctx)
  },
}

const actWait: ToolDef = {
  name: 'act.wait',
  summary: 'Belirtilen süre kadar bekle (akış kurmadan).',
  sendsInput: false,
  ready: true,
  run: async (args, ctx) => {
    const ms = num(args.ms) ?? 1000
    return runOneAction(actWait.name, { kind: 'wait', title: `${ms} ms bekle`, fields: { ms } }, args, ctx)
  },
}

const screenRead: ToolDef = {
  name: 'screen.read',
  summary: 'Pencereleri ve ekrandaki yazıları okur; isterse ekran görüntüsünün yolunu verir.',
  // When an MCP adapter is added, a requested image must travel with the answer itself, not
  // only as a path: the model has to receive the picture, not a file name.
  sendsInput: false,
  ready: true,
  run: async (args, ctx) => {
    const { listWindows, scan } = await import('./a11y-bridge')
    const windows = await listWindows()
    const windowTitle = text(args.windowTitle) || undefined
    const wantImage = args.image === true
    const s = await scan({
      windowTitle,
      ocr: true,
      uia: true,
      readOnly: true,
      fresh: true,
      image: wantImage ? 'plain' : 'none',
      maxImageW: num(args.maxImageW) ?? 1600,
      sig: true,
    })
    const items = (s.items ?? []).slice(0, 200).map((i) => ({ id: i.id, text: i.text, x: i.x, y: i.y, w: i.w, h: i.h, src: i.src, type: i.type }))
    // An asked-for picture must travel with the answer: as data the caller can actually look at, and
    // as a file with a path it can open. Before this, asking for an image produced a message about a
    // screenshot whose path was never returned, so the caller was told about an image it could not see.
    let imagePath = ''
    let imageData: { data: string; mime: string; w: number; h: number } | null = null
    if (wantImage) {
      if (s.image?.data) {
        imageData = { data: s.image.data, mime: s.image.mime || 'image/png', w: s.image.w ?? 0, h: s.image.h ?? 0 }
        try {
          const fs = await import('node:fs')
          const os = await import('node:os')
          const pathMod = await import('node:path')
          const ext = /jpe?g/i.test(s.image.mime || '') ? 'jpg' : 'png'
          imagePath = pathMod.join(os.tmpdir(), `nubbo-screen-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`)
          fs.writeFileSync(imagePath, Buffer.from(s.image.data, 'base64'))
        } catch {
          imagePath = ''
        }
      }
    }
    const where = windowTitle ? `“${windowTitle}”` : 'önde olan pencere'
    const wrong = windowMismatch(windowTitle ?? '', s.window)
    const warning = wrong
      ? ` DİKKAT: istediğin pencere bulunamadı; bunun yerine “${s.window || 'öndeki pencere'}” okundu.`
      : ''
    const imageNote = !wantImage
      ? ''
      : imageData
        ? ` · görüntü eklendi${imagePath ? ` ve kaydedildi: ${imagePath}` : ''}`
        : s.shot
          ? ` · görüntü: ${s.shot}`
          : ' · görüntü alınamadı'
    const message = `${windows.length} pencere · ${where} · ${items.length} yazı/öğe okundu${imageNote}${warning}`
    ctx.log(wrong ? 'warn' : 'info', `Ajan · ekranı oku · ${message}`)
    return {
      ok: true,
      tool: screenRead.name,
      outcome: 'tamam',
      message,
      observed: {
        note: `${wantImage ? (imageData ? 'İstenen görüntü cevabın içinde (data.image) ve diskte.' : 'Görüntü istendi ama alınamadı.') : 'Görüntü istenmedi.'}${wrong ? ' İstenen pencere ile okunan pencere aynı değil.' : ' İstenen pencere okundu.'}`,
      },
      data: { windows: windows.slice(0, 40), window: s.window, requested: windowTitle ?? '', matched: !wrong, area: s.area, ocr: s.ocr, shot: s.shot, imagePath, image: imageData, sig: s.sig, items },
    }
  },
}

const runReport: ToolDef = {
  name: 'run.report',
  summary: 'Koşunun son hata anını bağlamıyla verir: node, paket yolu, kutu öğeleri, adım geçmişi, günlük ve hata görüntüsü.',
  sendsInput: false,
  ready: true,
  run: async (args, ctx) => {
    const asked = text(args.runId)
    const frozen = frozenReport(asked || undefined)
    const s = snapshot()
    if (!frozen) {
      const older = recentReports().filter((r) => r.runId !== s.runId)
      return {
        ok: true,
        tool: runReport.name,
        outcome: 'tamam',
        message: `Donmuş hata yok${ctx.isRunning() ? ' (koşu sürüyor)' : ''}${asked ? ` (runId ${asked} bulunamadı)` : ''}. Şu an: ${s.nodeTitle ?? '—'} · gözlenen ${s.observed.done} tamam, ${s.observed.errors} hata${s.lastError ? ` · son hata: ${s.lastError}` : ''}.${older.length ? ` Saklanan ${older.length} eski rapor var: ${older.map((r) => r.runId).join(', ')}.` : ''}`,
        observed: {
          note: 'Debug koşusu (run.from · debug: true) ilk hata anında durur ve o anın bağlamını saklar; normal koşuda motor kendi hata politikasını uygular. Kullanıcının Durdur eylemi hata sayılmaz.',
        },
        data: { frozen: null, snapshot: s, debug: isDebugRun(), older: older.map((r) => ({ runId: r.runId, failureId: r.failureId, at: r.at, nodeTitle: r.nodeTitle })) },
      }
    }
    const loops = frozen.loops.length
      ? frozen.loops
          .map((l) => `${l.title}${typeof l.index === 'number' ? ` ${l.index + 1}/${l.total ?? '?'}` : ''}${l.item ? ` (“${l.item}”)` : ''}`)
          .join(' · ')
      : 'kutu yok'
    const shotText = frozen.shot ? ` · ekran görüntüsü: ${frozen.shot}` : frozen.shotPending ? ' · ekran görüntüsü: henüz yazılmadı' : ' · ekran görüntüsü alınamadı'
    const errText = frozen.error || (frozen.errorPending ? '(motorun hata mesajı henüz gelmedi)' : '(mesaj yok)')
    const message =
      `Hata anı (${frozen.kind === 'run' ? 'koşu hatası' : 'adım hatası'} · ${frozen.failureId}, koşu ${frozen.runId}): “${frozen.nodeTitle || frozen.nodeId}” · kutu: ${loops}` +
      `${frozen.packagePath.length ? ` · paket: ${frozen.packagePath.join(' › ')}` : ''}` +
      ` · ${frozen.steps.filter((x) => x.status === 'done').length} adım tamamlandı, hata: ${errText}${shotText}`
    ctx.log('warn', `Ajan · koşu raporu · ${message}`)
    return {
      ok: true,
      tool: runReport.name,
      outcome: 'tamam',
      message,
      observed: {
        note: 'Bu, hatanın olduğu andaki bağlamdır: motor durdurulduğu için sonraki öğeye geçilmedi. Bir bölgenin geçmesi yalnız o bölgenin kanıtıdır, akışın tamamının değil.',
      },
      data: { frozen, snapshot: s, debug: isDebugRun() },
    }
  },
}

const runWait: ToolDef = {
  name: 'run.wait',
  summary: 'Koşu bitene kadar bekler (en fazla verilen süre) ve sonucu döndürür. Yoklama yapmayı gereksiz kılar.',
  sendsInput: false,
  ready: true,
  run: async (args, ctx) => {
    const limit = Math.max(1_000, Math.min(30 * 60_000, num(args.timeoutMs) ?? 5 * 60_000))
    const started = Date.now()
    const wasRunning = ctx.isRunning()
    while (ctx.isRunning() && Date.now() - started < limit) {
      await new Promise((r) => setTimeout(r, 500))
    }
    const s = snapshot()
    const waited = Math.round((Date.now() - started) / 1000)
    if (ctx.isRunning()) {
      const message = `Koşu hâlâ sürüyor (${waited} sn beklendi, sınır ${Math.round(limit / 1000)} sn): “${s.nodeTitle ?? s.nodeId ?? '—'}” · ${s.observed.done} tamam, ${s.observed.errors} hata.`
      ctx.log('info', `Ajan · bekle · ${message}`)
      return { ok: true, tool: runWait.name, outcome: 'tamam', message, observed: { note: 'Süre doldu, koşu bitmedi.' }, data: { running: true, snapshot: s, waitedMs: Date.now() - started } }
    }
    const last = s.last
    // When the run was stopped on purpose, the step that was in flight can be counted as an error.
    // Saying which steps ran keeps that from reading as a failure that has to be investigated.
    const tail =
      (stopReason() === 'until' || stopReason() === 'user') && s.observed.errors > 0
        ? ` · son adımlar: ${recentSteps(6)
            .map((x) => `${x.status === 'error' ? '✗' : x.status === 'done' ? '✓' : '·'} ${x.id}`)
            .join(' ')}`
        : ''
    const why =
      stopReason() === 'until'
        ? ' (istenen node bitince durduruldu: sınırlı bölge testi)'
        : stopReason() === 'user'
          ? ' (kullanıcı durdurdu)'
          : stopReason() === 'debug-error'
            ? ' (hata sonrası durdu)'
            : ''
    const message = wasRunning
      ? `Koşu bitti (${waited} sn beklendi): ${last?.ok ? 'tamamlandı' : last?.stopped ? 'durduruldu' : 'hata ile bitti'}${why}${tail}${last?.steps !== undefined ? ` · ${last.steps} adım` : ''} · ${s.observed.done} tamam, ${s.observed.errors} hata${s.lastError ? ` · son hata: ${s.lastError}` : ''}${s.review ? ` · ${s.review} adım BAKILMALI (tepkisi net değildi, gönderildi ama doğrulanamadı${s.lastReview ? `: ${s.lastReview.slice(0, 80)}` : ''})` : ''}.`
      : 'Beklenecek bir koşu yok.'
    ctx.log('info', `Ajan · bekle · ${message}`)
    return {
      ok: true,
      tool: runWait.name,
      outcome: 'tamam',
      message,
      observed: { note: 'Koşunun resmî sonucu ve gözlenen adımlar ayrı alanlarda.' },
      data: { running: false, last, snapshot: s, waitedMs: Date.now() - started, stoppedBy: stopReason() },
    }
  },
}

/** The agent asking the window to show a branch, or to close the view. The window owns the canvas. */
const branchShow: ToolDef = {
  name: 'branch.show',
  summary: 'Öneriyi tuvalde gösterir (İncele gibi) ya da açık incelemeyi kapatır. Akışa hiçbir şey yazmaz.',
  sendsInput: false,
  ready: true,
  run: async (args, ctx) => {
    const show = ctx.showBranch
    if (!show) return failed(branchShow.name, 'Bu sürümde tuvalde gösterme yok.')
    if (args.close === true) {
      const answer = await show({ branchId: '', branchName: '' }, { timeoutMs: 10_000 })
      if (!answer.ok) return failed(branchShow.name, `İnceleme kapatılamadı: ${answer.error ?? 'pencere yanıt vermedi'}`)
      const message = 'İnceleme kapatıldı; tuval kendi hâline döndü. Akışa hiçbir şey yazılmadı.'
      ctx.log('info', `Ajan · branch · ${message}`)
      return { ok: true, tool: branchShow.name, outcome: 'tamam', message, observed: { note: 'Yalnız görünüm değişti.' }, data: { shown: false } }
    }
    const id = text(args.branchId)
    const book = ctx.getCanvases()
    const branch = findBranch(book, id)
    if (!branch) return failed(branchShow.name, `Branch bulunamadı: ${id || '(boş)'}.`)
    const answer = await show({ branchId: branch.id, branchName: branch.name }, { timeoutMs: 10_000 })
    if (!answer.ok) {
      const message = `“${branch.name}” tuvalde gösterilemedi: ${answer.error ?? 'pencere yanıt vermedi'}. Tuval olduğu gibi kaldı.`
      ctx.log('warn', `Ajan · branch · ${message}`)
      return failed(branchShow.name, message)
    }
    const view = viewBranch(book, branch)
    const message = `“${branch.name}” tuvalde gösterildi (İncele gibi): ${view.diff?.summary ?? '—'}${view.path ? ` · alternatif yol: ${view.path.entry.nodeId} → ${view.path.exit.nodeId}` : ''}. Kesikli işaretler öneridir; akışa hiçbir şey yazılmadı.`
    ctx.log('info', `Ajan · branch · ${message}`)
    return {
      ok: true,
      tool: branchShow.name,
      outcome: 'tamam',
      message,
      observed: { note: 'Pencere öneriyi gösteriyor; tuvalin kendisi ve kayıtlı akış değişmedi.' },
      data: { shown: true, branchId: branch.id, diff: view.diff, path: view.path, anchors: view.anchors },
    }
  },
}

const runStop: ToolDef = {
  name: 'run.stop',
  summary: 'Çalışan koşuyu durdurur.',
  sendsInput: false,
  ready: true,
  run: async (_args, ctx) => {
    // Ölçüldü: koşu yokken "durdurma istendi" demek yanıltıcıydı — run.state "Şu an koşu yok"
    // derken bu araç durdurma istendi diye raporluyordu. Doğrusu: koşu varsa istek iletildi, yoksa
    // hiçbir koşunun durdurulmadığı açıkça söylenir (istek yine kaydedilir, bir sonraki koşu onu
    // beginRun ile temizler).
    const kosuyor = ctx.isRunning()
    ctx.requestStop()
    // Said out loud so a stop by the person is never read as a debug failure or a finished region.
    noteUserStop()
    const message = kosuyor
      ? 'Durdurma istendi; koşu bir sonraki adımın başında durur.'
      : 'Şu an koşu yok; durdurulacak bir koşu bulunmadı. İstek yine de kaydedildi (bir sonraki koşu temiz başlar).'
    ctx.log(kosuyor ? 'warn' : 'info', `Ajan · durdur · ${message}`)
    return { ok: true, tool: runStop.name, outcome: 'tamam', message, observed: { note: kosuyor ? 'Koşu sürüyordu.' : 'Koşu yoktu.' } }
  },
}

const runState: ToolDef = {
  name: 'run.state',
  summary: 'Koşunun hangi node’da, hangi kutuda, hangi öğede olduğunu söyler.',
  sendsInput: false,
  ready: true,
  run: async (_args, ctx) => {
    const s = snapshot()
    const running = ctx.isRunning()
    const chain = s.loops.map((l) => `${l.title}${typeof l.index === 'number' ? ` ${l.index + 1}/${l.total}` : ''}${l.item ? ` (“${l.item}”)` : ''}`)
    const parts: string[] = []
    if (s.probing) parts.push(`Tek adım sürüyor: “${s.nodeTitle ?? s.nodeId ?? '—'}”.`)
    else if (running) parts.push(`Koşu sürüyor${s.runId ? ` (${s.runId})` : ''}: “${s.nodeTitle ?? s.nodeId ?? '—'}”.`)
    else parts.push('Şu an koşu yok.')
    if (chain.length) parts.push(`Kutular: ${chain.join(' › ')}.`)
    if (s.packagePath.length) parts.push(`Paket: ${s.packagePath.length} katman derinde.`)
    if (s.observed.done || s.observed.errors) parts.push(`Gözlenen adımlar: ${s.observed.done} tamam, ${s.observed.errors} hata.`)
    if (ctx.userStop()) parts.push('Durdurma isteği açık.')
    if (s.lastError) parts.push(`Son hata: ${s.lastError}`)
    if (!running && !s.probing && s.last) {
      const l = s.last
      const how = l.stopped ? 'kullanıcı durdurdu' : l.error ? `hata: ${l.error}` : l.ok ? 'tamamlandı' : 'hata ile bitti'
      const secs = Math.max(0, Math.round((l.endedAt - l.startedAt) / 1000))
      parts.push(`Son koşu (${l.runId}): ${how} · ${l.steps ?? 0} adım · ${l.failed ? `${l.failed} hatalı öğe/tur` : 'hatalı öğe yok'} · ${secs} sn.`)
    }
    const message = parts.join(' ')
    if (running || s.probing) ctx.log('info', `Ajan · durum · ${message}`)
    return {
      ok: true,
      tool: runState.name,
      outcome: 'tamam',
      message,
      loop: s.loops.length ? s.loops[s.loops.length - 1] : undefined,
      loopChain: s.loops,
      data: {
        running,
        probing: s.probing,
        stopRequested: ctx.userStop(),
        runId: s.runId ?? null,
        nodeId: s.nodeId,
        nodeTitle: s.nodeTitle,
        packagePath: s.packagePath,
        observed: s.observed,
        last: s.last,
        lastError: s.lastError,
        startedAt: s.startedAt,
        ms: s.startedAt && running ? Date.now() - s.startedAt : undefined,
      },
    }
  },
}

/** Announced in the panel, refused with a clear reason until they are built. */
const planned: ToolDef[] = []

const TOOLS: ToolDef[] = [flowRead, flowContext, flowSuggest, branchCreate, branchList, branchDiff, branchShow, flowEdit, flowUndo, branchMerge, mergeUndo, branchDrop, actClick, actType, actKey, actWait, targetPreview, stepRun, runState, runReport, runWait, runStop, runFrom, screenRead, ...planned]

export function toolList(): ToolSpec[] {
  return TOOLS.map(({ name, summary, sendsInput, ready }) => ({ name, summary, sendsInput, ready }))
}

export async function callTool(name: string, args: unknown, ctx: ToolContext, source: ToolSource = 'agent'): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) return failed(name, `Bilinmeyen araç: ${name}`)
  if (!tool.ready || !tool.run) return failed(name, `“${tool.name}” henüz hazır değil: ${tool.summary}`)
  const input: Args = args && typeof args === 'object' ? { ...(args as Args) } : {}

  // An outside caller works on the saved flow. It cannot hand us a canvas: `run.from` stores
  // the graph it is given, so a caller-supplied one could replace the user's flow unseen.
  if (source === 'agent') delete input.graph

  // An outside caller has to earn the right to touch the desktop; the panel already has it.
  if (source === 'agent' && tool.sendsInput) {
    const mode = ctx.permission()
    if (mode === 'off') return failed(name, `“${tool.name}” için ajan izni kapalı. Ajan sekmesinden açabilirsin.`)
    if (mode === 'ask') {
      const what = typeof input.nodeId === 'string' ? ` (node ${input.nodeId})` : ''
      const approved = await ctx.askApproval(`${tool.summary}${what}`, tool.approvalNote ?? 'Ekrana tıklar ya da yazar.')
      if (!approved) {
        ctx.log('warn', `Ajan · ${name} · onay verilmedi.`)
        return { ok: false, tool: name, outcome: 'durduruldu', message: 'Bu çağrı için onay verilmedi (izin “Sor” ayarında; 2 dakika beklenir, sonra çağrı düşer).' }
      }
    }
  }

  try {
    return await tool.run(input, ctx, source)
  } catch (e) {
    const message = `Araç çalıştırılamadı: ${(e as Error).message}`
    ctx.log('error', `Ajan · ${name} · ${message}`)
    return failed(name, message)
  }
}
