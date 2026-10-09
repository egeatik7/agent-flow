import type { AgentGraph, StepStatus } from '../../electron/graph-types'
import { ancestors } from '../../electron/groups'

/** Transient display state. Never persisted into nodes or the saved canvas. */
export type RunProgress = {
  canvasId: string
  phase: 'idle' | 'running' | 'stopped'
  nodeId: string | null
  failedNodeId: string | null
  edges: ReadonlySet<string>
  trail: { id: string; from: string; to: string }[]
}

export function beginProgress(canvasId: string): RunProgress {
  return { canvasId, phase: 'running', nodeId: null, failedNodeId: null, edges: new Set(), trail: [] }
}

/** Leaf plus every containing loop/package; independent of the open package view. */
export function runNodePath(graph: AgentGraph, id: string): string[] {
  const node = graph.nodes.find(n => n.id === id)
  if (node) return [...ancestors(graph, id).reverse().map(n => n.id), id]
  for (const pkg of graph.nodes) {
    if (pkg.kind !== 'package' || !pkg.inner) continue
    const path = runNodePath(pkg.inner, id)
    if (path.length) return [...ancestors(graph, pkg.id).reverse().map(n => n.id), pkg.id, ...path]
  }
  return []
}

export function progressStep(progress: RunProgress, graph: AgentGraph, id: string, status: StepStatus): RunProgress {
  if (progress.phase !== 'running' || (status !== 'running' && status !== 'error')) return progress
  // A child failure also produces errors on its enclosing packages. Keep the
  // precise child location rather than replacing it with the outermost package.
  if (status === 'error' && progress.nodeId && id !== progress.nodeId && runNodePath(graph, progress.nodeId).includes(id)) return progress
  // Re-entering a node/box starts a new lap at that point. Its previously
  // executed successors are now future steps again, so discard that suffix.
  const incoming = progress.trail[progress.trail.length - 1]?.to === id
  const cut = status === 'running' && !incoming ? progress.trail.findIndex(edge => runNodePath(graph, edge.from).includes(id)) : -1
  const trail = cut < 0 ? progress.trail : progress.trail.slice(0, cut)
  const failedNodeId = status === 'error' ? id : progress.failedNodeId
  return { ...progress, nodeId: id, failedNodeId, trail, edges: cut < 0 ? progress.edges : new Set(trail.map(e => e.id)) }
}

export function progressEdge(progress: RunProgress, graph: AgentGraph, id: string, from: string, to: string): RunProgress {
  if (progress.phase !== 'running') return progress
  // Cut a prior lap BEFORE appending its new incoming connection. The next
  // running event must not erase the connection that just brought us here.
  const cut = progress.trail.findIndex(edge => runNodePath(graph, edge.from).includes(to))
  const trail = cut < 0 ? progress.trail : progress.trail.slice(0, cut)
  if (trail.some(edge => edge.id === id)) return progress
  const next = [...trail, { id, from, to }]
  return { ...progress, edges: new Set(next.map(edge => edge.id)), trail: next }
}

export function finishProgress(progress: RunProgress, stopped: boolean, failed = false): RunProgress {
  return { ...progress, phase: stopped ? 'stopped' : 'idle', nodeId: stopped && failed ? progress.failedNodeId ?? progress.nodeId : progress.nodeId }
}

/** Open only real package layers. Loop boxes live in their parent's graph. */
export function runNodeView(root: AgentGraph, id: string): { view: AgentGraph; stack: { parent: AgentGraph; id: string }[] } | null {
  if (root.nodes.some(n => n.id === id)) return { view: root, stack: [] }
  for (const pkg of root.nodes) {
    if (pkg.kind !== 'package' || !pkg.inner) continue
    const found = runNodeView(pkg.inner, id)
    if (found) return { view: found.view, stack: [{ parent: root, id: pkg.id }, ...found.stack] }
  }
  return null
}

export function visibleRunNodes(progress: RunProgress, root: AgentGraph, view: AgentGraph, canvasId: string): string[] {
  if (progress.phase === 'idle' || progress.canvasId !== canvasId || !progress.nodeId) return []
  const visible = new Set(view.nodes.map(n => n.id))
  return runNodePath(root, progress.nodeId).filter(id => visible.has(id))
}
