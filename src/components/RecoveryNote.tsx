import { useEffect, useState } from 'react'
import type { RecoveryReport } from '../../electron/recovery'
import type { NodeContext } from '../../electron/tool-context'
import { recoveryOutcome, recoveryReportText } from '../lib/recovery-report-view'

export default function RecoveryNote({ reports, title, onClose }: { reports: RecoveryReport[]; title: string; onClose: () => void }) {
  const [selected, setSelected] = useState(reports[0]?.id)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string } | 'all' | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [copyStatus, setCopyStatus] = useState<{ id: string; message: string; error?: boolean } | null>(null)
  const [utilityError, setUtilityError] = useState('')
  const report = reports.find(r => r.id === selected) ?? reports[0]
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopImmediatePropagation(); onClose() } }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])
  if (!report) return null
  const index = reports.indexOf(report)
  const context = report.context as NodeContext | null
  const copy = async () => {
    const id = report.id
    try {
      if (!await window.xpAgent?.copyRecoveryReportText?.(recoveryReportText(report))) throw new Error('Kopyalanamadı')
      setCopyStatus({ id, message: 'Rapor kopyalandı.' })
    } catch { setCopyStatus({ id, message: 'Rapor kopyalanamadı. Tekrar deneyebilirsin.', error: true }) }
  }
  const openFolder = async () => {
    setUtilityError('')
    try { await window.xpAgent?.openRecoveryReports?.() }
    catch { setUtilityError('Rapor klasörü açılamadı.') }
  }
  const remove = async () => {
    if (deleting || !deleteTarget) return
    setDeleting(true); setDeleteError('')
    try {
      const ok = deleteTarget === 'all' ? await window.xpAgent?.clearRecoveryReports?.() : await window.xpAgent?.removeRecoveryReport?.(deleteTarget.id)
      if (!ok) throw new Error('Silinemedi')
      setDeleteTarget(null)
    } catch { setDeleteError('Rapor silinemedi. Tekrar deneyebilirsin.') }
    finally { setDeleting(false) }
  }
  return <section className="recovery-note" role="dialog" aria-label={`${title} kurtarma notları`}
    onKeyDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
    onContextMenu={e => { e.preventDefault(); e.stopPropagation() }}>
    <header><b>▤ Kurtarma notu · {title}</b><button type="button" aria-label="Notu kapat" onClick={onClose}>×</button></header>
    <nav aria-label="Raporlar">
      <button className="xp-btn" type="button" disabled={index === 0 || !!deleteTarget} onClick={() => setSelected(reports[index-1].id)}>◀</button>
      <span>{index+1} / {reports.length}</span>
      <button className="xp-btn" type="button" disabled={index === reports.length-1 || !!deleteTarget} onClick={() => setSelected(reports[index+1].id)}>▶</button>
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
    {(window.xpAgent?.removeRecoveryReport || window.xpAgent?.clearRecoveryReports) && <footer className="recovery-note-actions">
      {deleteTarget ? <>
        <p>{deleteTarget === 'all' ? 'Bütün tuvallerin kurtarma raporları kalıcı olarak temizlensin mi? Node ve akışlar korunur.' : 'Bu rapor kalıcı olarak temizlensin mi?'}</p>
        <button type="button" className="xp-btn" disabled={deleting} onClick={() => void remove()}>Evet, temizle</button>
        <button type="button" className="xp-btn" disabled={deleting} onClick={() => { setDeleteTarget(null); setDeleteError('') }}>Vazgeç</button>
      </> : <>
        <button type="button" className="xp-btn" disabled={!window.xpAgent?.removeRecoveryReport} onClick={() => { setDeleteTarget({ id: report.id }); setDeleteError('') }}>Bu raporu temizle</button>
        <button type="button" className="xp-btn" disabled={!window.xpAgent?.clearRecoveryReports} onClick={() => { setDeleteTarget('all'); setDeleteError('') }}>Tüm raporları temizle</button>
      </>}
      {deleteError && <p role="alert">{deleteError}</p>}
    </footer>}
    {(window.xpAgent?.openRecoveryReports || window.xpAgent?.copyRecoveryReportText) && <footer className="recovery-note-actions">
      <button type="button" className="xp-btn" disabled={!window.xpAgent?.openRecoveryReports} onClick={() => void openFolder()}>Rapor klasörünü aç</button>
      <button type="button" className="xp-btn recovery-copy" disabled={!window.xpAgent?.copyRecoveryReportText}
        title="Rapor metnini kopyala" aria-label="Rapor metnini kopyala" onClick={() => void copy()}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="1" width="9" height="11" rx="1" fill="#e4edf8" stroke="#44618c" /><rect x="5" y="4" width="9" height="11" rx="1" fill="#fffef4" stroke="#44618c" /><path d="M7 7h5M7 9h5M7 11h4" stroke="#55729b" /></svg>
      </button>
      {copyStatus?.id === report.id && <p role={copyStatus.error ? 'alert' : 'status'}>{copyStatus.message}</p>}
      {utilityError && <p role="alert">{utilityError}</p>}
    </footer>}
  </section>
}
