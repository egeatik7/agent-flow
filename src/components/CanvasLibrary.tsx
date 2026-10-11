import { useEffect, useRef, useState, type SetStateAction } from 'react'
import { newId, type CanvasLibrary as Library, type CanvasAutomation, type CanvasTab, type SavedCanvas, type AutomationEditor, type RecoveredCanvas } from '../types'
import { addAutomationEntry, automationDraftDirty, editAutomationEntries, type AutomationDraft } from '../../electron/canvas-library'
import type { SaveDecision } from '../../electron/canvas-session'
type Props = {
  library: Library; tabs: CanvasTab[]; disabled: boolean
  hasCanvas?: boolean
  draft?: AutomationEditor | null
  onDraftChange?: (draft: AutomationEditor | null) => void
  onAskSave?: (name: string) => Promise<SaveDecision>
  onAskCanvasSave?: (name: string) => Promise<SaveDecision>
  onSaveAll?: () => void
  onSaveSequence?: () => void
  recovery?: RecoveredCanvas[]
  onRestoreDraft?: (id: string) => void
  onDiscardDraft?: (id: string) => void
  onCloseReview?: (review: (() => Promise<boolean>) | null) => void
  onConfirm: (message: string) => Promise<boolean>
  onSaveCanvas: () => void
  onOpenCanvas: (canvas: SavedCanvas) => void
  onCloseCanvas: (id: string) => void
  onRenameCanvas: (id: string, name: string, reviewingClose?: boolean) => Promise<boolean>
  onDeleteCanvas: (id: string) => void
  onOpenAutomation: (id: string) => void
  onSaveAutomation: (draft: AutomationDraft) => Promise<CanvasAutomation | null>
  onDeleteAutomation: (id: string) => void
  onExportAutomation: (id: string) => void
}
type Editor = AutomationEditor
const editorFor = (a: CanvasAutomation): Editor => ({ key: a.id, id: a.id, name: a.name, entries: structuredClone(a.entries), expected: structuredClone(a) })
export default function CanvasLibrary(p: Props) {
  const [view, setView] = useState<'canvases' | 'automations'>('canvases')
  const [localEditor, setLocalEditor] = useState<Editor | null>(null)
  const editor = p.draft === undefined ? localEditor : p.draft
  const editorRef = useRef(editor)
  editorRef.current = editor
  const setEditor = (action: SetStateAction<Editor | null>) => {
    const current = editorRef.current
    const next = typeof action === 'function' ? action(current) : action
    if (next === current) return
    editorRef.current = next
    if (p.draft === undefined) setLocalEditor(next)
    p.onDraftChange?.(next)
  }
  // Kullanıcı isteği: "Genişlet" tuvalleri açar, "Daralt" yeniden gizler. Taslak kaybolmaz.
  const [collapsed, setCollapsed] = useState(false)
  const [adding, setAdding] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const busy = useRef(false)
  const locked = p.disabled || pending
  const dirty = !!editor && automationDraftDirty(editor)
  const source = editor?.id ? p.library.automations.find(a => a.id === editor.id) : undefined
  const stale = !!editor?.id && JSON.stringify(source) !== JSON.stringify(editor.expected)
  const missing = !!editor?.entries.some(e => !p.library.canvases.some(c => c.id === e.canvasId))
  const available = p.library.canvases.filter(c => !editor?.entries.some(e => e.canvasId === c.id))
  useEffect(() => { if (p.draft) { setView('automations'); setCollapsed(false) } }, [p.draft?.key])

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
    if (!await reviewDraft()) return
    if (automation) setEditor(editorFor(automation))
    else {
      let n = 1
      while (p.library.automations.some(a => a.name === `Otomasyon ${n}`)) n++
      setEditor({ key: newId(), name: `Otomasyon ${n}`, entries: [] })
    }
    setCollapsed(false)
    setAdding(''); setView('automations')
  }
  const change = (fn: (e: Editor) => Editor) => setEditor(e => e ? fn(e) : null)
  const persist = async (next: Editor, reviewingClose = false): Promise<boolean> => {
    if ((!reviewingClose && locked) || busy.current) return false
    const source = next.id ? p.library.automations.find(a => a.id === next.id) : undefined
    if ((next.id && JSON.stringify(source) !== JSON.stringify(next.expected)) || next.entries.some(e => !p.library.canvases.some(c => c.id === e.canvasId))) return false
    busy.current = true; setPending(true)
    setEditor(next); setFailed(false)
    try {
      const saved = await p.onSaveAutomation(next)
      if (saved) { setEditor(editorFor(saved)); setAdding(''); return true }
      setFailed(true); return false
    } catch { setFailed(true); return false
    } finally { busy.current = false; setPending(false) }
  }
  const removeEntry = async (id: string) => {
    if (!editor || locked || busy.current) return
    setEditor({ ...editor, entries: editAutomationEntries(editor.entries, id, 'delete') })
    setFailed(false)
  }
  const rename = async () => {
    if (!renaming || !name.trim() || locked || busy.current) return
    busy.current = true; setPending(true)
    try { if (await p.onRenameCanvas(renaming, name)) setRenaming(null) }
    finally { busy.current = false; setPending(false) }
  }

  const reviewDraft = async (): Promise<boolean> => {
    if (renaming && name.trim() !== p.library.canvases.find(c => c.id === renaming)?.name) {
      const answer = p.onAskCanvasSave ? await p.onAskCanvasSave(name || 'Tuval adı') : 'save'
      if (answer === 'cancel') return false
      if (answer === 'save' && (!name.trim() || !await p.onRenameCanvas(renaming, name, true))) return false
      setRenaming(null)
    }
    const current = editorRef.current
    if (!current || !automationDraftDirty(current)) return true
    const answer = p.onAskSave ? await p.onAskSave(current.name) : 'save'
    if (answer === 'cancel') return false
    if (answer === 'save') return persist(current, true)
    setEditor(current.expected ? editorFor(current.expected) : null)
    setFailed(false)
    return true
  }
  const discard = async () => {
    if (!editor || locked || busy.current) return
    if (dirty && !await p.onConfirm('Otomasyondaki kaydedilmemiş değişikliklerden vazgeçilsin mi?')) return
    const fresh = editor.id ? p.library.automations.find(a => a.id === editor.id) : undefined
    setEditor(fresh ? editorFor(fresh) : null); setFailed(false)
  }
  useEffect(() => {
    p.onCloseReview?.(reviewDraft)
    return () => p.onCloseReview?.(null)
  })

  return <section className="canvas-library" aria-label="Tuval deposu ve otomasyonlar">
    <div className="library-views" role="tablist" aria-label="Tuval yönetimi">
      <button className={`xp-btn ${view === 'canvases' ? 'primary' : ''}`} role="tab" aria-selected={view === 'canvases'} onClick={() => setView('canvases')}>Tuval Deposu</button>
      <button className={`xp-btn ${view === 'automations' ? 'primary' : ''}`} role="tab" aria-selected={view === 'automations'} onClick={() => setView('automations')}>Otomasyonlar</button>
    </div>
    <div className="canvas-library-scroll">
      {view === 'canvases' && <>
        <div className="library-view-heading"><h3>Tuval Deposu</h3><button className="xp-btn" disabled={locked || p.hasCanvas === false} onClick={p.onSaveCanvas}>Tuvali Kaydet</button></div>
        {p.onSaveAll && <button className="xp-btn" disabled={locked} onClick={p.onSaveAll}>Tümünü Kaydet</button>}
        <p className="hint">Otomasyonlar aynı tuval kayıtlarını kullanır. Otomatik taslak kaydı, Tuvali Kaydet yerine geçmez.</p>
        {!!p.recovery?.length && <div className="workspace-recovery" aria-label="Kurtarılan çalışmalar"><h3>Kurtarılan çalışmalar</h3>
          <p className="hint">Yarım kalan düzenlemeler burada. Kayıtlı tuvaller değiştirilmedi.</p>
          {p.recovery.map(d => <div className="workspace-recovery-row" key={d.id}><span title={d.name}>{d.name}</span>
            <button className="xp-btn" disabled={locked} onClick={() => p.onRestoreDraft?.(d.id)}>Taslağı Aç</button>
            <button className="library-mini library-delete" title="Kurtarma taslağını sil" disabled={locked} onClick={() => p.onDiscardDraft?.(d.id)}>×</button>
          </div>)}
        </div>}
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
              <button className="library-close" title="Açık sekmesini kapat; kayıt depoda kalır" disabled={locked || !openCount} onClick={() => p.onCloseCanvas(c.id)}>Kapat{openCount > 1 ? ` (${openCount})` : ''}</button>
              <button className="library-mini library-delete" title={`“${c.name}” tuvalini depodan sil`} disabled={locked} onClick={() => p.onDeleteCanvas(c.id)}>×</button>
            </li>
          })}
        </ul>
      </>}
      {view === 'automations' && <>
        <div className="library-view-heading"><h3>Otomasyonlar</h3><button className="xp-btn" disabled={locked} onClick={() => void choose()}>+ Yeni</button></div>
        {p.onSaveSequence && <button className="xp-btn" disabled={locked || !p.tabs.length} onClick={p.onSaveSequence}>Açık Sırayı Kaydet</button>}
        {!p.library.automations.length && <p className="hint">Yeni otomasyon oluştur ve depodan tuvaller ekle. Kaydet ile listeyi sakla.</p>}
        {p.library.automations.map(a => <div className={`automation-card${editor?.id === a.id ? ' selected' : ''}`} key={a.id}>
          <div className="automation-name-row"><strong title={a.name}>{a.name}</strong><span>{a.entries.length} tuval</span>
            <button className="library-mini library-delete" title={`“${a.name}” otomasyonunu sil`} disabled={locked} onClick={() => p.onDeleteAutomation(a.id)}>×</button></div>
          <div className="automation-actions">
            <button className="xp-btn" disabled={locked} onClick={async () => { if (editor?.id === a.id) setCollapsed(!collapsed); else await choose(a) }}>{editor?.id === a.id && !collapsed ? 'Daralt' : 'Genişlet'}</button>
            <button className="xp-btn" disabled={locked || !a.entries.length || (editor?.id === a.id && dirty)} title="Kayıtlı sırayı üstteki çalışma sekmelerinde aç" onClick={async () => { if (await reviewDraft()) p.onOpenAutomation(a.id) }}>Aç</button>
            <button className="xp-btn" disabled={locked || (editor?.id === a.id && dirty)} onClick={() => p.onExportAutomation(a.id)}>Export</button>
          </div>
        </div>)}
        {editor && !collapsed && <div className="automation-editor">
          <label className="field-label" htmlFor="automation-name">Otomasyon adı</label>
          <input id="automation-name" className="xp-input" value={editor.name} placeholder="Otomasyon adı" maxLength={48} disabled={locked} onChange={e => { change(d => ({ ...d, name: e.target.value })); setFailed(false) }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void persist(editor) } }} />
          <div className="automation-editor-status" role="status">{pending ? 'Kaydediliyor…' : failed && dirty ? 'Değişiklik kaydedilemedi. Taslak korunuyor.' : dirty ? 'Kaydedilmemiş değişiklikler *' : 'Kayıt güncel.'}</div>
          {stale && <p className="hint library-warning">Kayıt değişti veya silindi. Düzenle ile yeniden yükle; eski taslak kaydın üzerine yazılmaz.</p>}
          {missing && <p className="hint library-warning">Listedeki bir tuval depodan silinmiş. Bu satırı çıkar veya listeyi yeniden yükle.</p>}
          <ol className="automation-canvases">
            {editor.entries.map((e, i) => {
              const c = p.library.canvases.find(c => c.id === e.canvasId)
              return <li key={e.id}>
                <span className="library-canvas-name" title={c?.name}>{i + 1}. {c?.name ?? 'Silinmiş tuval'}</span>
                <button className="library-mini" title="Tuvali yeni sekmede aç" disabled={locked || !c} onClick={() => c && p.onOpenCanvas(c)}>+</button>
                <button className="library-mini" title="Yukarı taşı" disabled={locked || stale || missing || i === 0} onClick={() => { setEditor({ ...editor, entries: editAutomationEntries(editor.entries, e.id, 'up') }); setFailed(false) }}>↑</button>
                <button className="library-mini" title="Aşağı taşı" disabled={locked || stale || missing || i === editor.entries.length - 1} onClick={() => { setEditor({ ...editor, entries: editAutomationEntries(editor.entries, e.id, 'down') }); setFailed(false) }}>↓</button>
                <button className="library-mini library-delete" title="Tuvali otomasyon listesinden çıkar" disabled={locked} onClick={() => void removeEntry(e.id)}>×</button>
              </li>
            })}
          </ol>
          <div className="automation-add-row">
            <select className="xp-input" aria-label="Depodan tuval seç" disabled={locked || !available.length} value={available.some(c => c.id === adding) ? adding : ''} onChange={e => setAdding(e.target.value)}>
              <option value="">Depodan tuval seç…</option>
              {available.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="xp-btn" disabled={locked || stale || missing || !available.some(c => c.id === adding)} onClick={() => { setEditor({ ...editor, entries: addAutomationEntry(editor.entries, adding) }); setAdding(''); setFailed(false) }}>Ekle</button>
          </div>
          {!available.length && <p className="hint">Depodaki bütün tuvaller bu listede. Yeni bir tuvali önce Tuvaller ekranında kaydet.</p>}
          <div className="automation-actions"><button className="xp-btn primary" disabled={locked || !dirty || !editor.name.trim() || stale || missing} onClick={() => void persist(editor)}>{failed && dirty ? 'Tekrar Dene' : 'Kaydet'}</button>
            <button className="xp-btn" disabled={locked || !dirty} onClick={() => void discard()}>Vazgeç</button></div>
          {stale && <button className="xp-btn" disabled={locked} onClick={async () => {
            if (dirty && !await p.onConfirm('Güncel kaydı yüklemek için otomasyon taslağındaki değişikliklerden vazgeçilsin mi?')) return
            setEditor(source ? editorFor(source) : null); setFailed(false)
          }}>Yeniden Yükle</button>}
        </div>}
      </>}
    </div>
  </section>
}
