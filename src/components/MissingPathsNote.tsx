import type { NamedStructureIssue } from '../../electron/run-structure'
import { useEffect, useRef } from 'react'
import type { LoopPathReport } from '../lib/item-paths'

/**
 * Koşu başlamadan dosya ve yapı bulgularını gösterir.
 * Yapısal hatalar engelleyicidir; yalnız uyarılar kullanıcı onayıyla aşılabilir.
 */
export default function MissingPathsNote(p: { items: LoopPathReport[]; structure?: NamedStructureIssue[]; onAnswer: (answer: 'run' | 'cancel') => void }) {
  const structure = p.structure ?? []
  const blocked = structure.some(issue => issue.severity === 'error')
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
          <p id="missing-paths-q">{structure.length ? <><b>Çalıştırma öncesi kontrol</b> · {structure.length} yapısal bulgu{p.items.length ? `, ${p.items.length} eksik dosya/klasör` : ''}.</> : <><b>{p.items.length}</b> döngü yolu diskte bulunamadı. Koşu bu yollarda hata verebilir.</>}</p>
          {blocked && <p>Akış başlamadı. Yapısal hataları düzelttikten sonra yeniden çalıştır.</p>}
          {!blocked && structure.length > 0 && <p>Bağlantısız kollar kasıtlı olabilir. Listelenen yerleri kontrol et; bu kollar seçilirse akış/tur orada biter.</p>}
          <ul className="missing-paths-list">
            {structure.map((r, i) => <li key={`structure-${i}`}>
              <span className="missing-paths-where">{r.severity === 'error' ? 'Hata' : 'Uyarı'} · {[r.canvas, ...r.path, r.node].join(' › ')}</span>
              <span className="missing-paths-reason">{r.message}</span>
            </li>)}
            {p.items.map((r, i) => <li key={i}>
              <span className="missing-paths-where">{r.canvas} › {r.node}</span>
              <span className="missing-paths-path mono">{r.item}</span>
              <span className="missing-paths-reason">{r.reason}</span>
            </li>)}
          </ul>
        </div>
      </div>
      <div className="xp-confirm-buttons">
        {!blocked && <button className="xp-btn primary" ref={first} onClick={() => p.onAnswer('run')}>Yine de çalıştır</button>}
        <button className="xp-btn" ref={blocked ? first : undefined} onClick={() => p.onAnswer('cancel')}>{blocked ? 'Akışı düzelt' : 'Vazgeç'}</button>
      </div>
    </div>
  </div>
}
