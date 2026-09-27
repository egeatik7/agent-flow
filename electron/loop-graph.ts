import type { AgentGraph } from './graph-types'

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

function deepest(graph: AgentGraph, head: string, candidates: string[], loopId: string): string {
  const dist = new Map<string, number>([[head, 0]])
  const q = [head]
  while (q.length) {
    const id = q.shift()!
    const d = dist.get(id)!
    for (const e of graph.edges) {
      if (e.from !== id || e.to === loopId || dist.has(e.to)) continue
      dist.set(e.to, d + 1)
      q.push(e.to)
    }
  }
  let best = candidates[0]
  let bestD = -1
  for (const id of candidates) {
    const d = dist.get(id) ?? -1
    if (d > bestD) {
      bestD = d
      best = id
    }
  }
  return best
}

/**
 * Where the group leaves when the rounds are over.
 * The head is the node “tekrar” points at (it has two inputs: the way in, and the way back).
 * The exit is the node just before that head — the one whose edge returns to it.
 * If that edge is the loop card’s own “tekrar”, the exit is the last step that feeds the card,
 * so the flow does not finish on the loop card.
 */
export function loopTail(graph: AgentGraph, loopId: string): string {
  const head = graph.edges.find((e) => e.from === loopId && e.fromPort === 'loop')?.to
  if (!head) return loopId
  const body = new Set(loopBody(graph, loopId))

  const toHead = graph.edges.filter((e) => e.to === head && e.from !== loopId && body.has(e.from))
  if (toHead.length === 1) return toHead[0].from
  if (toHead.length > 1) return deepest(graph, head, toHead.map((e) => e.from), loopId)

  const intoLoop = graph.edges.filter((e) => e.to === loopId && e.from !== loopId && body.has(e.from))
  if (intoLoop.length === 1) return intoLoop[0].from
  if (intoLoop.length > 1) return deepest(graph, head, intoLoop.map((e) => e.from), loopId)
  return loopId
}

/** “bitti” belongs on the group’s last node. Move an exit that was stored on the loop card or an older step. */
export function retargetLoopExits(graph: AgentGraph): AgentGraph {
  let edges = graph.edges.slice()
  let changed = false
  for (const loop of graph.nodes) {
    if (loop.kind !== 'loop') continue
    const tail = loopTail(graph, loop.id)
    const body = new Set(loopBody(graph, loop.id))
    body.add(loop.id)
    edges = edges.map((e) => {
      if (e.fromPort !== 'done' || e.from === tail) return e
      if (!body.has(e.from)) return e
      changed = true
      return { ...e, from: tail }
    })
  }
  if (!changed) return graph
  const seen = new Set<string>()
  edges = edges.filter((e) => {
    if (e.fromPort !== 'done') return true
    const key = `${e.from}:${e.fromPort}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { ...graph, edges }
}

/** The “bitti” edge for a loop, whether it is stored on the tail or still on the card. */
export function loopDoneEdge(graph: AgentGraph, loopId: string) {
  const tail = loopTail(graph, loopId)
  const body = new Set(loopBody(graph, loopId))
  body.add(loopId)
  return (
    graph.edges.find((e) => e.from === tail && e.fromPort === 'done') ??
    graph.edges.find((e) => e.fromPort === 'done' && body.has(e.from))
  )
}
