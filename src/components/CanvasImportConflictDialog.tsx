import { useEffect, useRef } from 'react'
type Props = { name: string; canvasId: string; automation?: boolean; onCopy: () => void; onOpen?: () => void; onCancel: () => void }
export default function CanvasImportConflictDialog(p: Props) {
  const dialog = useRef<HTMLDivElement>(null)
  const copy = useRef<HTMLButtonElement>(null)
  useEffect(() => { copy.current?.focus(); const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); p.onCancel() } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key) }, [p.onCancel])
  return <div className="modal-backdrop xp-confirm-backdrop"><div ref={dialog} className="xp-dialog xp-confirm" onKeyDown={e => {
    if (e.key !== 'Tab') return
    const fields = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])
    if (!fields.length) return
    e.preventDefault(); const at = fields.indexOf(document.activeElement as HTMLElement)
    fields[(at + (e.shiftKey ? -1 : 1) + fields.length) % fields.length].focus()
  }} role="alertdialog" aria-modal="true" aria-labelledby="canvas-import-conflict-title">
    <div className="titlebar dialog-title"><h1 id="canvas-import-conflict-title">Tuval Kimliği Çakışıyor</h1></div>
    <div className="xp-confirm-body"><p>“{p.name}” ile aynı kimlikte farklı bir sürüm kütüphanede var. Mevcut kayıt değiştirilmedi.</p><p className="hint" style={{overflowWrap: 'anywhere'}} title={p.canvasId}>Kimlik: {p.canvasId}</p>{p.automation&&<p>Farklı Kaydet, çakışan tuvaller için yeni kimlikler oluşturur; otomasyonun bağlantıları bu kopyalara gider.</p>}</div>
    <div className="xp-confirm-buttons"><button ref={copy} className="xp-btn primary" onClick={p.onCopy}>Farklı Kaydet…</button>{p.onOpen&&<button className="xp-btn" onClick={p.onOpen}>Mevcut Tuvali Aç</button>}<button className="xp-btn" onClick={p.onCancel}>İptal</button></div>
  </div></div>
}
