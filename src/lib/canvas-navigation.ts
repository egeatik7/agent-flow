import type { AgentGraph, AgentNode } from '../types'

export type CanvasLocation = { path: string[]; nodeId?: string }
export type NavigationHistory = { entries: CanvasLocation[]; index: number }
export const emptyNavigation = (): NavigationHistory => ({ entries: [{ path: [] }], index: 0 })
const sameLocation = (a: CanvasLocation, b: CanvasLocation) => a.nodeId === b.nodeId && a.path.length === b.path.length && a.path.every((id, i) => id === b.path[i])
export function visitLocation(history: NavigationHistory, current: CanvasLocation, next: CanvasLocation): NavigationHistory {
  if (sameLocation(current, next)) return history
  const entries = history.entries.slice(0, history.index + 1)
  if (!sameLocation(entries[entries.length - 1], current)) entries.push(current)
  entries.push(next)
  return { entries, index: entries.length - 1 }
}
export function canvasView(root: AgentGraph, path: string[]) {
  let graph = root
  const stack: { parent: AgentGraph; id: string }[] = []
  for (const id of path) {
    const pack = graph.nodes.find(n => n.id === id && n.kind === 'package')
    if (!pack) return null
    stack.push({ parent: graph, id }); graph = pack.inner ?? { nodes: [], edges: [] }
  }
  return { graph, stack }
}
/** Every node in this package scope, once. Return edges and disconnected nodes
 * cannot hide entries; package contents belong to their own view. */
export function canvasNodes(graph: AgentGraph): AgentNode[] {
  const nodes = new Map(graph.nodes.map(n => [n.id, n]))
  const edges = new Map<string, string[]>()
  for (const edge of graph.edges) edges.set(edge.from, [...(edges.get(edge.from) ?? []), edge.to])
  const seen = new Set<string>(), result: AgentNode[] = []
  const walk = (seed: string) => {
    const pending = [seed]
    while (pending.length) {
      const id = pending.pop()!, node = nodes.get(id)
      if (!node || seen.has(id)) continue
      seen.add(id); result.push(node)
      const next = [...(node.kind === 'loop' ? node.members ?? [] : []), ...(edges.get(id) ?? [])]
      pending.push(...next.slice().reverse())
    }
  }
  graph.nodes.filter(n => n.kind === 'start').forEach(n => walk(n.id))
  graph.nodes.forEach(n => walk(n.id))
  return result
}
