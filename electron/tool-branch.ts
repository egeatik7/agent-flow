/**
 * Branches: a recipe, not a copy.
 *
 * A branch keeps the edits an agent wants to make to a canvas, not a second copy of the whole
 * flow. The graph is derived when it is actually needed (look at it, test it, merge it) by
 * applying the recipe to the canvas it was based on. So twenty branches cost a few kilobytes
 * instead of twenty flows, and a branch follows its base instead of freezing an old picture.
 *
 * The base can change under a branch, which is allowed on purpose: the derived graph simply
 * uses the new base, and `baseChanged` says so instead of hiding it. A group whose edits no
 * longer fit is reported by name and skipped; the rest still apply.
 *
 * Nothing here touches Electron, the store or the engine.
 */
import {
  applyPlan,
  describePlan,
  diffGraphs,
  graphStamp,
  planOps,
  type EditOp,
  type GraphDiff,
} from './tool-edit'
import { findPlace } from './tool-context'
import type { AgentGraph, AgentNode, CanvasBook, CanvasTab } from './graph-types'

export type BranchGroup = {
  id: string
  at: number
  note?: string
  ops: EditOp[]
  /**
   * The package this group edits, by node id from the root down. Absent means the flow itself.
   * An edit inside a package is still just a recipe; this says which level it belongs to.
   */
  target?: string[]
}

/**
 * Where an alternative path leaves the flow and where it comes back.
 *
 * A branch is a recipe, so nothing forces it to be a detour: it can also just add a step or change
 * a field. But when it *is* an alternative - "cut A→X, go through these nodes, come back at B" -
 * that has to be legible in the record itself, not only inferable from the ops. An agent reading
 * the file, or a person reading the JSON, should be able to see the shape at a glance.
 */
export type BranchPath = {
  /** The node the alternative leaves from, on the port named. */
  entry: { nodeId: string; port: string }
  /** The node it comes back to. */
  exit: { nodeId: string }
  /** How sure the tool layer is that this is what the recipe does. */
  source: 'declared' | 'derived'
}

export type BranchRecord = {
  id: string
  name: string
  baseTabId: string
  /** What the base looked like when the branch was made. */
  baseStamp: string
  createdAt: number
  /** One entry per edit call, so undo drops exactly one call's worth. */
  groups: BranchGroup[]
  /** The alternative's shape, when the recipe has one. Absent means "only edits, no detour". */
  path?: BranchPath
}

export const MAX_BRANCHES = 3
export const MAX_NAME = 48
export const MAX_GROUPS = 40

function branchId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function newGroupId(): string {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

/**
 * Ids of the nodes a group adds: derived from the group, so looking at a branch twice gives the
 * same graph. Without this a caller could not name a node it just saw in the difference.
 */
export function groupPrefix(groupId: string): string {
  return `nb${groupId}`
}

export function cleanName(name: unknown): string {
  const text = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : ''
  return (text || 'Ajan önerisi').slice(0, MAX_NAME)
}

export function isBranch(value: unknown): value is BranchRecord {
  const b = value as { id?: unknown; name?: unknown; baseTabId?: unknown; groups?: unknown } | null
  return !!b && typeof b.id === 'string' && typeof b.name === 'string' && typeof b.baseTabId === 'string' && Array.isArray(b.groups)
}

export function branchesOf(book: CanvasBook): BranchRecord[] {
  return (book.branches ?? []).filter(isBranch)
}

/**
 * The canvas book has two writers: the window saves the flows (tabs, active tab) and the tool
 * layer saves the branches. To keep one from dropping the other's work, each side only ever
 * writes its own half. These two functions are that rule, in one place, so it cannot drift.
 *
 * This is not theoretical: a branch was lost once because the window's save carried its own
 * copy of the book, which had never heard of the branch the agent had just opened.
 */
export function windowSave(written: CanvasBook, fromToolLayer: CanvasBook): CanvasBook {
  return { ...written, branches: fromToolLayer.branches ?? [] }
}

/** A tool-layer save writes branches and leaves the flows exactly as the window left them. */
export function toolLayerSave(current: CanvasBook, branches: unknown[]): CanvasBook {
  return { ...current, branches }
}

export function findBranch(book: CanvasBook, id: string): BranchRecord | null {
  return branchesOf(book).find((b) => b.id === id) ?? null
}

export function baseTabOf(book: CanvasBook, branch: BranchRecord): CanvasTab | null {
  return book.tabs.find((t) => t.id === branch.baseTabId) ?? null
}

/**
 * The stretch of the old flow between the alternative's entry and its exit, in base order.
 *
 * This is what the alternative is an alternative *to*: merging it means this stretch is replaced.
 */
export function bypassedNodes(base: AgentGraph, path: BranchPath): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let cur = path.entry.nodeId
  const target = path.exit.nodeId
  let guard = 0
  while (cur && guard++ < 500) {
    if (cur === target || seen.has(cur)) break
    seen.add(cur)
    const edge = base.edges.find((e) => e.from === cur && (cur === path.entry.nodeId ? e.fromPort === path.entry.port : true))
    if (!edge) break
    out.push(edge.to)
    cur = edge.to
  }
  return out
}

/**
 * What the merge should take away: the old stretch, minus anything the new flow can still reach.
 *
 * Reachable means safe: a node the flow can still get to (from a start, through a loop's members)
 * is not the alternative's business. What is left unreachable was only there for the old path, so
 * the merge removes it - except nodes that carry a package's or a box's contents: those are never
 * deleted by an agent, they are reported and left alone.
 */
export function pruneBypassed(
  derived: AgentGraph,
  base: AgentGraph,
  path: BranchPath
): { graph: AgentGraph; removed: string[]; keptBack: string[] } {
  const candidates = new Set(bypassedNodes(base, path))
  if (!candidates.size) return { graph: derived, removed: [], keptBack: [] }

  const reach = new Set<string>()
  const queue = derived.nodes.filter((n) => n.kind === 'start').map((n) => n.id)
  const byId = new Map(derived.nodes.map((n) => [n.id, n]))
  while (queue.length) {
    const id = queue.pop() as string
    if (reach.has(id)) continue
    reach.add(id)
    for (const e of derived.edges) if (e.from === id) queue.push(e.to)
    for (const m of byId.get(id)?.members ?? []) queue.push(m)
  }

  const keptBack: string[] = []
  const removed = [...candidates].filter((id) => {
    if (reach.has(id)) return false
    const node = byId.get(id)
    // A package or a box holds a whole flow inside it: report it, never delete it here.
    if (node && (node.members?.length || node.inner)) {
      keptBack.push(id)
      return false
    }
    return true
  })
  if (!removed.length) return { graph: derived, removed: [], keptBack }

  const drop = new Set(removed)
  return {
    graph: {
      nodes: derived.nodes
        .filter((n) => !drop.has(n.id))
        .map((n) => (n.members?.some((m) => drop.has(m)) ? { ...n, members: n.members.filter((m) => !drop.has(m)) } : n)),
      edges: derived.edges.filter((e) => !drop.has(e.from) && !drop.has(e.to)),
    },
    removed,
    keptBack,
  }
}

export function newBranch(base: CanvasTab, name: unknown): BranchRecord {
  return {
    id: branchId(),
    name: cleanName(name),
    baseTabId: base.id,
    baseStamp: graphStamp(base.graph),
    createdAt: Date.now(),
    groups: [],
  }
}

export function addGroup(branch: BranchRecord, ops: EditOp[], note?: string, id?: string, target?: string[]): BranchGroup {
  const group: BranchGroup = {
    id: id ?? newGroupId(),
    at: Date.now(),
    ops,
    ...(note ? { note: String(note).slice(0, 200) } : {}),
    ...(target?.length ? { target } : {}),
  }
  branch.groups.push(group)
  // No trimming here on purpose: a recipe is applied group by group, so dropping the oldest group
  // would silently delete the edits later ones stand on. The caller refuses instead when it is full.
  return group
}

export function undoLast(branch: BranchRecord): BranchGroup | null {
  return branch.groups.pop() ?? null
}

export function branchOps(branch: BranchRecord): EditOp[] {
  return branch.groups.flatMap((g) => g.ops)
}

/**
 * Reads the alternative's shape out of the recipe: an alternative leaves the flow where an edge is
 * cut and returns where the added chain points back into the base. Best effort on purpose - a
 * recipe with no cut and no return simply has no detour, and that is a valid branch too.
 */
export function derivePath(base: AgentGraph, branch: BranchRecord): BranchPath | null {
  const baseIds = new Set(base.nodes.map((n) => n.id))
  let graph = structuredClone(base)
  const added = new Set<string>()
  let entry: { nodeId: string; port: string } | null = null
  let exitId = ''
  for (const group of branch.groups) {
    // An alternative path is a shape of the flow itself. A group written inside a package is not
    // that shape, so it is skipped here rather than mistaken for a root-level cut.
    if (group.target?.length) continue
    const check = planOps(graph, group.ops, groupPrefix(group.id))
    if (!check.ok) continue
    for (const cut of check.plan.cuts) {
      // The first cut is where the alternative leaves the flow.
      if (!entry) entry = { nodeId: cut.from, port: cut.fromPort }
    }
    for (const add of check.plan.adds) added.add(add.node.id)
    for (const edge of check.plan.edges) {
      // An edge from an added node back into the base flow is where the alternative returns.
      if (added.has(edge.from) && baseIds.has(edge.to)) exitId = edge.to
    }
    graph = applyPlan(graph, check.plan)
  }
  if (!entry || !exitId) return null
  return { entry, exit: { nodeId: exitId }, source: 'derived' }
}

export type Materialized = { graph: AgentGraph; applied: number; failed: string[] }

/**
 * The graph a group's ops are written against: the whole flow, or the inside of a package.
 *
 * A package holds a flow of its own. Editing inside one has to address that inner graph, and the
 * group remembers which one it was written for - otherwise the same recipe would be applied to the
 * wrong level the moment it is looked at again.
 */
export function targetGraph(root: AgentGraph, target?: string[]): { graph: AgentGraph; title: string } | null {
  if (!target || !target.length) return { graph: root, title: '' }
  let nodes = root.nodes
  let found: AgentNode | null = null
  for (const id of target) {
    found = nodes.find((n) => n.id === id) ?? null
    if (!found) return null
    nodes = found.inner?.nodes ?? []
  }
  if (!found?.inner) return null
  return { graph: found.inner, title: found.title }
}

/** Writes a graph back where it belongs: the root, or the inside of the package named. */
function withGraphAt(root: AgentGraph, target: string[] | undefined, next: AgentGraph): AgentGraph {
  if (!target || !target.length) return next
  const [head, ...rest] = target
  const clone = structuredClone(root)
  const node = clone.nodes.find((n) => n.id === head)
  if (!node || !node.inner) return clone
  node.inner = rest.length ? withGraphAt(node.inner, rest, next) : next
  return clone
}

/**
 * Applies the recipe to the base, group by group: a group that no longer fits (its node was
 * deleted, its output was rewired) is named and skipped so the rest of the branch still shows.
 */
export function materialize(base: AgentGraph, branch: BranchRecord): Materialized {
  let graph = structuredClone(base)
  let applied = 0
  const failed: string[] = []
  for (const group of branch.groups) {
    const where = targetGraph(graph, group.target)
    if (!where) {
      failed.push(`${group.note ?? group.id}: hedef paket bulunamadı (${(group.target ?? []).join(' › ')})`)
      continue
    }
    const check = planOps(where.graph, group.ops, groupPrefix(group.id))
    if (!check.ok) {
      failed.push(`${group.note ?? group.id}: ${check.errors[0]}`)
      continue
    }
    const nextInner = applyPlan(where.graph, check.plan)
    graph = group.target?.length ? withGraphAt(graph, group.target, nextInner) : nextInner
    applied += group.ops.length
  }
  return { graph, applied, failed }
}

export type BranchView = {
  branch: BranchRecord
  base: CanvasTab | null
  derived: AgentGraph | null
  diff: GraphDiff | null
  lines: string[]
  applied: number
  failed: string[]
  /** The canvas this branch was based on is not what it was: the recipe is applied to the new one. */
  baseChanged: boolean
  /**
   * The nodes of the *base* flow that the recipe touches — where on the canvas this branch lives.
   * A node inside a package carries its package path, so a window can mark the package node
   * instead, which is what a person can actually find.
   */
  anchors: BranchAnchor[]
  /** The alternative's shape: where it leaves the flow and where it comes back. */
  path: BranchPath | null
}

export type BranchAnchor = { id: string; title: string; packagePath: string[]; how: string[] }

/** Every base node the recipe names, with what it does to it. */
export function anchorsOf(base: AgentGraph, branch: BranchRecord): BranchAnchor[] {
  let graph = structuredClone(base)
  const seen = new Map<string, BranchAnchor>()
  const note = (id: string, what: string) => {
    if (!id) return
    const place = findPlace(base, id)
    if (!place) return
    const found = seen.get(id)
    if (found) {
      if (!found.how.includes(what)) found.how.push(what)
      return
    }
    seen.set(id, { id, title: place.node.title, packagePath: place.packagePath, how: [what] })
  }
  for (const group of branch.groups) {
    const where = targetGraph(graph, group.target)
    if (!where) continue
    const check = planOps(where.graph, group.ops, groupPrefix(group.id))
    if (!check.ok) continue
    for (const patch of check.plan.patches) note(patch.id, 'alan değişiyor')
    for (const add of check.plan.adds) if (add.fromId) note(add.fromId, 'yeni adım buradan bağlanıyor')
    for (const edge of check.plan.edges) {
      note(edge.from, 'yeni bağlantı buradan çıkıyor')
      note(edge.to, 'yeni bağlantı buraya giriyor')
    }
    for (const cut of check.plan.cuts) note(cut.from, 'bağlantısı kaldırılıyor')
    const nextInner = applyPlan(where.graph, check.plan)
    graph = group.target?.length ? withGraphAt(graph, group.target, nextInner) : nextInner
  }
  return [...seen.values()]
}

/** Everything a caller needs to show, test or merge a branch. */
export function viewBranch(book: CanvasBook, branch: BranchRecord): BranchView {
  const base = baseTabOf(book, branch)
  if (!base) {
    return {
      branch,
      base: null,
      derived: null,
      diff: null,
      lines: [],
      applied: 0,
      failed: ['temel tuval bulunamadı'],
      baseChanged: false,
      anchors: [],
      path: null,
    }
  }
  const { graph, applied, failed } = materialize(base.graph, branch)
  return {
    branch,
    base,
    derived: graph,
    diff: diffGraphs(base.graph, graph),
    lines: describeBranch(base.graph, branch),
    applied,
    failed,
    baseChanged: graphStamp(base.graph) !== branch.baseStamp,
    anchors: anchorsOf(base.graph, branch),
    path: branch.path ?? derivePath(base.graph, branch),
  }
}

/** One line per edit, in order, for a person reading the log or the panel. */
export function describeBranch(baseGraph: AgentGraph, branch: BranchRecord): string[] {
  let graph = structuredClone(baseGraph)
  const lines: string[] = []
  for (const group of branch.groups) {
    const where = targetGraph(graph, group.target)
    if (!where) {
      lines.push(`(hedef paket bulunamadı: ${(group.target ?? []).join(' › ')})`)
      continue
    }
    const check = planOps(where.graph, group.ops, groupPrefix(group.id))
    if (!check.ok) {
      lines.push(`(bu grup artık uymuyor: ${check.errors[0]})`)
      continue
    }
    const prefix = where.title ? `[${where.title}] ` : ''
    lines.push(...describePlan(where.graph, check.plan).map((l) => prefix + l))
    const nextInner = applyPlan(where.graph, check.plan)
    graph = group.target?.length ? withGraphAt(graph, group.target, nextInner) : nextInner
  }
  return lines
}

/** A short line about a branch: what it changes and whether it still fits. */
export function summaryOf(view: BranchView): string {
  const { branch, diff, applied, failed, baseChanged } = view
  const size = `${branch.groups.length} düzenleme · ${branchOps(branch).length} işlem`
  const what = diff ? diff.summary : 'temel tuval yok'
  const notes = [size, what]
  if (baseChanged) notes.push('temel tuval değişmiş')
  if (failed.length) notes.push(`${failed.length} grup uymuyor`)
  if (!applied && branch.groups.length) notes.push('hiçbiri uygulanamadı')
  return notes.join(' · ')
}
