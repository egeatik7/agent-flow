import type { AgentGraph } from './graph-types'

/**
 * A live loop highlight and default cursor spelling are not document edits.
 *
 * A list the ENGINE derived is not a document edit either: when a box names a folder or a pattern,
 * the runner lists that folder and writes the found paths into the live canvas
 * (`runner.ts`: `patch(loop.id, { items: found })`). Those paths belong to the machine the flow ran
 * on, not to the flow. A box whose list the user typed by hand (no folder, no pattern) keeps its
 * rows: they are the user's own data, exactly like count mode.
 */
export function canvasContent(graph: AgentGraph): AgentGraph {
  return { ...graph, nodes: graph.nodes.map(node => {
    const { loopIndex: _live, templated: _templated, ...content } = node
    if (content.startIndex === 0) delete content.startIndex
    const derived = node.kind === 'loop' && (!!content.folder?.trim() || !!content.pattern?.trim())
    if (derived) delete content.items
    return { ...content, ...(node.inner ? { inner: canvasContent(node.inner) } : {}) }
  }) }
}
export const sameCanvasContent = (a: AgentGraph, b: AgentGraph) => JSON.stringify(canvasContent(a)) === JSON.stringify(canvasContent(b))
