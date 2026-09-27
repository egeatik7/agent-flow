import { allMembers, ancestors, frameRect, loopAt, ownerOf } from '../../electron/groups'
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

export { allMembers, frameRect, loopAt, ownerOf }

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

function withMember(graph: AgentGraph, loopId: string | undefined, id: string): AgentGraph {
  if (!loopId) return graph
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === loopId ? { ...n, members: [...(n.members ?? []).filter((m) => m !== id), id] } : n)),
  }
}

export function addAt(graph: AgentGraph, kind: NodeKind, x: number, y: number): { graph: AgentGraph; id: string } {
  const node = createNode(kind, Math.max(0, x), Math.max(0, y), nextIndex(graph, kind))
  const box = kind === 'start' ? undefined : loopAt(graph, x, y)
  const next = withMember({ ...graph, nodes: [...graph.nodes, node] }, box?.id, node.id)
  return { graph: next, id: node.id }
}

/** Adds a node after `fromId`'s `port`; if that port already pointed somewhere, the new node is inserted in between. It joins the same box as `fromId`. */
export function addAfter(
  graph: AgentGraph,
  fromId: string,
  port: string,
  kind: NodeKind
): { graph: AgentGraph; id: string } {
  const from = graph.nodes.find((n) => n.id === fromId)
  if (!from) return addAt(graph, kind, 60, 60)
  const existing = graph.edges.find((e) => e.from === fromId && e.fromPort === port)

  let x: number
  let y: number
  if (from.kind === 'loop') {
    const r = frameRect(graph, from)
    x = r.x + r.w + GAP_X
    y = r.y + (port === 'error' ? r.h + 30 : 0)
  } else {
    const portIdx = Math.max(0, NODE_SPECS[from.kind].outputs.findIndex((o) => o.key === port))
    x = from.x + NODE_W + GAP_X
    y = from.y + portIdx * (nodeHeight(from.kind) + 30)
  }
  const occupied = (px: number, py: number) =>
    graph.nodes.some((n) => n.kind !== 'loop' && Math.abs(n.x - px) < NODE_W - 20 && Math.abs(n.y - py) < 90)
  let guard = 0
  while (occupied(x, y) && guard++ < 20) y += 120

  const node = createNode(kind, x, y, nextIndex(graph, kind))
  let next: AgentGraph = { ...graph, nodes: [...graph.nodes, node] }
  next = withMember(next, ownerOf(graph, from.id)?.id, node.id)
  next = connect(next, fromId, port, node.id)
  const firstOut = NODE_SPECS[kind].outputs[0]
  if (existing && firstOut && existing.to !== node.id) {
    next = connect(next, node.id, firstOut.key, existing.to)
  }
  return { graph: next, id: node.id }
}

/** Deleting a box keeps what was inside it, one level up. */
export function removeNode(graph: AgentGraph, id: string): AgentGraph {
  const node = graph.nodes.find((n) => n.id === id)
  const parent = ownerOf(graph, id)
  const orphans = node?.kind === 'loop' ? node.members ?? [] : []
  return {
    nodes: graph.nodes
      .filter((n) => n.id !== id)
      .map((n) => {
        if (n.kind !== 'loop' || !n.members) return n
        let members = n.members.filter((m) => m !== id)
        if (parent && n.id === parent.id) members = [...members, ...orphans]
        return members.length === n.members.length && !(parent && n.id === parent.id) ? n : { ...n, members }
      }),
    edges: graph.edges.filter((e) => e.from !== id && e.to !== id),
  }
}

export function duplicateNode(graph: AgentGraph, id: string): { graph: AgentGraph; id: string } | null {
  const n = graph.nodes.find((x) => x.id === id)
  if (!n || n.kind === 'start') return null
  const copy: AgentNode = {
    ...n,
    id: newId(),
    title: `${n.title} (kopya)`,
    x: n.x + 30,
    y: n.y + 30,
    memory: undefined,
    trace: undefined,
    ...(n.kind === 'loop' ? { members: [], results: undefined, loopIndex: 0 } : {}),
  }
  const next = withMember({ ...graph, nodes: [...graph.nodes, copy] }, ownerOf(graph, id)?.id, copy.id)
  return { graph: next, id: copy.id }
}

/** Moves nodes into a box (or out of every box when `loopId` is null). A box cannot go inside itself. */
export function setMembership(graph: AgentGraph, ids: string[], loopId: string | null): AgentGraph {
  const blocked = new Set<string>()
  if (loopId) {
    blocked.add(loopId)
    for (const a of ancestors(graph, loopId)) blocked.add(a.id)
  }
  const move = ids.filter((id) => {
    const n = graph.nodes.find((x) => x.id === id)
    return n && n.kind !== 'start' && !blocked.has(id) && (ownerOf(graph, id)?.id ?? null) !== loopId
  })
  if (!move.length) return graph
  const set = new Set(move)
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (n.kind !== 'loop') return n
      let members = (n.members ?? []).filter((m) => !set.has(m))
      if (n.id === loopId) members = [...members, ...move]
      return { ...n, members }
    }),
  }
}

/** Puts the selected nodes into a new box and routes the chain through the box. */
export function wrapInLoop(graph: AgentGraph, ids: string[]): { graph: AgentGraph; id: string } | null {
  const sel = new Set(ids.filter((id) => graph.nodes.find((n) => n.id === id && n.kind !== 'start')))
  const top = [...sel].filter((id) => !ancestors(graph, id).some((a) => sel.has(a.id)))
  if (!top.length) return null
  const inside = new Set<string>(top)
  for (const id of top) for (const m of allMembers(graph, id)) inside.add(m)
  const nodes = graph.nodes.filter((n) => top.includes(n.id))
  const owners = new Set(top.map((id) => ownerOf(graph, id)?.id ?? ''))
  const parent = owners.size === 1 ? [...owners][0] || undefined : undefined

  const rects = nodes.map((n) => (n.kind === 'loop' ? frameRect(graph, n) : { x: n.x, y: n.y, w: NODE_W, h: nodeHeight(n.kind) }))
  const loop = createNode('loop', Math.min(...rects.map((r) => r.x)) - 24, Math.min(...rects.map((r) => r.y)) - 52, nextIndex(graph, 'loop'))
  loop.members = top

  let edges = graph.edges.map((e) => (!inside.has(e.from) && inside.has(e.to) ? { ...e, to: loop.id } : e))
  const leaving = edges.filter((e) => inside.has(e.from) && !inside.has(e.to) && e.to !== loop.id)
  if (leaving.length) {
    const exit = leaving[0]
    edges = edges.filter((e) => e.id !== exit.id)
    edges.push({ id: newId(), from: loop.id, fromPort: 'done', to: exit.to })
  }
  const incoming = edges.filter((e) => e.to === loop.id)
  if (incoming.length > 1) {
    const keep = incoming[0].id
    edges = edges.filter((e) => e.to !== loop.id || e.id === keep || !inside.has(e.from))
  }
  let next: AgentGraph = {
    nodes: [...graph.nodes.map((n) => (n.kind === 'loop' && n.members ? { ...n, members: n.members.filter((m) => !top.includes(m)) } : n)), loop],
    edges,
  }
  next = withMember(next, parent, loop.id)
  return { graph: next, id: loop.id }
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

/** Lays nodes out in columns by distance from the start node. */
export function autoLayout(graph: AgentGraph): AgentGraph {
  const start = graph.nodes.find((n) => n.kind === 'start') ?? graph.nodes[0]
  if (!start) return graph
  const depth = new Map<string, number>([[start.id, 0]])
  const queue = [start.id]
  const firstIn = (loopId: string) => {
    const loop = graph.nodes.find((n) => n.id === loopId)
    const ids = new Set(loop?.members ?? [])
    const fed = new Set(graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => e.to))
    return (loop?.members ?? []).filter((m) => !fed.has(m))
  }
  while (queue.length) {
    const id = queue.shift()!
    const node = graph.nodes.find((n) => n.id === id)
    const outs = [...graph.edges.filter((x) => x.from === id).map((e) => e.to), ...(node?.kind === 'loop' ? firstIn(id) : [])]
    for (const to of outs) {
      if (!depth.has(to)) {
        depth.set(to, depth.get(id)! + 1)
        queue.push(to)
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
    return { ...n, x: 40 + d * (NODE_W + GAP_X), y: 60 + row * 200 }
  })
  return { ...graph, nodes }
}
