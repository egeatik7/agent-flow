import { useId } from 'react'

export function XpWorkspaceIcon(p: { kind: 'canvas' | 'group' | 'new' }) {
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
      {p.kind === 'group' && <>
        <path d="M37 29h9v9h9v9h-9v9h-9v-9h-9v-9h9z" fill={`url(#${id}-blue)`} stroke="#285196" strokeWidth="2"/>
        <circle cx="41.5" cy="42.5" r="7" fill="#d6e8ff" stroke="#285196" strokeWidth="2"/>
      </>}
    </>}
  </svg>
}

export default function WorkspaceWelcome(p: { disabled: boolean; onOpen: (kind: 'canvas' | 'group') => void; onNew: () => void }) {
  return <section className="workspace-welcome" aria-label="Başlangıç">
    <div className="welcome-heading"><h2>Ne yapmak istersin?</h2><p>Bir tuval aç veya yeni bir çalışma başlat.</p></div>
    <div className="welcome-cards">
      {([
        ['canvas', 'Tuval Aç', 'Depodaki bir tuvalle devam et.'],
        ['group', 'ZIP Grubu Aç', 'ZIP içindeki tuvalleri sırasıyla aç.'],
        ['new', 'Yeni Tuval Oluştur', 'Boş bir tuvalle başla.'],
      ] as const).map(([kind, title, description]) => <button className="welcome-card" key={kind} disabled={p.disabled} onClick={() => kind === 'new' ? p.onNew() : p.onOpen(kind)}>
        <XpWorkspaceIcon kind={kind}/><strong>{title}</strong><span>{description}</span>
      </button>)}
    </div>
  </section>
}
