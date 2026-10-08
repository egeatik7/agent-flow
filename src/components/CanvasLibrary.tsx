import { useState } from 'react'
import type { CanvasLibrary as Library, SavedCanvas } from '../types'
type Props = {
  library: Library; disabled: boolean
  onSaveCanvas: () => void
  onOpenCanvas: (canvas: SavedCanvas, link: boolean) => void
  onDeleteCanvas: (id: string) => void
  onCreateAutomation: (name: string) => void
  onOpenAutomation: (id: string) => void
  onSaveAutomation: (id: string) => void
  onRenameAutomation: (id: string, name: string) => void
  onDeleteAutomation: (id: string) => void
  onExportAutomation: (id: string) => void
  onEditAutomationCanvas: (automationId: string, canvasId: string, action: 'delete' | 'up' | 'down') => void
}
export default function CanvasLibrary(p: Props) {
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const create = () => {
    if (p.disabled || !newName.trim()) return
    p.onCreateAutomation(newName); setNewName('')
  }
  const rename = () => {
    if (!editing || p.disabled || !draft.trim()) return
    p.onRenameAutomation(editing, draft); setEditing(null)
  }
  return <section className="canvas-library" aria-label="Tuvaller">
    <div className="panel-header"><span>Tuvaller</span><button className="xp-btn" disabled={p.disabled} onClick={p.onSaveCanvas}>Tuvali Kaydet</button></div>
    <div className="canvas-library-scroll">
      <h3>Otomasyonlar</h3>
      <div className="automation-create">
        <input className="xp-input" aria-label="Yeni otomasyon adı" placeholder="Yeni otomasyon adı" value={newName} maxLength={48} disabled={p.disabled} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); create() } }} />
        <button className="xp-btn" disabled={p.disabled || !newName.trim()} onClick={create} title="Açık sekmelerin sırasını ve içeriklerini kaydet">+ Kaydet</button>
      </div>
      {!p.library.automations.length && <p className="hint">Açık sekmelerin soldan sağa sırasını bir otomasyon olarak kaydet.</p>}
      {p.library.automations.map(a => <div className="automation-card" key={a.id}>
        <div className="automation-name-row">
          {editing === a.id ? <>
            <input className="xp-input" aria-label="Otomasyon adı" value={draft} maxLength={48} disabled={p.disabled} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); rename() } if (e.key === 'Escape') setEditing(null) }} />
            <button className="xp-btn" disabled={p.disabled || !draft.trim()} onClick={rename} title="Adı kaydet">✓</button>
          </> : <><strong title={a.name}>{a.name}</strong><button className="library-mini" title={`“${a.name}” adını değiştir`} disabled={p.disabled} onClick={() => { setEditing(a.id); setDraft(a.name) }}>✎</button></>}
          <button className="library-mini library-delete" title={`“${a.name}” otomasyonunu sil`} disabled={p.disabled} onClick={() => p.onDeleteAutomation(a.id)}>×</button>
        </div>
        <div className="automation-actions">
          <button className="xp-btn" disabled={p.disabled || !a.canvases.length} onClick={() => p.onOpenAutomation(a.id)} title="Kayıtlı tuval listesini üstte aç">Aç</button>
          <button className="xp-btn" disabled={p.disabled} onClick={() => p.onSaveAutomation(a.id)} title="Bu otomasyonu açık sekmelerle güncelle">Kaydet</button>
          <button className="xp-btn" disabled={p.disabled} onClick={() => p.onExportAutomation(a.id)}>Export</button>
          <span>{a.canvases.length} tuval</span>
        </div>
        <ol className="automation-canvases">
          {a.canvases.map((c, i) => <li key={c.id}>
            <span className="library-canvas-name" title={c.name}>{i + 1}. {c.name}</span>
            <button className="library-mini" title={`“${c.name}” tuvalini yeni sekmede aç`} disabled={p.disabled} onClick={() => p.onOpenCanvas(c, false)}>+</button>
            <button className="library-mini" title="Yukarı taşı" disabled={p.disabled || i === 0} onClick={() => p.onEditAutomationCanvas(a.id, c.id, 'up')}>↑</button>
            <button className="library-mini" title="Aşağı taşı" disabled={p.disabled || i === a.canvases.length - 1} onClick={() => p.onEditAutomationCanvas(a.id, c.id, 'down')}>↓</button>
            <button className="library-mini library-delete" title={`“${c.name}” tuvalini otomasyondan sil`} disabled={p.disabled} onClick={() => p.onEditAutomationCanvas(a.id, c.id, 'delete')}>×</button>
          </li>)}
        </ol>
      </div>)}
      <h3>Kayıtlı Tuvaller</h3>
      {!p.library.canvases.length && <p className="hint">Tuvali Kaydet ile bu listeye ekle. JSON dosyaları İçe Aktar ile eklenir.</p>}
      <ul className="saved-canvases">
        {p.library.canvases.map(c => <li key={c.id}>
          <span className="library-canvas-name" title={c.name}>{c.name}</span>
          <button className="library-mini" title={`“${c.name}” tuvalini yeni sekmede aç`} disabled={p.disabled} onClick={() => p.onOpenCanvas(c, true)}>+</button>
          <button className="library-mini library-delete" title={`“${c.name}” kayıtlı tuvalini sil`} disabled={p.disabled} onClick={() => p.onDeleteCanvas(c.id)}>×</button>
        </li>)}
      </ul>
    </div>
  </section>
}
