import { NODE_SPECS, summarize, type AgentGraph, type AgentNode } from '../types'

export type CanvasSearchHit = { nodeId: string; path: string[]; title: string; breadcrumb: string }
const fold = (text: string) => text.normalize('NFKC').toLocaleLowerCase('tr-TR')

/** Search user-facing fields, never IDs, cached targets, screenshots or execution traces. */
function searchable(node: AgentNode): string {
  return [node.title, NODE_SPECS[node.kind]?.label, summarize(node), node.prompt, node.text,
    node.keys, node.conditionWindow, node.folder, node.url, node.pattern, node.source,
    ...(node.items ?? [])].filter((value): value is string => typeof value === 'string').join('\n')
}

/** Each canvas is read left-to-right, then top-to-bottom; a package's contents follow its header. */
export function searchCanvas(graph: AgentGraph, query: string): CanvasSearchHit[] {
  const needle = fold(query.trim())
  if (!needle) return []
  const hits: CanvasSearchHit[] = []
  const visiting = new Set<AgentGraph>()
  const visit = (current: AgentGraph, path: string[], labels: string[]) => {
    if (visiting.has(current)) return
    visiting.add(current)
    const nodes = current.nodes.map((node, index) => ({ node, index }))
      .sort((a, b) => a.node.x - b.node.x || a.node.y - b.node.y || a.index - b.index)
    for (const { node } of nodes) {
      if (fold(searchable(node)).includes(needle)) {
        hits.push({ nodeId: node.id, path: [...path], title: node.title, breadcrumb: [...labels, node.title].join(' › ') })
      }
      if (node.kind === 'package' && node.inner) visit(node.inner, [...path, node.id], [...labels, node.title])
    }
    visiting.delete(current)
  }
  visit(graph, [], [])
  return hits
}
