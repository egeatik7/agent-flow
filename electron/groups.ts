import { nodeWidth, nodeHeight, type AgentGraph, type AgentNode } from './graph-types'

export const FRAME_PAD = 24
export const FRAME_HEAD = 28
export const FRAME_BOTTOM = 26
export const EMPTY_FRAME = { w: 320, h: 150 }

export type Rect = { x: number; y: number; w: number; h: number }

/** The box that directly holds `id`, if any. */
export function ownerOf(graph: AgentGraph, id: string): AgentNode | undefined {
  return graph.nodes.find((n) => n.kind === 'loop' && (n.members ?? []).includes(id))
}

/** Every box above `id`, nearest first. */
export function ancestors(graph: AgentGraph, id: string): AgentNode[] {
  const out: AgentNode[] = []
  const seen = new Set<string>()
  let cur = ownerOf(graph, id)
  while (cur && !seen.has(cur.id)) {
    out.push(cur)
    seen.add(cur.id)
    cur = ownerOf(graph, cur.id)
  }
  return out
}

/** Members, and members of boxes inside it. */
export function allMembers(graph: AgentGraph, loopId: string): string[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const out: string[] = []
  const walk = (id: string, seen: Set<string>) => {
    const n = byId.get(id)
    for (const m of n?.members ?? []) {
      if (seen.has(m)) continue
      seen.add(m)
      out.push(m)
      if (byId.get(m)?.kind === 'loop') walk(m, seen)
    }
  }
  walk(loopId, new Set([loopId]))
  return out
}

/** Where each lap begins: the member no other member points at. Ties go to the leftmost, then the highest. */
export function firstMember(graph: AgentGraph, loop: AgentNode): AgentNode | undefined {
  const ids = new Set(loop.members ?? [])
  const members = graph.nodes.filter((n) => ids.has(n.id))
  if (!members.length) return undefined
  const fed = new Set(graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => e.to))
  const heads = members.filter((m) => !fed.has(m.id))
  const pool = heads.length ? heads : members
  return [...pool].sort((a, b) => a.x - b.x || a.y - b.y)[0]
}

function nodeRect(graph: AgentGraph, n: AgentNode, depth: number): Rect {
  if (n.kind === 'loop') return frameRect(graph, n, depth + 1)
  return { x: n.x, y: n.y, w: nodeWidth(n.kind), h: nodeHeight(n.kind) }
}

/** The box around its members; an empty box keeps its own size at its own spot. */
export function frameRect(graph: AgentGraph, loop: AgentNode, depth = 0): Rect {
  const ids = new Set(loop.members ?? [])
  const members = depth > 8 ? [] : graph.nodes.filter((n) => ids.has(n.id))
  if (!members.length) return { x: loop.x, y: loop.y, w: EMPTY_FRAME.w, h: EMPTY_FRAME.h }
  const rects = members.map((m) => nodeRect(graph, m, depth))
  const x1 = Math.min(...rects.map((r) => r.x)) - FRAME_PAD
  const y1 = Math.min(...rects.map((r) => r.y)) - FRAME_PAD - FRAME_HEAD
  const x2 = Math.max(...rects.map((r) => r.x + r.w)) + FRAME_PAD
  const y2 = Math.max(...rects.map((r) => r.y + r.h)) + FRAME_BOTTOM
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export function frameInput(graph: AgentGraph, loop: AgentNode) {
  const r = frameRect(graph, loop)
  return { x: r.x, y: r.y + FRAME_HEAD / 2 }
}

export function frameOutput(graph: AgentGraph, loop: AgentNode, port: string) {
  const r = frameRect(graph, loop)
  const idx = port === 'error' ? 1 : 0
  return { x: r.x + r.w, y: r.y + FRAME_HEAD + 18 + idx * 28 }
}

/** Innermost box whose frame contains the point. */
export function loopAt(graph: AgentGraph, x: number, y: number, exclude: Set<string> = new Set()): AgentNode | undefined {
  let best: { n: AgentNode; area: number } | undefined
  for (const n of graph.nodes) {
    if (n.kind !== 'loop' || exclude.has(n.id)) continue
    const r = frameRect(graph, n)
    if (x < r.x || y < r.y || x > r.x + r.w || y > r.y + r.h) continue
    const area = r.w * r.h
    if (!best || area < best.area) best = { n, area }
  }
  return best?.n
}
