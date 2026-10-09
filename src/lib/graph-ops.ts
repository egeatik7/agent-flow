import { allMembers, ancestors, frameRect, loopAt, ownerOf } from '../../electron/groups'
import {
  NODE_SPECS,
  NODE_W,
  createNode,
  newId,
  nodeHeight,
  nodeWidth,
  type AgentEdge,
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
    x = from.x + nodeWidth(from.kind) + GAP_X
    y = from.y + portIdx * (nodeHeight(from.kind) + 30)
  }
  const occupied = (px: number, py: number) =>
    graph.nodes.some((n) => n.kind !== 'loop' && Math.abs(n.x - px) < Math.max(nodeWidth(n.kind), nodeWidth(kind)) - 20 && Math.abs(n.y - py) < 90)
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
  const map = new Map<string, string>()
  assignFreshIds([n], map)
  const copy: AgentNode = {
    ...rewriteNode(cloneData(n), map, 30, 30, true),
    title: `${n.title} (kopya)`,
    x: n.x + 30,
    y: n.y + 30,
    memory: undefined,
    trace: undefined,
    ...(n.kind === 'loop' ? { members: [], loopIndex: 0 } : {}),
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

/** A node whose center lies inside a box becomes a member of that box. The innermost box wins. */
export function reconcileLoopMembership(graph: AgentGraph): AgentGraph {
  let current = graph
  let changed = false
  let guard = 0
  while (guard++ < 16) {
    let step = false
    for (const n of current.nodes) {
      if (n.kind === 'start') continue
      const exclude = new Set<string>()
      if (n.kind === 'loop') {
        exclude.add(n.id)
        for (const a of ancestors(current, n.id)) exclude.add(a.id)
      }
      const rect = n.kind === 'loop' ? frameRect(current, n) : { x: n.x, y: n.y, w: nodeWidth(n.kind), h: nodeHeight(n.kind) }
      const hit = loopAt(current, rect.x + rect.w / 2, rect.y + rect.h / 2, exclude)
      if (!hit || (ownerOf(current, n.id)?.id ?? null) === hit.id) continue
      const next = setMembership(current, [n.id], hit.id)
      if (next === current) continue
      current = next
      step = true
      changed = true
    }
    if (!step) break
  }
  let innerChanged = false
  const nodes = current.nodes.map((n) => {
    if (n.kind !== 'package' || !n.inner) return n
    const inner = reconcileLoopMembership(n.inner)
    if (inner === n.inner) return n
    innerChanged = true
    return { ...n, inner }
  })
  if (!innerChanged) return changed ? current : graph
  return { ...current, nodes }
}

/** Ajanı Çalıştır puts every box back on its first item. */
export function resetLoopTicks(graph: AgentGraph): AgentGraph {
  let changed = false
  const nodes = graph.nodes.map((n) => {
    let next = n
    if (n.kind === 'loop' && n.startIndex) {
      next = { ...next, startIndex: 0, loopIndex: undefined }
      changed = true
    }
    if (n.kind === 'package' && n.inner) {
      const inner = resetLoopTicks(n.inner)
      if (inner !== n.inner) {
        next = next === n ? { ...n, inner } : { ...next, inner }
        changed = true
      }
    }
    return next
  })
  return changed ? { ...graph, nodes } : graph
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

  const rects = nodes.map((n) => (n.kind === 'loop' ? frameRect(graph, n) : { x: n.x, y: n.y, w: nodeWidth(n.kind), h: nodeHeight(n.kind) }))
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

/** A loop is never split: touching it, or any node inside it, takes the box and every member. */
function closePackageSet(graph: AgentGraph, ids: string[]): Set<string> {
  const sel = new Set(ids.filter((id) => graph.nodes.some((n) => n.id === id)))
  let guard = 0
  let changed = true
  while (changed && guard++ < 24) {
    changed = false
    for (const n of graph.nodes) {
      if (n.kind !== 'loop') continue
      const members = allMembers(graph, n.id)
      if (!sel.has(n.id) && !members.some((id) => sel.has(id))) continue
      if (!sel.has(n.id)) {
        sel.add(n.id)
        changed = true
      }
      for (const m of members) {
        if (!sel.has(m)) {
          sel.add(m)
          changed = true
        }
      }
    }
  }
  return sel
}

function cloneGraph(g: AgentGraph): AgentGraph {
  return JSON.parse(JSON.stringify(g)) as AgentGraph
}

/** Replaces the selection with one Paket node. The inside keeps its own Başlangıç and runs through to its end. */
export function packageSelection(graph: AgentGraph, ids: string[]): { graph: AgentGraph; id: string; absorbed: boolean } | null {
  const sel = closePackageSet(graph, ids)
  if (!sel.size) return null
  const chosen = graph.nodes.filter((n) => sel.has(n.id))
  const innerNodes = chosen.map((n) => {
    const copy: AgentNode = n.kind === 'loop' ? { ...n, members: (n.members ?? []).filter((m) => sel.has(m)) } : { ...n }
    delete copy.loopIndex
    return copy
  })
  const innerEdges = graph.edges.filter((e) => sel.has(e.from) && sel.has(e.to)).map((e) => ({ ...e }))
  const incoming = graph.edges.filter((e) => !sel.has(e.from) && sel.has(e.to))
  const leaving = graph.edges.filter((e) => sel.has(e.from) && !sel.has(e.to))
  // A one-exit package cannot preserve multiple external branches/entries.
  // Reject the selection rather than silently changing its meaning.
  if (leaving.length > 1 || new Set(incoming.map((e) => e.to)).size > 1) return null

  if (!innerNodes.some((n) => n.kind === 'start')) {
    const fromOutside = [...new Set(incoming.map((e) => e.to))]
    let entry = fromOutside.length === 1 ? fromOutside[0] : null
    if (!entry) {
      const targeted = new Set(innerEdges.map((e) => e.to))
      const heads = innerNodes.filter((n) => !targeted.has(n.id) && n.kind !== 'loop')
      const loopHeads = innerNodes.filter((n) => !targeted.has(n.id) && n.kind === 'loop')
      entry = (heads[0] ?? loopHeads[0])?.id ?? null
    }
    const entryNode = entry ? innerNodes.find((n) => n.id === entry) : undefined
    if (entry && entryNode) {
      const start = createNode('start', Math.max(0, entryNode.x - NODE_W - 80), entryNode.y)
      innerNodes.unshift(start)
      innerEdges.unshift({ id: newId(), from: start.id, fromPort: 'next', to: entry })
    }
  }

  const rects = chosen.map((n) => (n.kind === 'loop' ? frameRect(graph, n) : { x: n.x, y: n.y, w: nodeWidth(n.kind), h: nodeHeight(n.kind) }))
  const pkg = createNode(
    'package',
    Math.max(0, Math.min(...rects.map((r) => r.x))),
    Math.max(0, Math.min(...rects.map((r) => r.y))),
    nextIndex(graph, 'package')
  )
  pkg.inner = cloneGraph({ nodes: innerNodes, edges: innerEdges })

  let edges = graph.edges.filter((e) => !sel.has(e.from) && !sel.has(e.to)).map((e) => ({ ...e }))
  for (const e of incoming) edges.push({ ...e, to: pkg.id })
  if (leaving.length) {
    const exit = leaving.find((e) => e.fromPort === 'next' || e.fromPort === 'done' || e.fromPort === 'true' || e.fromPort === 'found') ?? leaving[0]
    pkg.packageExit = { from: exit.from, fromPort: exit.fromPort }
    edges.push({ id: newId(), from: pkg.id, fromPort: 'next', to: exit.to })
  }

  const owners = new Set(chosen.map((n) => ownerOf(graph, n.id)?.id).filter((id): id is string => !!id && !sel.has(id)))
  const parent = owners.size === 1 ? [...owners][0] : undefined
  const nodes = graph.nodes
    .filter((n) => !sel.has(n.id))
    .map((n) => {
      if (n.kind !== 'loop' || !n.members) return n
      const members = n.members.filter((m) => !sel.has(m))
      return members.length === n.members.length ? n : { ...n, members }
    })
  nodes.push(pkg)
  let next: AgentGraph = { nodes, edges }
  next = withMember(next, parent, pkg.id)
  return { graph: next, id: pkg.id, absorbed: sel.size > ids.filter((id) => sel.has(id)).length }
}

/** Puts the package’s contents back on the canvas and removes the package. */
export function unpackPackage(graph: AgentGraph, id: string): AgentGraph | null {
  const pkg = graph.nodes.find((n) => n.id === id && n.kind === 'package')
  if (!pkg?.inner) return null
  const inner = pkg.inner
  const outerHasStart = graph.nodes.some((n) => n.kind === 'start')
  const innerStart = inner.nodes.find((n) => n.kind === 'start')
  const startEdge = innerStart ? inner.edges.find((e) => e.from === innerStart.id && e.fromPort === 'next') : undefined
  const dropStart = !!(innerStart && outerHasStart && startEdge && inner.nodes.filter((n) => n.kind === 'start').length === 1)
  const restored = inner.nodes.filter((n) => !dropStart || n.id !== innerStart?.id)
  const restoredIds = new Set(restored.map((n) => n.id))
  const entryId = dropStart ? startEdge?.to : innerStart?.id
  const outgoing = graph.edges.find((e) => e.from === id && e.fromPort === 'next')

  let edges = graph.edges.filter((e) => e.from !== id && e.to !== id).map((e) => ({ ...e }))
  for (const e of graph.edges.filter((e) => e.to === id)) {
    if (entryId && restoredIds.has(entryId)) edges.push({ ...e, to: entryId })
  }
  for (const e of inner.edges) {
    if (dropStart && innerStart && (e.from === innerStart.id || e.to === innerStart.id)) continue
    if (restoredIds.has(e.from) && restoredIds.has(e.to)) edges.push({ ...e })
  }
  if (pkg.packageExit && outgoing && restoredIds.has(pkg.packageExit.from)) {
    edges = edges.filter((e) => !(e.from === pkg.packageExit!.from && e.fromPort === pkg.packageExit!.fromPort))
    edges.push({ id: newId(), from: pkg.packageExit.from, fromPort: pkg.packageExit.fromPort, to: outgoing.to })
  }

  const tops = restored.filter((n) => !restored.some((l) => l.kind === 'loop' && (l.members ?? []).includes(n.id))).map((n) => n.id)
  const nodes = graph.nodes
    .filter((n) => n.id !== id)
    .map((n) => {
      if (n.kind !== 'loop' || !n.members?.includes(id)) return n
      return { ...n, members: [...n.members.filter((m) => m !== id), ...tops] }
    })
    .concat(restored)
  return { nodes, edges }
}

/** Applies `fn` to every node, including nodes hidden inside a package. */
export function mapNodes(graph: AgentGraph, fn: (n: AgentNode) => AgentNode): AgentGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const next = fn(n)
      if (next.kind === 'package' && next.inner) return { ...next, inner: mapNodes(next.inner, fn) }
      return next
    }),
  }
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
  const columnWidths = new Map<number, number>()
  for (const n of graph.nodes) {
    const d = depth.get(n.id)!
    columnWidths.set(d, Math.max(columnWidths.get(d) ?? NODE_W, nodeWidth(n.kind)))
  }
  const columnX = new Map<number, number>()
  let x = 40
  for (let d = 0; d <= maxD; d++) {
    columnX.set(d, x)
    x += (columnWidths.get(d) ?? NODE_W) + GAP_X
  }
  const rows = new Map<number, number>()
  const nodes = graph.nodes.map((n) => {
    const d = depth.get(n.id)!
    const row = rows.get(d) ?? 0
    rows.set(d, row + 1)
    return { ...n, x: columnX.get(d)!, y: 60 + row * 200 }
  })
  return { ...graph, nodes }
}

export type NodeClip = {
  nodes: AgentNode[]
  edges: Pick<AgentEdge, 'from' | 'fromPort' | 'to'>[]
}

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Nodes in the selection, plus edges whose both ends are selected. Edges that leave the selection are dropped. */
export function copyNodes(graph: AgentGraph, ids: string[]): NodeClip | null {
  const set = new Set(ids)
  const nodes = graph.nodes
    .filter((n) => set.has(n.id))
    .map((n) => {
      const copy = cloneData(n)
      if (copy.kind === 'loop') copy.members = (copy.members ?? []).filter((id) => set.has(id))
      copy.loopIndex = undefined
      return copy
    })
  if (!nodes.length) return null
  const edges = graph.edges
    .filter((e) => set.has(e.from) && set.has(e.to))
    .map((e) => ({ from: e.from, fromPort: e.fromPort, to: e.to }))
  return { nodes, edges }
}

function assignFreshIds(nodes: AgentNode[], map: Map<string, string>) {
  for (const n of nodes) {
    if (!map.has(n.id)) map.set(n.id, newId())
    if (n.inner) assignFreshIds(n.inner.nodes, map)
  }
}

function rewriteNode(n: AgentNode, map: Map<string, string>, dx: number, dy: number, shift: boolean): AgentNode {
  const next: AgentNode = {
    ...n,
    id: map.get(n.id) ?? n.id,
    x: shift ? Math.round(n.x + dx) : n.x,
    y: shift ? Math.round(n.y + dy) : n.y,
    members: n.members?.map((id) => map.get(id)).filter((id): id is string => !!id),
    packageExit: n.packageExit ? { ...n.packageExit, from: map.get(n.packageExit.from) ?? n.packageExit.from } : undefined,
    loopIndex: undefined,
  }
  if (n.inner) {
    next.inner = {
      nodes: n.inner.nodes.map((child) => rewriteNode(child, map, 0, 0, false)),
      edges: n.inner.edges
        .filter((e) => map.has(e.from) && map.has(e.to))
        .map((e) => ({ id: newId(), from: map.get(e.from)!, fromPort: e.fromPort, to: map.get(e.to)! })),
    }
  }
  return next
}

let pasteSerial = 0

/** Paste only the clip's own connections/membership. A present Başlangıç is
 * left out; an optional canvas point centres the visible bounds of the copy. */
export function pasteNodes(graph: AgentGraph, clip: NodeClip, center?: { x: number; y: number }): { graph: AgentGraph; ids: string[] } | null {
  const hasStart = graph.nodes.some((n) => n.kind === 'start')
  const nodes = clip.nodes.filter((n) => !(hasStart && n.kind === 'start'))
  if (!nodes.length) return null
  const map = new Map<string, string>()
  assignFreshIds(nodes, map)
  const minX = Math.min(...nodes.map((n) => n.x))
  const minY = Math.min(...nodes.map((n) => n.y))
  const bump = (pasteSerial % 8) * 28
  pasteSerial += 1
  let dx = 72 + bump - minX
  let dy = 72 + bump - minY
  if (center && Number.isFinite(center.x) && Number.isFinite(center.y)) {
    const clipGraph: AgentGraph = { nodes, edges: [] }
    const rects = nodes.map(n => n.kind === 'loop' ? frameRect(clipGraph, n) : { x: n.x, y: n.y, w: nodeWidth(n.kind), h: nodeHeight(n.kind) })
    const x1 = Math.min(...rects.map(r => r.x)), x2 = Math.max(...rects.map(r => r.x + r.w))
    const y1 = Math.min(...rects.map(r => r.y)), y2 = Math.max(...rects.map(r => r.y + r.h))
    dx = center.x - (x1 + x2) / 2
    dy = center.y - (y1 + y2) / 2
  }
  const created = nodes.map((n) => rewriteNode(n, map, dx, dy, true))
  const edges = clip.edges
    .filter((e) => map.has(e.from) && map.has(e.to))
    .map((e) => ({ id: newId(), from: map.get(e.from)!, fromPort: e.fromPort, to: map.get(e.to)! }))
  const next = { ...graph, nodes: [...graph.nodes, ...created], edges: [...graph.edges, ...edges] }
  return { graph: next, ids: created.map((n) => n.id) }
}
