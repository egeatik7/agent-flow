import { useEffect, useRef, useState } from 'react'

export default function WorkspaceNameDialog(p: { title: string; initial: string; onAnswer: (name: string | null) => void }) {
  const [name, setName] = useState(p.initial)
  const input = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => { input.current?.focus(); input.current?.select() }, [])
  return <div className="modal-backdrop xp-confirm-backdrop"><div ref={dialog} className="xp-dialog xp-confirm" role="dialog" aria-modal="true" aria-labelledby="workspace-name-title"
    onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); p.onAnswer(null) }
      if (e.key === 'Tab') {
        const fields = Array.from(dialog.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') ?? [])
        if (!fields.length) return
        e.preventDefault(); const i = fields.indexOf(document.activeElement as HTMLElement)
        fields[(i + (e.shiftKey ? -1 : 1) + fields.length) % fields.length].focus()
      }
    }}>
    <div className="titlebar dialog-title"><div className="titlebar-left"><h1 id="workspace-name-title">{p.title}</h1></div><div className="titlebar-controls"><button className="title-btn close" title="İptal" onClick={() => p.onAnswer(null)}>✕</button></div></div>
    <form onSubmit={e => { e.preventDefault(); if (name.trim()) p.onAnswer(name.trim()) }}>
      <div className="xp-confirm-body"><label className="field-label">Ad<input className="xp-input" ref={input} value={name} maxLength={48} onChange={e => setName(e.target.value)} /></label></div>
      <div className="xp-confirm-buttons"><button type="submit" className="xp-btn primary" disabled={!name.trim()}>Kaydet</button><button type="button" className="xp-btn" onClick={() => p.onAnswer(null)}>İptal</button></div>
    </form>
  </div></div>
}
