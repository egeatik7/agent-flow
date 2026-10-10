import type { AgentGraph } from '../../electron/graph-types'
import type { RecoveryReport } from '../../electron/recovery'

/** Read-only projection: reports never become nodes or graph metadata. */
export function recoveryReportIndex(graph: AgentGraph, reports: RecoveryReport[], canvasId?: string): Map<string, RecoveryReport[]> {
  const eligible = [...new Map(reports.filter(r => !r.canvasId || r.canvasId === canvasId).map(r => [r.id, r])).values()]
    .sort((a,b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id))
  const descendants = (g: AgentGraph, id: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(id)) return seen
    seen.add(id)
    const node = g.nodes.find(n => n.id === id)
    for (const child of node?.members ?? []) descendants(g, child, seen)
    if (node?.inner) for (const child of node.inner.nodes) descendants(node.inner, child.id, seen)
    return seen
  }
  return new Map(graph.nodes.map(node => {
    const ids = descendants(graph, node.id)
    return [node.id, eligible.filter(report => ids.has(report.nodeId))]
  }))
}
export function recoveryOutcome(report: RecoveryReport): string {
  if (report.resumed === true) return 'Kurtarma başarılı; node tamamlandı ve akış devam etti.'
  if (report.resumed === false) return 'Devam denemesi başarısız.'
  if (report.result === 'stopped') return 'Kullanıcı durdurdu.'
  if (report.result === 'failed') return 'Kurtarma başarısız; akış toparlanamadı.'
  return 'Devam sonucu henüz kaydedilmedi.'
}
