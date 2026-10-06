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

function groupId(): string {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
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

export function addGroup(branch: BranchRecord, ops: EditOp[], note?: string): BranchGroup {
  const group: BranchGroup = { id: groupId(), at: Date.now(), ops, ...(note ? { note: String(note).slice(0, 200) } : {}) }
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
    const check = planOps(graph, group.ops)
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
}

/** Everything a caller needs to show, test or merge a branch. */
export function viewBranch(book: CanvasBook, branch: BranchRecord): BranchView {
  const base = baseTabOf(book, branch)
  if (!base) {
    return { branch, base: null, derived: null, diff: null, lines: [], applied: 0, failed: ['temel tuval bulunamadı'], baseChanged: false }
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
  }
}

/** One line per edit, in order, for a person reading the log or the panel. */
export function describeBranch(baseGraph: AgentGraph, branch: BranchRecord): string[] {
  let graph = structuredClone(baseGraph)
  const lines: string[] = []
  for (const group of branch.groups) {
    const check = planOps(graph, group.ops)
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
