import { useEffect, useRef } from 'react'

type Props = {
  question: string
  onYes: () => void
  onNo: () => void
}

/** XP tarzı emin misiniz penceresi. Soru cümlesi çağıran tarafça verilir. */
export default function ConfirmDialog(p: Props) {
  const yesRef = useRef<HTMLButtonElement>(null)

  const yes = useRef(p.onYes)
  const no = useRef(p.onNo)
  yes.current = p.onYes
  no.current = p.onNo

  useEffect(() => {
    yesRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        no.current()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        yes.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="modal-backdrop xp-confirm-backdrop">
      <div className="xp-dialog xp-confirm" role="alertdialog" aria-modal="true" aria-labelledby="xp-confirm-q">
        <div className="titlebar dialog-title">
          <div className="titlebar-left">
            <h1>Nubbo Agent Studio</h1>
          </div>
          <div className="titlebar-controls">
            <button type="button" className="title-btn close" title="Hayır" onClick={p.onNo}>
              ✕
            </button>
          </div>
        </div>
        <div className="xp-confirm-body">
          <div className="xp-confirm-icon" aria-hidden>
            ?
          </div>
          <p id="xp-confirm-q">{p.question}</p>
        </div>
        <div className="xp-confirm-buttons">
          <button type="button" className="xp-btn primary" ref={yesRef} onClick={p.onYes}>
            Evet
          </button>
          <button type="button" className="xp-btn" onClick={p.onNo}>
            Hayır
          </button>
        </div>
      </div>
    </div>
  )
}
