import type { AgentGraph, AgentNode } from '../types'

export type HierarchyEntry = {
  key: string
  node: AgentNode
  packagePath: string[]
  children: HierarchyEntry[]
}

// Loop membership is stored in this graph; packages own a separate graph.
// Connections help order the list, but never determine whether a node is included.
export function canvasHierarchy(graph: AgentGraph, packagePath: string[] = []): HierarchyEntry[] {
  const nodes = new Map(graph.nodes.map(n => [n.id, n]))
  const owners = new Map<string, string>()
  const loops = graph.nodes.filter(n => n.kind === 'loop')
  for (const loop of loops) for (const id of loop.members ?? []) {
    if (id !== loop.id && nodes.has(id) && !owners.has(id)) owners.set(id, loop.id)
  }
  const forward = new Map<string, string[]>()
  const reverse = new Map<string, string[]>()
  for (const edge of graph.edges) {
    forward.set(edge.from, [...(forward.get(edge.from) ?? []), edge.to])
    reverse.set(edge.to, [...(reverse.get(edge.to) ?? []), edge.from])
  }
  const reachable = (seeds: string[], edges: Map<string, string[]>) => {
    const seen = new Set<string>(), pending = [...seeds]
    while (pending.length) {
      const id = pending.pop()!
      if (seen.has(id) || !nodes.has(id)) continue
      seen.add(id); pending.push(...(edges.get(id) ?? []))
    }
    return seen
  }
  // Also list nodes on a loop's return path when an older canvas has no explicit
  // frame membership. This is presentation only: the graph stays unchanged.
  const candidates = loops.map(loop => {
    const outward = reachable([loop.id, ...(loop.members ?? [])], forward)
    const returning = reachable([loop.id], reverse)
    return { loop, ids: [...outward].filter(id => returning.has(id)) }
  }).sort((a, b) => a.ids.length - b.ids.length)
  for (const { loop, ids } of candidates) for (const id of ids) {
    const node = nodes.get(id)!
    if (id !== loop.id && node.kind !== 'start' && node.kind !== 'loop' && !owners.has(id)) owners.set(id, loop.id)
  }
  const order: string[] = [], ranked = new Set<string>()
  const visit = (seed: string) => {
    const pending = [seed]
    while (pending.length) {
      const id = pending.pop()!
      if (ranked.has(id) || !nodes.has(id)) continue
      ranked.add(id); order.push(id)
      pending.push(...(forward.get(id) ?? []).slice().reverse())
    }
  }
  graph.nodes.filter(n => n.kind === 'start').forEach(n => visit(n.id))
  graph.nodes.forEach(n => visit(n.id))
  const emitted = new Set<string>()
  const build = (id: string): HierarchyEntry | null => {
    if (emitted.has(id)) return null
    emitted.add(id)
    const node = nodes.get(id)!
    const children = node.kind === 'package' && node.inner
      ? canvasHierarchy(node.inner, [...packagePath, id])
      : order.filter(child => owners.get(child) === id).map(build).filter((x): x is HierarchyEntry => !!x)
    return { key: JSON.stringify([...packagePath, id]), node, packagePath, children }
  }
  const entries = order.filter(id => !owners.has(id)).map(build).filter((x): x is HierarchyEntry => !!x)
  // Malformed/cyclic frame memberships must not hide any node.
  for (const id of order) { const entry = build(id); if (entry) entries.push(entry) }
  return entries
}

export function hierarchyTarget(root: AgentGraph, nodeId: string, packagePath: string[]) {
  let graph = root
  const stack: { parent: AgentGraph; id: string }[] = []
  for (const id of packagePath) {
    const pack = graph.nodes.find(n => n.id === id && n.kind === 'package')
    if (!pack?.inner) return null
    stack.push({ parent: graph, id }); graph = pack.inner
  }
  return graph.nodes.some(n => n.id === nodeId) ? { graph, stack } : null
}
