import { useEffect, useRef } from 'react'
import type { SaveDecision } from '../../electron/canvas-session'

export default function SaveCanvasDialog(p: { name: string; onAnswer: (answer: SaveDecision) => void }) {
  const save = useRef<HTMLButtonElement>(null)
  const answer = useRef(p.onAnswer)
  answer.current = p.onAnswer
  useEffect(() => {
    save.current?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); answer.current('cancel') }
      if (e.key === 'Tab') {
        const buttons = save.current?.parentElement?.querySelectorAll<HTMLButtonElement>('button')
        if (!buttons?.length) return
        const index = Array.from(buttons).indexOf(document.activeElement as HTMLButtonElement)
        e.preventDefault()
        buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [p.name])
  return <div className="modal-backdrop xp-confirm-backdrop">
    <div className="xp-dialog xp-confirm" role="alertdialog" aria-modal="true" aria-labelledby="save-canvas-q">
      <div className="titlebar dialog-title"><div className="titlebar-left"><h1>Nubbo Agent Studio</h1></div>
        <div className="titlebar-controls"><button className="title-btn close" title="İptal" onClick={() => p.onAnswer('cancel')}>✕</button></div>
      </div>
      <div className="xp-confirm-body"><div className="xp-confirm-icon" aria-hidden>?</div>
        <p id="save-canvas-q">“{p.name}” tuvalindeki değişiklikleri kaydetmek istiyor musunuz?</p>
      </div>
      <div className="xp-confirm-buttons">
        <button className="xp-btn primary" ref={save} onClick={() => p.onAnswer('save')}>Kaydet</button>
        <button className="xp-btn" onClick={() => p.onAnswer('discard')}>Kaydetme</button>
        <button className="xp-btn" onClick={() => p.onAnswer('cancel')}>İptal</button>
      </div>
    </div>
  </div>
}
