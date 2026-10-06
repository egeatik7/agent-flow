/**
 * Flow edits as a short list of operations.
 *
 * The same list is used three ways: to check what an agent intends before anything is written
 * (flow.suggest), to apply it to a branch, and to keep that branch as a small recipe instead of
 * a second copy of the whole flow. Nothing here touches Electron, the store or the engine: it is
 * a pure transformation of a graph, so it can be tested on its own.
 *
 * Two limits are on purpose:
 *   - Only the root graph is edited. A package's inner flow is a separate editing context.
 *   - An edit may change what a step is *told to do*, never which element it is *aimed at*:
 *     locator, icon, memory, anchor, path and trace are not in the writable list.
 *
 * One rule comes from the engine itself: the runner follows the *first* edge of a port
 * (`edges.find`), so a second edge on the same port would silently never run. Such a connection
 * is refused instead of written, and a change that closes a ring is allowed but reported.
 */
import {
  createNode,
  NODE_SPECS,
  NODE_W,
  type AgentEdge,
  type AgentGraph,
  type AgentNode,
  type ClickMode,
  type NodeKind,
} from './graph-types'

/** Fields an edit may write. Target evidence and run state are deliberately absent. */
export const EDITABLE_FIELDS = [
  'title',
  'prompt',
  'text',
  'keys',
  'ms',
  'count',
  'timeoutMs',
  'pressEnter',
  'clearFirst',
  'clickMode',
  'folder',
  'items',
  'url',
  'pattern',
  'maxActions',
  'engine',
  'x',
  'y',
] as const

/** Kinds an edit may add. Başlangıç, Paket and Kutu change the shape of a flow and stay out. */
export const ADDABLE_KINDS: NodeKind[] = ['click', 'type', 'key', 'wait', 'condition', 'probe', 'ai', 'end']

export const MAX_OPS = 50

const CLICK_MODES: ClickMode[] = ['left', 'double', 'right']
const NUMBER_FIELDS = ['ms', 'count', 'timeoutMs', 'maxActions', 'x', 'y']
const BOOL_FIELDS = ['pressEnter', 'clearFirst']
const TEXT_FIELDS = ['title', 'prompt', 'text', 'keys', 'folder', 'url', 'pattern', 'engine']
/** Changing these says nothing about the meaning of the flow, so the stamp ignores them. */
const VOLATILE_KEYS = ['x', 'y', 'loopIndex', 'startIndex', 'templated', 'memory', 'trace', 'path']

export type EditOp =
  | {
      op: 'addNode'
      /** Name this node in later operations of the same list; the real id is made here. */
      key?: string
      kind: NodeKind
      fields?: Record<string, unknown>
      /** Attach the new node to this node's output (an id, or a key from this list). */
      connectFrom?: string
      fromPort?: string
    }
  | { op: 'patchNode'; id: string; fields: Record<string, unknown> }
  | { op: 'connect'; from: string; to: string; fromPort?: string }
  | { op: 'disconnect'; from: string; fromPort?: string; to?: string }

export type PlannedAdd = { node: AgentNode; fromId?: string; fromPort?: string; key?: string }
export type PlannedPatch = { id: string; fields: Record<string, unknown> }
export type PlannedEdge = { from: string; fromPort: string; to: string }
export type PlannedCut = { from: string; fromPort: string; to?: string }
export type Plan = { adds: PlannedAdd[]; patches: PlannedPatch[]; edges: PlannedEdge[]; cuts: PlannedCut[] }

export type PlanCheck = { ok: boolean; errors: string[]; warnings: string[]; plan: Plan }
export type DiffNode = { id: string; kind: NodeKind; title: string; fields?: string[] }
export type GraphDiff = {
  addedNodes: DiffNode[]
  removedNodes: DiffNode[]
  changedNodes: DiffNode[]
  addedEdges: string[]
  removedEdges: string[]
  summary: string
}

function newId(): string {
  return `n${Math.random().toString(36).slice(2, 10)}`
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function short(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (Array.isArray(value)) return `${value.length} öğe`
  const text = typeof value === 'string' ? value : String(value)
  return text.length > 26 ? `${text.slice(0, 25)}…` : text
}

function portsOf(kind: NodeKind): string[] {
  return NODE_SPECS[kind].outputs.map((p) => p.key)
}

function labelOf(kind: NodeKind): string {
  return NODE_SPECS[kind].label
}

function titleOf(graph: AgentGraph, id: string): string {
  return graph.nodes.find((n) => n.id === id)?.title ?? id
}

/** The first problem with these fields, or null when they are all writable and well shaped. */
function fieldProblem(fields: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(fields)) {
    if (!(EDITABLE_FIELDS as readonly string[]).includes(key)) {
      return `“${key}” buradan değiştirilemez. Değiştirilebilenler: ${EDITABLE_FIELDS.join(', ')}.`
    }
    if (key === 'items') {
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) return '“items” bir yazı listesi olmalı.'
      continue
    }
    if (key === 'clickMode') {
      if (typeof value !== 'string' || !CLICK_MODES.includes(value as ClickMode)) {
        return `“clickMode” şunlardan biri olmalı: ${CLICK_MODES.join(', ')}.`
      }
      continue
    }
    if (NUMBER_FIELDS.includes(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `“${key}” bir sayı olmalı.`
      if (key !== 'x' && key !== 'y' && value < 0) return `“${key}” sıfırdan küçük olamaz.`
      continue
    }
    if (BOOL_FIELDS.includes(key)) {
      if (typeof value !== 'boolean') return `“${key}” doğru/yanlış olmalı.`
      continue
    }
    if (TEXT_FIELDS.includes(key)) {
      if (typeof value !== 'string') return `“${key}” yazı olmalı.`
      if (value.length > 20000) return `“${key}” çok uzun (${value.length} karakter).`
    }
  }
  return null
}

/** Where a new node goes when the caller did not say: right of the node it hangs off. */
function autoSpot(graph: AgentGraph, taken: { x: number; y: number }[], anchor: AgentNode | null): { x: number; y: number } {
  const base = anchor ?? graph.nodes.reduce<AgentNode | null>((far, n) => (!far || n.x > far.x ? n : far), null)
  const startX = base ? Math.round(base.x + NODE_W + 60) : 40
  const startY = base ? Math.round(base.y) : 40
  const busy = (spot: { x: number; y: number }): boolean =>
    graph.nodes.some((n) => Math.abs(n.x - spot.x) < NODE_W && Math.abs(n.y - spot.y) < 110) ||
    taken.some((t) => Math.abs(t.x - spot.x) < NODE_W && Math.abs(t.y - spot.y) < 110)
  let spot = { x: startX, y: startY }
  let guard = 0
  while (busy(spot) && guard < 60) {
    spot = { x: spot.x, y: spot.y + 110 }
    guard += 1
  }
  return spot
}

/**
 * Checks a list of operations against a graph and turns it into a plan: new nodes with their
 * ids already made, the real names behind keys, and the edges to write. Nothing is applied here.
 */
export function planOps(graph: AgentGraph, raw: unknown, idPrefix?: string): PlanCheck {
  const errors: string[] = []
  const warnings: string[] = []
  const plan: Plan = { adds: [], patches: [], edges: [], cuts: [] }
  if (!Array.isArray(raw)) return { ok: false, errors: ['“ops” bir liste olmalı.'], warnings, plan }
  const ops = raw as EditOp[]
  if (!ops.length) return { ok: false, errors: ['“ops” boş; yapılacak bir şey yok.'], warnings, plan }
  if (ops.length > MAX_OPS) {
    return { ok: false, errors: [`Tek seferde en fazla ${MAX_OPS} işlem yapılabilir (${ops.length} gönderildi).`], warnings, plan }
  }

  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const keyToId = new Map<string, string>()
  const planned = new Map<string, AgentNode>()
  let addedCount = 0
  const known = (ref: string): AgentNode | null => {
    const id = keyToId.get(ref) ?? ref
    return planned.get(id) ?? byId.get(id) ?? null
  }

  ops.forEach((op, index) => {
    const at = `işlem ${index + 1}`
    if (!isRecord(op)) {
      errors.push(`${at}: geçersiz işlem.`)
      return
    }
    const kind = op.op
    if (kind === 'addNode') {
      const newKind = op.kind
      if (!ADDABLE_KINDS.includes(newKind)) {
        errors.push(
          `${at}: “${String(newKind)}” türü buradan eklenemez. Eklenebilenler: ${ADDABLE_KINDS.map(labelOf).join(', ')}.`
        )
        return
      }
      const fields = isRecord(op.fields) ? op.fields : {}
      const problem = fieldProblem(fields)
      if (problem) {
        errors.push(`${at}: ${problem}`)
        return
      }
      const anchor = op.connectFrom ? known(op.connectFrom) : null
      if (op.connectFrom && !anchor) {
        errors.push(`${at}: bağlanacak node bulunamadı: ${op.connectFrom}.`)
        return
      }
      const port = op.fromPort ?? 'next'
      if (anchor && !portsOf(anchor.kind).includes(port)) {
        errors.push(`${at}: “${labelOf(anchor.kind)}” için “${port}” çıkışı yok (var: ${portsOf(anchor.kind).join(', ')}).`)
        return
      }
      const sameKind = graph.nodes.filter((n) => n.kind === newKind).length + plan.adds.filter((a) => a.node.kind === newKind).length
      const node = createNode(newKind, 0, 0, sameKind + 1)
      // A recipe is applied again on every look, so an added node needs the *same* id each time:
      // otherwise the id a caller just read would be gone by its next call. The prefix comes from
      // the group the edits belong to; a clash with the flow's own ids is stepped over.
      if (idPrefix) {
        addedCount += 1
        let candidate = `${idPrefix}-${addedCount}`
        let guard = 0
        while (byId.has(candidate) || planned.has(candidate)) {
          guard += 1
          candidate = `${idPrefix}-${addedCount}-${guard}`
        }
        node.id = candidate
      }
      Object.assign(node, fields)
      if (typeof fields.x !== 'number' || typeof fields.y !== 'number') {
        const spot = autoSpot(graph, plan.adds.map((a) => ({ x: a.node.x, y: a.node.y })), anchor)
        node.x = spot.x
        node.y = spot.y
      }
      plan.adds.push({ node, key: op.key, fromId: anchor?.id, fromPort: anchor ? port : undefined })
      planned.set(node.id, node)
      if (op.key) keyToId.set(op.key, node.id)
      // Seen in use: a typing step with no target writes only while the focus happens to sit in a
      // text field. That worked for the Run box and failed for Notepad, where the window in front
      // and the keyboard focus were not the same. Allowed, but said out loud.
      if (newKind === 'type' && !String(fields.prompt ?? '').trim()) {
        warnings.push(
          `“${node.title}” hedefsiz bir yazı adımı: motor yalnız odağı doğrulanmış bir alana yazar, odak kayarsa yazı gönderilmez. Mümkünse “prompt” ile hedefini yaz.`
        )
      }
      return
    }
    if (kind === 'patchNode') {
      const target = known(op.id)
      if (!target) {
        errors.push(`${at}: node bulunamadı: ${op.id}.`)
        return
      }
      const fields = isRecord(op.fields) ? op.fields : {}
      if (!Object.keys(fields).length) {
        errors.push(`${at}: değiştirilecek alan yok.`)
        return
      }
      const problem = fieldProblem(fields)
      if (problem) {
        errors.push(`${at}: ${problem}`)
        return
      }
      plan.patches.push({ id: target.id, fields })
      return
    }
    if (kind === 'connect') {
      const from = known(op.from)
      if (!from) {
        errors.push(`${at}: “from” node bulunamadı: ${op.from}.`)
        return
      }
      const to = known(op.to)
      if (!to) {
        errors.push(`${at}: “to” node bulunamadı: ${op.to}.`)
        return
      }
      if (from.id === to.id) {
        errors.push(`${at}: bir node kendine bağlanamaz.`)
        return
      }
      if (NODE_SPECS[to.kind].hasInput === false) {
        errors.push(`${at}: “${labelOf(to.kind)}” node’una bağlantı çekilemez; akış oraya dönmez.`)
        return
      }
      const port = op.fromPort ?? 'next'
      if (!portsOf(from.kind).includes(port)) {
        errors.push(`${at}: “${labelOf(from.kind)}” için “${port}” çıkışı yok (var: ${portsOf(from.kind).join(', ')}).`)
        return
      }
      const taken = graph.edges.find((e) => e.from === from.id && e.fromPort === port)
      if (taken) {
        // The runner follows the first edge of a port; a second one would never run.
        errors.push(
          `${at}: “${from.title}” node’unun “${port}” çıkışında zaten bir bağlantı var (“${titleOf(graph, taken.to)}”). Önce onu kaldır.`
        )
        return
      }
      if (plan.edges.some((e) => e.from === from.id && e.fromPort === port)) {
        errors.push(`${at}: aynı çıkışa bu listede ikinci bir bağlantı kuruluyor.`)
        return
      }
      plan.edges.push({ from: from.id, fromPort: port, to: to.id })
      return
    }
    if (kind === 'disconnect') {
      const from = known(op.from)
      if (!from) {
        errors.push(`${at}: “from” node bulunamadı: ${op.from}.`)
        return
      }
      const port = op.fromPort ?? 'next'
      if (!portsOf(from.kind).includes(port)) {
        errors.push(`${at}: “${labelOf(from.kind)}” için “${port}” çıkışı yok (var: ${portsOf(from.kind).join(', ')}).`)
        return
      }
      const to = op.to ? known(op.to)?.id ?? op.to : undefined
      const matches = graph.edges.filter((e) => e.from === from.id && e.fromPort === port && (!to || e.to === to))
      if (!matches.length) {
        errors.push(`${at}: “${from.title}” node’unun “${port}” çıkışında kaldırılacak bağlantı bulunamadı.`)
        return
      }
      plan.cuts.push({ from: from.id, fromPort: port, to })
      return
    }
    errors.push(`${at}: bilinmeyen işlem türü “${String((op as { op?: unknown }).op)}”.`)
  })

  // A ring is a legitimate thing to build by hand, but it is worth saying out loud: a run would
  // spin there until the step limit. Reported, never blocked.
  const edges: { from: string; to: string }[] = graph.edges
    .filter((e) => !plan.cuts.some((c) => c.from === e.from && c.fromPort === e.fromPort && (!c.to || c.to === e.to)))
    .filter((e) => !plan.edges.some((p) => p.from === e.from && p.fromPort === e.fromPort))
    .map((e) => ({ from: e.from, to: e.to }))
  for (const add of plan.adds) if (add.fromId) edges.push({ from: add.fromId, to: add.node.id })
  for (const edge of plan.edges) edges.push({ from: edge.from, to: edge.to })
  if (!errors.length) {
    const ring = findRing(edges)
    if (ring) warnings.push(`Bu işlemler bir halka oluşturuyor: ${ring} — koşu orada adım sınırına kadar döner.`)
  }

  return { ok: errors.length === 0, errors, warnings, plan }
}

/** The first ring the edge set closes, as a readable path, or null. */
function findRing(edges: { from: string; to: string }[]): string | null {
  const out = new Map<string, string[]>()
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to])
  const state = new Map<string, 0 | 1 | 2>()
  for (const start of out.keys()) {
    if (state.get(start)) continue
    const path: string[] = []
    const walk = (id: string): string | null => {
      if (state.get(id) === 1) {
        const at = path.indexOf(id)
        return [...path.slice(at), id].join(' → ')
      }
      if (state.get(id) === 2) return null
      state.set(id, 1)
      path.push(id)
      for (const next of out.get(id) ?? []) {
        const found = walk(next)
        if (found) return found
      }
      path.pop()
      state.set(id, 2)
      return null
    }
    const found = walk(start)
    if (found) return found
  }
  return null
}

/** Writes a checked plan into a copy of the graph. The graph it is given is not touched. */
export function applyPlan(graph: AgentGraph, plan: Plan): AgentGraph {
  const next = clone(graph)
  for (const add of plan.adds) next.nodes.push(clone(add.node))
  for (const patch of plan.patches) {
    const node = next.nodes.find((n) => n.id === patch.id)
    if (node) Object.assign(node, patch.fields)
  }
  if (plan.cuts.length) {
    next.edges = next.edges.filter(
      (e) => !plan.cuts.some((c) => c.from === e.from && c.fromPort === e.fromPort && (!c.to || c.to === e.to))
    )
  }
  for (const add of plan.adds) {
    if (add.fromId) next.edges.push({ id: newId(), from: add.fromId, fromPort: add.fromPort ?? 'next', to: add.node.id })
  }
  for (const edge of plan.edges) next.edges.push({ id: newId(), from: edge.from, fromPort: edge.fromPort, to: edge.to })
  return next
}

function edgeKey(edge: AgentEdge): string {
  return `${edge.from}|${edge.fromPort}|${edge.to}`
}

function nodeChanged(before: AgentNode, after: AgentNode): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changed: string[] = []
  for (const key of keys) {
    if (key === 'id') continue
    const a = JSON.stringify((before as Record<string, unknown>)[key])
    const b = JSON.stringify((after as Record<string, unknown>)[key])
    if (a !== b) changed.push(key)
  }
  return changed.sort()
}

/** What an edit did, node by node and edge by edge, in words. */
export function diffGraphs(before: AgentGraph, after: AgentGraph): GraphDiff {
  const beforeNodes = new Map(before.nodes.map((n) => [n.id, n]))
  const afterNodes = new Map(after.nodes.map((n) => [n.id, n]))
  const addedNodes: DiffNode[] = []
  const removedNodes: DiffNode[] = []
  const changedNodes: DiffNode[] = []
  for (const [id, node] of afterNodes) {
    if (!beforeNodes.has(id)) addedNodes.push({ id, kind: node.kind, title: node.title })
    else {
      const fields = nodeChanged(beforeNodes.get(id) as AgentNode, node)
      if (fields.length) changedNodes.push({ id, kind: node.kind, title: node.title, fields })
    }
  }
  for (const [id, node] of beforeNodes) {
    if (!afterNodes.has(id)) removedNodes.push({ id, kind: node.kind, title: node.title })
  }
  const beforeEdges = new Set(before.edges.map(edgeKey))
  const afterEdges = new Set(after.edges.map(edgeKey))
  const addedEdges = [...afterEdges].filter((k) => !beforeEdges.has(k)).sort()
  const removedEdges = [...beforeEdges].filter((k) => !afterEdges.has(k)).sort()
  const parts: string[] = []
  if (addedNodes.length) parts.push(`${addedNodes.length} node eklendi`)
  if (changedNodes.length) parts.push(`${changedNodes.length} node değişti`)
  if (removedNodes.length) parts.push(`${removedNodes.length} node silindi`)
  if (addedEdges.length) parts.push(`${addedEdges.length} bağlantı kuruldu`)
  if (removedEdges.length) parts.push(`${removedEdges.length} bağlantı kaldırıldı`)
  return {
    addedNodes,
    removedNodes,
    changedNodes,
    addedEdges,
    removedEdges,
    summary: parts.length ? parts.join(', ') : 'değişiklik yok',
  }
}

/** One line per operation, for a person reading the log. */
export function describePlan(graph: AgentGraph, plan: Plan): string[] {
  const lines: string[] = []
  for (const add of plan.adds) {
    const fields = Object.entries(add.node)
      .filter(([k, v]) => (EDITABLE_FIELDS as readonly string[]).includes(k) && v !== undefined && v !== '')
      .map(([k, v]) => `${k}: ${short(v)}`)
    const where = add.fromId ? `, “${titleOf(graph, add.fromId)}” çıkışına bağlı` : ', bağlantısız'
    lines.push(`+ ${labelOf(add.node.kind)} eklendi: “${add.node.title}”${fields.length ? ` (${fields.join(' · ')})` : ''}${where}`)
  }
  for (const patch of plan.patches) {
    const before = graph.nodes.find((n) => n.id === patch.id)
    const bits = Object.entries(patch.fields).map(
      ([k, v]) => `${k}: “${short((before as Record<string, unknown> | undefined)?.[k])}” → “${short(v)}”`
    )
    lines.push(`~ “${before?.title ?? patch.id}” değişti: ${bits.join(' · ')}`)
  }
  for (const edge of plan.edges) {
    lines.push(`→ bağlantı: “${titleOf(graph, edge.from)}” · ${edge.fromPort} → “${titleOf(graph, edge.to)}”`)
  }
  for (const cut of plan.cuts) {
    const port = NODE_SPECS[graph.nodes.find((n) => n.id === cut.from)?.kind ?? 'click'].outputs.find((p) => p.key === cut.fromPort)
    lines.push(`✂ bağlantı kaldırıldı: “${titleOf(graph, cut.from)}” · ${port?.label ?? cut.fromPort}${cut.to ? ` → “${titleOf(graph, cut.to)}”` : ''}`)
  }
  return lines
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

function trimmedNode(node: AgentNode): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...(node as Record<string, unknown>) }
  for (const key of VOLATILE_KEYS) delete copy[key]
  return copy
}

/**
 * A fingerprint of what a flow *means*: kinds, commands, targets and edges. Moving a node around
 * or running a loop does not change it, so it can tell a branch whether its base still matches.
 */
export function graphStamp(graph: AgentGraph): string {
  const nodes = [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(trimmedNode)
  const edges = graph.edges
    .map((e) => ({ from: e.from, fromPort: e.fromPort, to: e.to }))
    .sort((a, b) => (edgeKey({ ...a, id: '' }) < edgeKey({ ...b, id: '' }) ? -1 : 1))
  const text = stableStringify({ nodes, edges })
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}
