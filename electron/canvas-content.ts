import type { AgentGraph } from './graph-types'

/** A live loop highlight and default cursor spelling are not document edits. */
export function canvasContent(graph: AgentGraph): AgentGraph {
  return { ...graph, nodes: graph.nodes.map(node => {
    const { loopIndex: _live, templated: _templated, ...content } = node
    if (content.startIndex === 0) delete content.startIndex
    return { ...content, ...(node.inner ? { inner: canvasContent(node.inner) } : {}) }
  }) }
}
export const sameCanvasContent = (a: AgentGraph, b: AgentGraph) => JSON.stringify(canvasContent(a)) === JSON.stringify(canvasContent(b))
