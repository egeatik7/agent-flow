/**
 * Reading a flow for the tool layer.
 *
 * Finds a node anywhere in the canvas and resolves the box/package context around it. This
 * runs nothing and writes nothing: it only reuses the helpers the runner uses (loopKeys,
 * loopStartIndex, itemVars), so what a tool reports about a node cannot drift from what the
 * engine would do with the same node.
 */
import { itemVars, loopKeys, loopStartIndex, type AgentGraph, type AgentNode } from './graph-types'

export type NodePlace = {
  node: AgentNode
  /** Ids of the packages around the node, outermost first. */
  packagePath: string[]
  /** Her Öğe İçin boxes around the node, outermost first. */
  loops: AgentNode[]
}

export type LoopContext = {
  id: string
  title: string
  item?: string
  index?: number
  total?: number
  /** {{öğe}}, {{sıra}}, {{toplam}} resolved as the runner would, outer boxes included. */
  vars?: Record<string, string>
}

export type NodeContext = {
  packagePath: string[]
  loop?: LoopContext
}

/** The box a node is a direct member of. A node belongs to at most one box. */
function boxOwner(graph: AgentGraph): Map<string, AgentNode> {
  const owner = new Map<string, AgentNode>()
  for (const node of graph.nodes) {
    if (node.kind !== 'loop') continue
    for (const id of node.members ?? []) if (!owner.has(id)) owner.set(id, node)
  }
  return owner
}

/** Visits every node, inside packages too, with the boxes and packages around it. */
export function walkGraph(
  graph: AgentGraph,
  visit: (place: NodePlace) => void,
  packagePath: string[] = [],
  loops: AgentNode[] = []
): void {
  const owner = boxOwner(graph)
  for (const node of graph.nodes) {
    const box = owner.get(node.id)
    const chain = box ? [...loops, box] : loops
    visit({ node, packagePath, loops: chain })
    if (node.kind === 'package' && node.inner) walkGraph(node.inner, visit, [...packagePath, node.id], chain)
  }
}

export function findPlace(graph: AgentGraph, id: string): NodePlace | null {
  let found: NodePlace | null = null
  walkGraph(graph, (place) => {
    if (!found && place.node.id === id) found = place
  })
  return found
}

/** Every edge in the flow, packages included: the root alone can look empty. */
export function countEdges(graph: AgentGraph): number {
  let total = graph.edges.length
  for (const node of graph.nodes) {
    if (node.kind === 'package' && node.inner) total += countEdges(node.inner)
  }
  return total
}

/** Where the run would be if this node were reached now: the box, the item, and the values. */
export function contextOf(graph: AgentGraph, id: string): NodeContext | null {
  const place = findPlace(graph, id)
  if (!place) return null
  let vars: Record<string, string> = {}
  let loop: LoopContext | undefined
  for (const box of place.loops) {
    const keys = loopKeys(box)
    const index = loopStartIndex(box, keys.length, true)
    const item = keys[index]
    vars = { ...vars, ...itemVars(item ?? '', index, keys.length) }
    loop = { id: box.id, title: box.title, item, index, total: keys.length, vars: { ...vars } }
  }
  return { packagePath: place.packagePath, loop }
}
