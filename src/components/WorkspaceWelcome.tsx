import { useEffect, useId, useRef, useState } from 'react'
import type { CanvasLibrary } from '../types'

export function XpWorkspaceIcon(p: { kind: 'canvas' | 'automation' | 'new' }) {
  const id = `xp-${useId().replace(/:/g, '')}-${p.kind}`
  return <svg className="workspace-icon" viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-folder`} x2="0" y2="1"><stop stopColor="#fff3a9"/><stop offset=".4" stopColor="#ffd765"/><stop offset="1" stopColor="#e59a23"/></linearGradient>
      <linearGradient id={`${id}-paper`} x2=".5" y2="1"><stop stopColor="#fff"/><stop offset="1" stopColor="#dceaff"/></linearGradient>
      <linearGradient id={`${id}-blue`} x2="0" y2="1"><stop stopColor="#81bdff"/><stop offset="1" stopColor="#2261c5"/></linearGradient>
    </defs>
    <ellipse cx="32" cy="57" rx="25" ry="4" fill="#547b9e" opacity=".2"/>
    {p.kind === 'new' ? <>
      <path d="M16 5h25l10 11v38H16z" fill={`url(#${id}-paper)`} stroke="#6589b5" strokeWidth="2"/>
      <path d="M41 5v12h10" fill="#b5d5fa" stroke="#6589b5"/>
      <path d="M23 23h19M23 29h19M23 35h12" stroke="#8eabd0" strokeWidth="2"/>
      <circle cx="46" cy="46" r="14" fill="#4b9d31" stroke="#2d6e24"/>
      <path d="M46 38v16M38 46h16" stroke="#fff" strokeWidth="4"/>
    </> : <>
      <path d="M6 16h21l5 6h25v30H6z" fill="#e5a537" stroke="#a97625" strokeWidth="2"/>
      <path d="M13 12h34v33H13z" fill={`url(#${id}-paper)`} stroke="#6d93bf"/>
      <path d="M20 19h19M20 25h19" stroke="#89a9cb" strokeWidth="2"/>
      <path d="M9 29h49l-6 25H5z" fill={`url(#${id}-folder)`} stroke="#bd8628" strokeWidth="2"/>
      <path d="M12 32h41" stroke="#fff8ce" strokeWidth="2"/>
      {p.kind === 'automation' && <>
        <path d="M37 29h9v9h9v9h-9v9h-9v-9h-9v-9h9z" fill={`url(#${id}-blue)`} stroke="#285196" strokeWidth="2"/>
        <circle cx="41.5" cy="42.5" r="7" fill="#d6e8ff" stroke="#285196" strokeWidth="2"/>
      </>}
    </>}
  </svg>
}

export default function WorkspaceWelcome(p: { disabled: boolean; onOpen: (kind: 'canvas' | 'automation') => void; onNew: () => void }) {
  return <section className="workspace-welcome" aria-label="Başlangıç">
    <div className="welcome-heading"><h2>Ne yapmak istersin?</h2><p>Bir tuval aç veya yeni bir çalışma başlat.</p></div>
    <div className="welcome-cards">
      {([
        ['canvas', 'Tuval Aç', 'Depodaki bir tuvalle devam et.'],
        ['automation', 'Otomasyon Aç', 'Kayıtlı tuval listesini aç.'],
        ['new', 'Yeni Tuval Oluştur', 'Boş bir tuvalle başla.'],
      ] as const).map(([kind, title, description]) => <button className="welcome-card" key={kind} disabled={p.disabled} onClick={() => kind === 'new' ? p.onNew() : p.onOpen(kind)}>
        <XpWorkspaceIcon kind={kind}/><strong>{title}</strong><span>{description}</span>
      </button>)}
    </div>
  </section>
}

export function WorkspacePicker(p: { kind: 'canvas' | 'automation'; library: CanvasLibrary; onCancel: () => void; onOpen: (id: string) => Promise<boolean> }) {
  const rows = p.kind === 'canvas' ? p.library.canvases : p.library.automations
  const [selected, setSelected] = useState(rows[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const locked = useRef(false)
  const dialog = useRef<HTMLDivElement>(null)
  const cancel = useRef(p.onCancel)
  cancel.current = p.onCancel
  const title = p.kind === 'canvas' ? 'Tuval Aç' : 'Otomasyon Aç'
  const open = async (id: string) => {
    if (locked.current || !rows.some(row => row.id === id) || (p.kind === 'automation' && !p.library.automations.find(a => a.id === id)?.entries.length)) return
    locked.current = true; setBusy(true); setFailed(false)
    try { if (await p.onOpen(id)) p.onCancel(); else setFailed(true) }
    catch { setFailed(true) }
    finally { locked.current = false; setBusy(false) }
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked.current) { e.preventDefault(); cancel.current() }
      if (e.key === 'Tab') {
        const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
        if (!buttons.length) return
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
        e.preventDefault(); buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus()
      }
    }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('keydown', key); previous?.focus() }
  }, [])
  return <div className="modal-backdrop xp-confirm-backdrop">
    <div ref={dialog} className="xp-dialog workspace-picker" role="dialog" aria-modal="true" aria-labelledby="workspace-picker-title">
      <div className="titlebar dialog-title"><div className="titlebar-left"><h1 id="workspace-picker-title">{title}</h1></div>
        <div className="titlebar-controls"><button className="title-btn close" title="İptal" disabled={busy} onClick={p.onCancel}>✕</button></div>
      </div>
      <div className="workspace-picker-body">
        <p>Hangisini açmak istersin?</p>
        <div className="workspace-picker-list" aria-label="Kayıtlar">
          {rows.map(row => <button key={row.id} className={`workspace-picker-row${selected === row.id ? ' selected' : ''}`} disabled={busy} aria-pressed={selected === row.id} onClick={() => setSelected(row.id)} onDoubleClick={() => void open(row.id)}>
            <XpWorkspaceIcon kind={p.kind}/><span>{row.name}</span>{'entries' in row && <small>{row.entries.length} tuval</small>}
          </button>)}
          {!rows.length && <p className="hint">{p.kind === 'canvas' ? 'Henüz kayıtlı tuval yok. Yeni bir tuval oluşturup Tuvaller sekmesinden kaydedebilirsin.' : 'Henüz otomasyon yok. Tuvaller sekmesindeki Otomasyonlar bölümünden oluşturabilirsin.'}</p>}
        </div>
        {failed && <p className="hint warn">Açılamadı. Kayıtları kontrol edip tekrar deneyebilirsin.</p>}
        <div className="workspace-picker-actions"><button className="xp-btn primary" disabled={busy || !rows.some(row => row.id === selected) || (p.kind === 'automation' && !p.library.automations.find(a => a.id === selected)?.entries.length)} onClick={() => void open(selected)}>{busy ? 'Açılıyor…' : 'Aç'}</button><button className="xp-btn" disabled={busy} onClick={p.onCancel}>İptal</button></div>
      </div>
    </div>
  </div>
}
