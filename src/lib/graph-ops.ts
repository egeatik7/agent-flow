import {
  NODE_SPECS,
  NODE_W,
  createNode,
  newId,
  nodeHeight,
  type AgentGraph,
  type AgentNode,
  type NodeKind,
} from '../types'

const GAP_X = 70

export function nextIndex(graph: AgentGraph, kind: NodeKind): number {
  return graph.nodes.filter((n) => n.kind === kind).length + 1
}

export function connect(graph: AgentGraph, from: string, port: string, to: string): AgentGraph {
  if (from === to) return graph
  const target = graph.nodes.find((n) => n.id === to)
  if (!target || !NODE_SPECS[target.kind].hasInput) return graph
  const edges = graph.edges.filter((e) => !(e.from === from && e.fromPort === port))
  edges.push({ id: newId(), from, fromPort: port, to })
  return { ...graph, edges }
}

export function addAt(graph: AgentGraph, kind: NodeKind, x: number, y: number): { graph: AgentGraph; id: string } {
  const node = createNode(kind, Math.max(0, x), Math.max(0, y), nextIndex(graph, kind))
  return { graph: { ...graph, nodes: [...graph.nodes, node] }, id: node.id }
}

/** Adds a node after `fromId`'s `port`; if that port already pointed somewhere, the new node is inserted in between. */
export function addAfter(
  graph: AgentGraph,
  fromId: string,
  port: string,
  kind: NodeKind
): { graph: AgentGraph; id: string } {
  const from = graph.nodes.find((n) => n.id === fromId)
  if (!from) return addAt(graph, kind, 60, 60)
  const portIdx = Math.max(0, NODE_SPECS[from.kind].outputs.findIndex((o) => o.key === port))
  const existing = graph.edges.find((e) => e.from === fromId && e.fromPort === port)

  let x = from.x + NODE_W + GAP_X
  let y = from.y + portIdx * (nodeHeight(from.kind) + 30)
  const occupied = (px: number, py: number) =>
    graph.nodes.some((n) => Math.abs(n.x - px) < NODE_W - 20 && Math.abs(n.y - py) < 90)
  let guard = 0
  while (occupied(x, y) && guard++ < 20) y += 120

  const node = createNode(kind, x, y, nextIndex(graph, kind))
  let next: AgentGraph = { ...graph, nodes: [...graph.nodes, node] }
  next = connect(next, fromId, port, node.id)
  const firstOut = NODE_SPECS[kind].outputs[0]
  if (existing && firstOut && existing.to !== node.id) {
    next = connect(next, node.id, firstOut.key, existing.to)
  }
  return { graph: next, id: node.id }
}

export function removeNode(graph: AgentGraph, id: string): AgentGraph {
  return {
    nodes: graph.nodes.filter((n) => n.id !== id),
    edges: graph.edges.filter((e) => e.from !== id && e.to !== id),
  }
}

export function duplicateNode(graph: AgentGraph, id: string): { graph: AgentGraph; id: string } | null {
  const n = graph.nodes.find((x) => x.id === id)
  if (!n || n.kind === 'start') return null
  const copy: AgentNode = { ...n, id: newId(), title: `${n.title} (kopya)`, x: n.x + 30, y: n.y + 30 }
  return { graph: { ...graph, nodes: [...graph.nodes, copy] }, id: copy.id }
}

/** Follows the main path from the start node and returns the last node that has a free output. */
export function chainTail(graph: AgentGraph): { node: AgentNode; port: string } | null {
  const start = graph.nodes.find((n) => n.kind === 'start') ?? graph.nodes[0]
  if (!start) return null
  const seen = new Set<string>()
  let cur: AgentNode = start
  while (!seen.has(cur.id)) {
    seen.add(cur.id)
    const outs = NODE_SPECS[cur.kind].outputs
    if (outs.length === 0) return null
    const port = cur.kind === 'loop' ? 'done' : outs[0].key
    const edge = graph.edges.find((e) => e.from === cur.id && e.fromPort === port)
    if (!edge) return { node: cur, port }
    const nxt = graph.nodes.find((n) => n.id === edge.to)
    if (!nxt) return { node: cur, port }
    cur = nxt
  }
  return null
}

export function freePort(graph: AgentGraph, node: AgentNode): string | null {
  const outs = NODE_SPECS[node.kind].outputs
  if (outs.length === 0) return null
  const free = outs.find((o) => !graph.edges.some((e) => e.from === node.id && e.fromPort === o.key))
  return (free ?? outs[0]).key
}

/** Nodes on the cycle closed by a loop: reachable from its “tekrar” port and leading back to the loop. */
export function loopBody(graph: AgentGraph, loopId: string): string[] {
  const start = graph.edges.find((e) => e.from === loopId && e.fromPort === 'loop')?.to
  if (!start) return []
  const fwd = new Set<string>()
  const q = [start]
  while (q.length) {
    const id = q.shift()!
    if (id === loopId || fwd.has(id)) continue
    fwd.add(id)
    for (const e of graph.edges) if (e.from === id) q.push(e.to)
  }
  const back = new Set<string>()
  const q2 = [loopId]
  while (q2.length) {
    const id = q2.shift()!
    for (const e of graph.edges) {
      if (e.to === id && e.from !== loopId && !back.has(e.from)) {
        back.add(e.from)
        q2.push(e.from)
      }
    }
  }
  const body = [...fwd].filter((id) => back.has(id))
  if (start === loopId) return [loopId]
  return body.length ? [...body, loopId] : []
}

/** Lays nodes out in columns by distance from the start node. */
export function autoLayout(graph: AgentGraph): AgentGraph {
  const start = graph.nodes.find((n) => n.kind === 'start') ?? graph.nodes[0]
  if (!start) return graph
  const depth = new Map<string, number>([[start.id, 0]])
  const queue = [start.id]
  while (queue.length) {
    const id = queue.shift()!
    for (const e of graph.edges.filter((x) => x.from === id)) {
      if (!depth.has(e.to)) {
        depth.set(e.to, depth.get(id)! + 1)
        queue.push(e.to)
      }
    }
  }
  let maxD = Math.max(0, ...depth.values())
  for (const n of graph.nodes) if (!depth.has(n.id)) depth.set(n.id, ++maxD)
  const rows = new Map<number, number>()
  const nodes = graph.nodes.map((n) => {
    const d = depth.get(n.id)!
    const row = rows.get(d) ?? 0
    rows.set(d, row + 1)
    return { ...n, x: 40 + d * (NODE_W + GAP_X), y: 40 + row * 190 }
  })
  return { ...graph, nodes }
}
