import type { AgentGraph } from '../../electron/graph-types'
import type { RecoveryReport } from '../../electron/recovery'
import type { NodeContext } from '../../electron/tool-context'

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

/** Plain-text equivalent of the visible report, suitable for pasting into chat. */
export function recoveryReportText(report: RecoveryReport): string {
  const context = report.context as NodeContext | null
  return [
    `Kurtarma notu · ${report.nodeTitle}`,
    new Date(report.startedAt).toLocaleString('tr-TR'),
    `Sonuç: ${recoveryOutcome(report)}`,
    report.modelsUsed?.length ? `Cevap veren model: ${report.modelsUsed.join(' → ')}` : '',
    `Ayarlı model zinciri: ${report.model}`,
    report.usage
      ? `Harcama: ${report.usage.total} token (giriş ${report.usage.prompt} · çıkış ${report.usage.completion}) · ${((report.endedAt - report.startedAt) / 1000).toFixed(1)} sn${typeof report.usage.costUsd === 'number' ? ` · $${report.usage.costUsd.toFixed(4)} (sağlayıcı bildirimi)` : ' · maliyet bildirilmedi'}`
      : `Süre: ${((report.endedAt - report.startedAt) / 1000).toFixed(1)} sn`,
    context?.loop?.item ? `Öğe: ${context.loop.item}` : '',
    `Hata: ${report.error}`,
    `Olası neden: ${report.probableCause || 'Belirlenemedi.'}`,
    report.evidence ? `Gözlem: ${report.evidence}` : '',
    report.completionBasis === 'model-observed' ? 'Hedefin gerçekleştiğine model ekran gözlemine göre karar verdi.' : '',
    report.summary,
    report.resumeError ? `Devam hatası: ${report.resumeError}` : '',
    'Yapılanlar',
    report.actions.length ? report.actions.map((action, index) => `${index + 1}. ${action.tool} · ${action.message}`).join('\n') : 'Eylem kaydı yok.',
  ].filter(Boolean).join('\n\n')
}
