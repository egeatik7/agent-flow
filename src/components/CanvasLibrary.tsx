import { useEffect, useRef, useState } from 'react'
import { newId, type CanvasLibrary as Library, type CanvasAutomation, type CanvasTab, type SavedCanvas } from '../types'
import { addAutomationEntry, automationDraftDirty, editAutomationEntries, type AutomationDraft } from '../../electron/canvas-library'
type Props = {
  library: Library; tabs: CanvasTab[]; disabled: boolean
  onConfirm: (message: string) => Promise<boolean>
  onSaveCanvas: () => void
  onOpenCanvas: (canvas: SavedCanvas) => void
  onCloseCanvas: (id: string) => void
  onRenameCanvas: (id: string, name: string) => Promise<boolean>
  onDeleteCanvas: (id: string) => void
  onOpenAutomation: (id: string) => void
  onSaveAutomation: (draft: AutomationDraft) => Promise<CanvasAutomation | null>
  onDeleteAutomation: (id: string) => void
  onExportAutomation: (id: string) => void
}
type Editor = AutomationDraft & { key: string }
const editorFor = (a: CanvasAutomation): Editor => ({ key: a.id, id: a.id, name: a.name, entries: structuredClone(a.entries), expected: structuredClone(a) })
export default function CanvasLibrary(p: Props) {
  const [view, setView] = useState<'canvases' | 'automations'>('canvases')
  const [editor, setEditor] = useState<Editor | null>(null)
  // Kullanıcı isteği: "Genişlet" tuvalleri açar, "Daralt" yeniden gizler. Taslak kaybolmaz.
  const [collapsed, setCollapsed] = useState(false)
  const [adding, setAdding] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const locked = p.disabled || pending
  const dirty = !!editor && automationDraftDirty(editor)
  const source = editor?.id ? p.library.automations.find(a => a.id === editor.id) : undefined
  const stale = !!editor?.id && JSON.stringify(source) !== JSON.stringify(editor.expected)
  const missing = !!editor?.entries.some(e => !p.library.canvases.some(c => c.id === e.canvasId))
  const available = p.library.canvases.filter(c => !editor?.entries.some(e => e.canvasId === c.id))

  useEffect(() => {
    // Keep a clean editor in sync with externally changed/deleted group records;
    // preserve dirty drafts and let the explicit reload/Save conflict check handle them.
    setEditor(current => {
      if (!current?.id || automationDraftDirty(current)) return current
      const fresh = p.library.automations.find(a => a.id === current.id)
      if (!fresh) return null
      return JSON.stringify(fresh) === JSON.stringify(current.expected) ? current : editorFor(fresh)
    })
  }, [p.library.automations])

  const choose = async (automation?: CanvasAutomation) => {
    if (locked || busy.current) return
    if (dirty && !await p.onConfirm('Kaydedilmeyen otomasyon düzenlemesini bırakmak istediğinize emin misiniz?')) return
    setEditor(automation ? editorFor(automation) : { key: newId(), name: '', entries: [] })
    setCollapsed(false)
    setAdding(''); setView('automations')
  }
  const change = (fn: (e: Editor) => Editor) => setEditor(e => e ? fn(e) : null)
  const save = async () => {
    if (!editor || locked || busy.current || !editor.name.trim() || stale || missing) return
    busy.current = true; setPending(true)
    try {
      const saved = await p.onSaveAutomation(editor)
      if (saved) { setEditor(editorFor(saved)); setAdding('') }
    } finally { busy.current = false; setPending(false) }
  }
  const removeEntry = async (id: string) => {
    if (!editor || locked || busy.current) return
    const key = editor.key
    if (!await p.onConfirm('Tuval bu otomasyon listesinden çıkarılsın mı? Tuval deposunda kalır; listeyi Kaydet ile kalıcılaştırabilirsin.')) return
    setEditor(e => e?.key === key ? { ...e, entries: editAutomationEntries(e.entries, id, 'delete') } : e)
  }
  const rename = async () => {
    if (!renaming || !name.trim() || locked || busy.current) return
    busy.current = true; setPending(true)
    try { if (await p.onRenameCanvas(renaming, name)) setRenaming(null) }
    finally { busy.current = false; setPending(false) }
  }

  return <section className="canvas-library" aria-label="Tuval deposu ve otomasyonlar">
    <div className="library-views" role="tablist" aria-label="Tuval yönetimi">
      <button className={`xp-btn ${view === 'canvases' ? 'primary' : ''}`} role="tab" aria-selected={view === 'canvases'} onClick={() => setView('canvases')}>Tuval Deposu</button>
      <button className={`xp-btn ${view === 'automations' ? 'primary' : ''}`} role="tab" aria-selected={view === 'automations'} onClick={() => setView('automations')}>Otomasyonlar</button>
    </div>
    <div className="canvas-library-scroll">
      {view === 'canvases' && <>
        <div className="library-view-heading"><h3>Tuval Deposu</h3><button className="xp-btn" disabled={locked} onClick={p.onSaveCanvas}>Tuvali Kaydet</button></div>
        <p className="hint">Otomasyonlar da buradaki aynı tuval kayıtlarını kullanır.</p>
        {!p.library.canvases.length && <p className="hint">Tuvali Kaydet veya Dosya → İçe Aktar ile ekle.</p>}
        <ul className="saved-canvases">
          {p.library.canvases.map(c => {
            const openCount = p.tabs.filter(t => t.savedId === c.id).length
            return <li key={c.id}>
              {renaming === c.id ? <>
                <input className="xp-input library-name-input" aria-label="Kayıtlı tuval adı" value={name} maxLength={48} disabled={locked} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void rename() } if (e.key === 'Escape') setRenaming(null) }} />
                <button className="library-mini" disabled={locked || !name.trim()} title="Tuval adını kaydet" onClick={() => void rename()}>✓</button>
                <button className="library-mini" disabled={locked} title="Ad değişikliğini iptal et" onClick={() => setRenaming(null)}>↩</button>
              </> : <><span className="library-canvas-name" title={c.name}>{c.name}</span><button className="library-mini" disabled={locked} title={`“${c.name}” adını değiştir`} onClick={() => { setRenaming(c.id); setName(c.name) }}>✎</button></>}
              <button className="library-mini" title={`“${c.name}” tuvalini yeni sekmede aç`} disabled={locked} onClick={() => p.onOpenCanvas(c)}>+</button>
              <button className="library-close" title="Açık sekmesini kapat; kayıt depoda kalır" disabled={locked || !openCount || p.tabs.length < 2} onClick={() => p.onCloseCanvas(c.id)}>Kapat{openCount > 1 ? ` (${openCount})` : ''}</button>
              <button className="library-mini library-delete" title={`“${c.name}” tuvalini depodan sil`} disabled={locked} onClick={() => p.onDeleteCanvas(c.id)}>×</button>
            </li>
          })}
        </ul>
      </>}
      {view === 'automations' && <>
        <div className="library-view-heading"><h3>Otomasyonlar</h3><button className="xp-btn" disabled={locked} onClick={() => void choose()}>+ Yeni</button></div>
        {!p.library.automations.length && <p className="hint">Yeni otomasyon oluştur, depodan tuvaller ekle ve Kaydet.</p>}
        {p.library.automations.map(a => <div className={`automation-card${editor?.id === a.id ? ' selected' : ''}`} key={a.id}>
          <div className="automation-name-row"><strong title={a.name}>{a.name}</strong><span>{a.entries.length} tuval</span>
            <button className="library-mini library-delete" title={`“${a.name}” otomasyonunu sil`} disabled={locked} onClick={() => p.onDeleteAutomation(a.id)}>×</button></div>
          <div className="automation-actions">
            <button className="xp-btn" disabled={locked} onClick={() => { if (editor?.id === a.id) setCollapsed(!collapsed); else void choose(a) }}>{editor?.id === a.id && !collapsed ? 'Daralt' : 'Genişlet'}</button>
            <button className="xp-btn" disabled={locked || !a.entries.length || (editor?.id === a.id && dirty)} title="Kayıtlı sırayı üstteki çalışma sekmelerinde aç" onClick={() => p.onOpenAutomation(a.id)}>Aç</button>
            <button className="xp-btn" disabled={locked || (editor?.id === a.id && dirty)} onClick={() => p.onExportAutomation(a.id)}>Export</button>
          </div>
        </div>)}
        {editor && !collapsed && <div className="automation-editor">
          <label className="field-label" htmlFor="automation-name">Otomasyon adı</label>
          <input id="automation-name" className="xp-input" value={editor.name} placeholder="Otomasyon adı" maxLength={48} disabled={locked} onChange={e => change(d => ({ ...d, name: e.target.value }))} />
          <div className="automation-editor-status">{dirty ? 'Kaydedilmeyen değişiklikler var.' : editor.id ? 'Kayıtlı liste.' : 'Yeni liste.'}</div>
          {stale && <p className="hint library-warning">Kayıt değişti veya silindi. Düzenle ile yeniden yükle; eski taslak kaydın üzerine yazılmaz.</p>}
          {missing && <p className="hint library-warning">Listedeki bir tuval depodan silinmiş. Bu satırı çıkar veya listeyi yeniden yükle.</p>}
          <ol className="automation-canvases">
            {editor.entries.map((e, i) => {
              const c = p.library.canvases.find(c => c.id === e.canvasId)
              return <li key={e.id}>
                <span className="library-canvas-name" title={c?.name}>{i + 1}. {c?.name ?? 'Silinmiş tuval'}</span>
                <button className="library-mini" title="Tuvali yeni sekmede aç" disabled={locked || !c} onClick={() => c && p.onOpenCanvas(c)}>+</button>
                <button className="library-mini" title="Yukarı taşı" disabled={locked || i === 0} onClick={() => change(d => ({ ...d, entries: editAutomationEntries(d.entries, e.id, 'up') }))}>↑</button>
                <button className="library-mini" title="Aşağı taşı" disabled={locked || i === editor.entries.length - 1} onClick={() => change(d => ({ ...d, entries: editAutomationEntries(d.entries, e.id, 'down') }))}>↓</button>
                <button className="library-mini library-delete" title="Tuvali otomasyon listesinden çıkar" disabled={locked} onClick={() => void removeEntry(e.id)}>×</button>
              </li>
            })}
          </ol>
          <div className="automation-add-row">
            <select className="xp-input" aria-label="Depodan tuval seç" disabled={locked || !available.length} value={available.some(c => c.id === adding) ? adding : ''} onChange={e => setAdding(e.target.value)}>
              <option value="">Depodan tuval seç…</option>
              {available.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="xp-btn" disabled={locked || !available.some(c => c.id === adding)} onClick={() => { change(d => ({ ...d, entries: addAutomationEntry(d.entries, adding) })); setAdding('') }}>Ekle</button>
          </div>
          {!available.length && <p className="hint">Depodaki bütün tuvaller bu listede. Yeni bir tuvali önce Tuvaller ekranında kaydet.</p>}
          <div className="automation-actions"><button className="xp-btn primary" disabled={locked || !editor.name.trim() || stale || missing} onClick={() => void save()}>Kaydet</button>
            <button className="xp-btn" disabled={locked || !dirty} onClick={() => void choose(source)}>Vazgeç</button>
          </div>
        </div>}
      </>}
    </div>
  </section>
}
