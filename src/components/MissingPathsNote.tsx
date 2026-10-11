import { useEffect, useRef } from 'react'
import type { LoopPathReport } from '../lib/item-paths'

/**
 * Koşu başlarken eksik döngü yollarını gösteren rapor penceresi.
 * Kullanıcı "Yine de çalıştır" derse koşu olduğu gibi başlar; "Vazgeç" (ya da Escape) koşuyu başlatmaz.
 */
export default function MissingPathsNote(p: { items: LoopPathReport[]; onAnswer: (answer: 'run' | 'cancel') => void }) {
  const first = useRef<HTMLButtonElement>(null)
  const answer = useRef(p.onAnswer)
  answer.current = p.onAnswer
  useEffect(() => {
    first.current?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); answer.current('cancel') }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  return <div className="modal-backdrop xp-confirm-backdrop">
    <div className="xp-dialog xp-confirm missing-paths" role="alertdialog" aria-modal="true" aria-labelledby="missing-paths-q">
      <div className="titlebar dialog-title"><div className="titlebar-left"><h1>Nubbo Agent Studio</h1></div>
        <div className="titlebar-controls"><button className="title-btn close" title="Vazgeç" onClick={() => p.onAnswer('cancel')}>✕</button></div>
      </div>
      <div className="xp-confirm-body"><div className="xp-confirm-icon" aria-hidden>!</div>
        <div>
          <p id="missing-paths-q"><b>{p.items.length}</b> döngü yolu diskte bulunamadı. Koşu bu yollarda hata verebilir.</p>
          <ul className="missing-paths-list">
            {p.items.map((r, i) => <li key={i}>
              <span className="missing-paths-where">{r.canvas} › {r.node}</span>
              <span className="missing-paths-path mono">{r.item}</span>
              <span className="missing-paths-reason">{r.reason}</span>
            </li>)}
          </ul>
        </div>
      </div>
      <div className="xp-confirm-buttons">
        <button className="xp-btn primary" ref={first} onClick={() => p.onAnswer('run')}>Yine de çalıştır</button>
        <button className="xp-btn" onClick={() => p.onAnswer('cancel')}>Vazgeç</button>
      </div>
    </div>
  </div>
}
