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
import type { AgentGraph, CanvasBook, CanvasTab } from './graph-types'

export type BranchGroup = { id: string; at: number; note?: string; ops: EditOp[] }

export type BranchRecord = {
  id: string
  name: string
  baseTabId: string
  /** What the base looked like when the branch was made. */
  baseStamp: string
  createdAt: number
  /** One entry per edit call, so undo drops exactly one call's worth. */
  groups: BranchGroup[]
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

export function addGroup(branch: BranchRecord, ops: EditOp[], note?: string, id?: string): BranchGroup {
  const group: BranchGroup = { id: id ?? newGroupId(), at: Date.now(), ops, ...(note ? { note: String(note).slice(0, 200) } : {}) }
  branch.groups.push(group)
  if (branch.groups.length > MAX_GROUPS) branch.groups.splice(0, branch.groups.length - MAX_GROUPS)
  return group
}

export function undoLast(branch: BranchRecord): BranchGroup | null {
  return branch.groups.pop() ?? null
}

export function branchOps(branch: BranchRecord): EditOp[] {
  return branch.groups.flatMap((g) => g.ops)
}

export type Materialized = { graph: AgentGraph; applied: number; failed: string[] }

/**
 * Applies the recipe to the base, group by group: a group that no longer fits (its node was
 * deleted, its output was rewired) is named and skipped so the rest of the branch still shows.
 */
export function materialize(base: AgentGraph, branch: BranchRecord): Materialized {
  let graph = structuredClone(base)
  let applied = 0
  const failed: string[] = []
  for (const group of branch.groups) {
    const check = planOps(graph, group.ops, groupPrefix(group.id))
    if (!check.ok) {
      failed.push(`${group.note ?? group.id}: ${check.errors[0]}`)
      continue
    }
    graph = applyPlan(graph, check.plan)
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
    const check = planOps(graph, group.ops, groupPrefix(group.id))
    if (!check.ok) continue
    for (const patch of check.plan.patches) note(patch.id, 'alan değişiyor')
    for (const add of check.plan.adds) if (add.fromId) note(add.fromId, 'yeni adım buradan bağlanıyor')
    for (const edge of check.plan.edges) {
      note(edge.from, 'yeni bağlantı buradan çıkıyor')
      note(edge.to, 'yeni bağlantı buraya giriyor')
    }
    for (const cut of check.plan.cuts) note(cut.from, 'bağlantısı kaldırılıyor')
    graph = applyPlan(graph, check.plan)
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
  }
}

/** One line per edit, in order, for a person reading the log or the panel. */
export function describeBranch(baseGraph: AgentGraph, branch: BranchRecord): string[] {
  let graph = structuredClone(baseGraph)
  const lines: string[] = []
  for (const group of branch.groups) {
    const check = planOps(graph, group.ops, groupPrefix(group.id))
    if (!check.ok) {
      lines.push(`(bu grup artık uymuyor: ${check.errors[0]})`)
      continue
    }
    lines.push(...describePlan(graph, check.plan))
    graph = applyPlan(graph, check.plan)
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
