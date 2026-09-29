import { ancestors } from './groups'
import {
  hasTemplate,
  itemVars,
  listItems,
  loopStartIndex,
  renderTemplate,
  type AgentGraph,
  type AgentNode,
} from './graph-types'

/** The graph whose own node list contains `nodeId`. */
function graphOf(root: AgentGraph, nodeId: string): AgentGraph | undefined {
  if (root.nodes.some((n) => n.id === nodeId)) return root
  for (const n of root.nodes) {
    if (n.kind === 'package' && n.inner) {
      const hit = graphOf(n.inner, nodeId)
      if (hit) return hit
    }
  }
  return undefined
}

/** The package whose inside directly holds `nodeId`. */
function shellPackage(root: AgentGraph, nodeId: string): AgentNode | undefined {
  for (const n of root.nodes) {
    if (n.kind !== 'package' || !n.inner) continue
    if (n.inner.nodes.some((x) => x.id === nodeId)) return n
    const deeper = shellPackage(n.inner, nodeId)
    if (deeper) return deeper
  }
  return undefined
}

/**
 * The Her Öğe İçin just outside `nodeId`.
 * A package is not a wall: a loop inside a package still sees the loop that holds the package.
 * A loop inside another loop stops at the nearer one.
 */
export function enclosingLoop(root: AgentGraph, nodeId: string, seen = new Set<string>()): AgentNode | undefined {
  if (seen.has(nodeId)) return undefined
  seen.add(nodeId)
  const home = graphOf(root, nodeId)
  if (!home) return undefined
  const near = ancestors(home, nodeId)[0]
  if (near) return near
  const shell = shellPackage(root, nodeId)
  if (!shell || shell.id === nodeId) return undefined
  return enclosingLoop(root, shell.id, seen)
}

/** Item variables of the loop outside `loopId`: its ticked row, or the lap a run is on. */
export function outsideVars(root: AgentGraph, loopId: string): Record<string, string> | null {
  const outer = enclosingLoop(root, loopId)
  if (!outer) return null
  const items = listItems(outer)
  if (items.length) {
    const i = loopStartIndex(outer, items.length, true)
    return itemVars(items[i], i, items.length)
  }
  const total = Math.max(1, outer.count ?? 1)
  const i = loopStartIndex(outer, total, true)
  return itemVars(String(i + 1), i, total)
}

/** Folder path for a loop whose address uses {{öğe}} from the loop outside it. Empty if it cannot be read. */
export function outsideFolder(root: AgentGraph, loop: AgentNode): string {
  const raw = loop.folder?.trim() ?? ''
  if (!raw || !hasTemplate(raw)) return ''
  const vars = outsideVars(root, loop.id)
  if (!vars) return ''
  const resolved = (renderTemplate(raw, vars) ?? '').trim()
  if (!resolved || hasTemplate(resolved)) return ''
  return resolved
}

function outsideDepth(root: AgentGraph, nodeId: string): number {
  let n = 0
  let cur = enclosingLoop(root, nodeId)
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    n++
    cur = enclosingLoop(root, cur.id)
  }
  return n
}

/** Loops whose folder is a template, outer boxes first. */
export function templateLoops(root: AgentGraph): AgentNode[] {
  const out: AgentNode[] = []
  const walk = (g: AgentGraph) => {
    for (const n of g.nodes) {
      if (n.kind === 'loop' && hasTemplate(n.folder)) out.push(n)
      if (n.kind === 'package' && n.inner) walk(n.inner)
    }
  }
  walk(root)
  return out.sort((a, b) => outsideDepth(root, a.id) - outsideDepth(root, b.id))
}
