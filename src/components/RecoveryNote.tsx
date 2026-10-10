import { useEffect, useState } from 'react'
import type { RecoveryReport } from '../../electron/recovery'
import type { NodeContext } from '../../electron/tool-context'
import { recoveryOutcome } from '../lib/recovery-report-view'

export default function RecoveryNote({ reports, title, onClose }: { reports: RecoveryReport[]; title: string; onClose: () => void }) {
  const [selected, setSelected] = useState(reports[0]?.id)
  const report = reports.find(r => r.id === selected) ?? reports[0]
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopImmediatePropagation(); onClose() } }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])
  if (!report) return null
  const index = reports.indexOf(report)
  const context = report.context as NodeContext | null
  return <section className="recovery-note" role="dialog" aria-label={`${title} kurtarma notları`}
    onKeyDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
    onContextMenu={e => { e.preventDefault(); e.stopPropagation() }}>
    <header><b>▤ Kurtarma notu · {title}</b><button type="button" aria-label="Notu kapat" onClick={onClose}>×</button></header>
    <nav aria-label="Raporlar">
      <button className="xp-btn" type="button" disabled={index === 0} onClick={() => setSelected(reports[index-1].id)}>◀</button>
      <span>{index+1} / {reports.length}</span>
      <button className="xp-btn" type="button" disabled={index === reports.length-1} onClick={() => setSelected(reports[index+1].id)}>▶</button>
    </nav>
    <div className="recovery-note-paper" tabIndex={0}>
      <p className="recovery-note-date">{new Date(report.startedAt).toLocaleString('tr-TR')} · {report.nodeTitle}</p>
      <p><b>Sonuç:</b> {recoveryOutcome(report)}</p>
      {context?.loop?.item && <p><b>Öğe:</b> {context.loop.item}</p>}
      <p><b>Hata:</b> {report.error}</p>
      <p><b>Olası neden:</b> {report.probableCause || 'Belirlenemedi.'}</p>
      {report.evidence && <p><b>Gözlem:</b> {report.evidence}</p>}
      {report.completionBasis === 'model-observed' && <p>Hedefin gerçekleştiğine model ekran gözlemine göre karar verdi.</p>}
      {report.summary && <p>{report.summary}</p>}
      {report.resumeError && <p><b>Devam hatası:</b> {report.resumeError}</p>}
      <b>Yapılanlar</b>
      {report.actions.length ? <ol>{report.actions.map((a,i) => <li key={i}><b>{a.tool}</b> · {a.message}</li>)}</ol> : <p>Eylem kaydı yok.</p>}
    </div>
  </section>
}
