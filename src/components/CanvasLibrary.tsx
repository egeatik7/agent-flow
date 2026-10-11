import { useEffect, useRef, useState, type SetStateAction } from 'react'
import { newId, type CanvasLibrary as Library, type CanvasAutomation, type CanvasTab, type SavedCanvas, type AutomationEditor, type RecoveredCanvas } from '../types'
import { addAutomationEntry, automationDraftDirty, editAutomationEntries, type AutomationDraft } from '../../electron/canvas-library'
import { createPortal } from 'react-dom'
import LibraryTree, { FileIcon, refKey, type LibraryItem } from './LibraryTree'
import WorkspaceNameDialog from './WorkspaceNameDialog'
import { type LibraryRef, type LibraryChange } from '../../electron/library-tree'
import type { SaveDecision } from '../../electron/canvas-session'
type Props = {
  directory?: string
  onLibraryChange?: (change: LibraryChange) => Promise<boolean>
  onManageLibrary?: (mode: 'open' | 'copy' | 'backup' | 'restore' | 'reveal') => void
  onNewCanvas?: (folderId?: string) => void
  onDuplicateCanvas?: (id: string) => void
  onExportCanvas?: (id: string) => void
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
  const [archived, setArchived] = useState(false)
  const [selection, setSelection] = useState<LibraryRef[]>([])
  const [menu, setMenu] = useState<{x:number;y:number;item?:LibraryItem;entryId?:string;automation?:CanvasAutomation} | null>(null)
  const [question, setQuestion] = useState<{title:string;initial:string;answer:(name:string)=>void} | null>(null)
  const [pickerArchived, setPickerArchived] = useState(false)
  const [picker, setPicker] = useState(false)
  const [pickerRefs, setPickerRefs] = useState<LibraryRef[]>([])
  useEffect(()=>{if(!picker)return;const dialog=document.querySelector<HTMLElement>('.library-canvas-picker');const before=document.activeElement as HTMLElement|null;dialog?.querySelector<HTMLElement>('[role=treeitem],button')?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();setPicker(false)}if(e.key==='Tab'&&dialog){const nodes=Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]'));const at=nodes.indexOf(document.activeElement as HTMLElement);e.preventDefault();nodes[(at+(e.shiftKey?-1:1)+nodes.length)%nodes.length]?.focus()}};window.addEventListener('keydown',key);return()=>{window.removeEventListener('keydown',key);before?.focus()}},[picker])
  useEffect(()=>{if(!menu)return;const close=(e:PointerEvent)=>{if(!(e.target as Element)?.closest('.library-context-menu'))setMenu(null)};const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenu(null)};window.addEventListener('pointerdown',close);window.addEventListener('keydown',key);return()=>{window.removeEventListener('pointerdown',close);window.removeEventListener('keydown',key)}},[menu])
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

  const choose = async (automation?: CanvasAutomation, folderId?: string) => {
    if (locked || busy.current) return
    if (!await reviewDraft()) return
    if (automation) setEditor(editorFor(automation))
    else {
      let n = 1
      while (p.library.automations.some(a => a.name === `Otomasyon ${n}`)) n++
      setEditor({ key: newId(), name: `Otomasyon ${n}`, folderId, entries: [] })
    }
    setCollapsed(false)
    setView('automations')
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
      if (saved) { setEditor(editorFor(saved)); return true }
      setFailed(true); return false
    } catch { setFailed(true); return false
    } finally { busy.current = false; setPending(false) }
  }
  const removeEntry = async (id: string) => {
    if (!editor || locked || busy.current) return
    setEditor({ ...editor, entries: editAutomationEntries(editor.entries, id, 'delete') })
    setFailed(false)
  }
  const reviewDraft = async (): Promise<boolean> => {
    if (question) return false
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

  const context = (e: React.MouseEvent, item?:LibraryItem, entryId?:string, automation?:CanvasAutomation) => {
    e.preventDefault(); e.stopPropagation(); if(locked)return
    setMenu({x:Math.max(0,Math.min(e.clientX,window.innerWidth-242)),y:Math.max(0,Math.min(e.clientY,window.innerHeight-330)),item,entryId,automation})
  }
  const askName = (title:string,initial:string,answer:(name:string)=>void) => {setMenu(null);setQuestion({title,initial,answer})}
  const action = (fn:()=>void) => {setMenu(null);fn()}
  const refs = menu?.item ? (selection.some(r=>refKey(r)===refKey(menu.item!))?selection:[{kind:menu.item.kind,id:menu.item.id}]) : selection
  const parent = menu?.item?.kind==='folder' ? menu.item.id : menu?.item?.folderId
  const addPicked = () => {
    if(!editor || locked || stale || missing)return
    let entries=editor.entries
    for(const ref of pickerRefs)if(ref.kind==='canvas' && p.library.canvases.some(c=>c.id===ref.id))entries=addAutomationEntry(entries,ref.id)
    setEditor({...editor,entries});setPicker(false);setPickerRefs([]);setFailed(false)
  }
  const editView = editor && !collapsed ? <div className="automation-editor">
    <div className="automation-editor-status" role="status">{pending?'Kaydediliyor…':failed?'Değişiklik kaydedilemedi. Taslak korunuyor.':dirty?'Kaydedilmemiş değişiklikler *':`Kayıt güncel. ${editor.entries.length} tuval`}</div>
    {stale && <p className="hint library-warning">Kayıt değişti veya silindi. Sağ tıktan yeniden yükle.</p>}
    {missing && <p className="hint library-warning">Bir tuval silinmiş; sağ tıktan satırı çıkar.</p>}
    <ol className="automation-canvases">
      {editor.entries.map((e,i)=>{const c=p.library.canvases.find(c=>c.id===e.canvasId);return <li key={e.id} tabIndex={0} className="automation-entry" onDoubleClick={()=>!locked&&c&&p.onOpenCanvas(c)} onContextMenu={event=>context(event,undefined,e.id)}
        draggable={!locked&&!stale&&!missing} onDragStart={event=>event.dataTransfer.setData('application/x-nubbo-entry',e.id)} onDragOver={event=>{if(!locked)event.preventDefault()}} onDrop={event=>{event.preventDefault();if(locked||stale||missing)return;const id=event.dataTransfer.getData('application/x-nubbo-entry');const from=editor.entries.findIndex(v=>v.id===id);if(from<0)return;const entries=[...editor.entries];const [moved]=entries.splice(from,1);entries.splice(i,0,moved);setEditor({...editor,entries})}}>
        <span className="automation-entry-number">{i+1}.</span><FileIcon kind="canvas"/><span className="library-canvas-name">{c?.name??'Silinmiş tuval'}</span></li>})}
    </ol>
    <div className="automation-editor-footer"><button className="xp-btn" disabled={locked||stale||missing} onClick={()=>{setPicker(true);setPickerRefs([])}}>Tuval Ekle…</button><button className="xp-btn primary" disabled={locked||!dirty||stale||missing||!editor.name.trim()} onClick={()=>void persist(editor)}>{failed&&dirty?'Tekrar Dene':'Kaydet'}</button></div>
  </div>:null
  const autoCard = (a?:CanvasAutomation) => {
    const active=a?editor?.id===a.id:!!editor&&!editor.id
    const title=active?editor!.name:a!.name
    return <div className={`automation-card${active?' selected':''}`} key={a?.id??'new'} onContextMenu={e=>context(e,undefined,undefined,a)}>
      <button type="button" className="automation-header" disabled={locked} onClick={async()=>{if(active)setCollapsed(!collapsed);else if(a)await choose(a)}}><span className="automation-disclosure">{active&&!collapsed?'−':'+'}</span><FileIcon kind="automation"/><strong title={title}>{title}</strong>{active&&dirty&&<span>*</span>}</button>
      {active&&editView}
    </div>
  }
  return <section className="canvas-library" aria-label="Tuval kütüphanesi ve otomasyonlar" onContextMenu={e=>context(e)}>
    <div className="library-views" role="tablist" aria-label="Tuval yönetimi"><button className={`xp-btn ${view==='canvases'?'primary':''}`} role="tab" aria-selected={view==='canvases'} onClick={()=>{setView('canvases');setSelection([])}}>Tuvaller</button><button className={`xp-btn ${view==='automations'?'primary':''}`} role="tab" aria-selected={view==='automations'} onClick={()=>{setView('automations');setSelection([])}}>Otomasyonlar</button></div>
    <div className="library-explorer-toolbar"><button className="xp-btn" onClick={()=>{setArchived(false);setSelection([])}} aria-pressed={!archived}>Kütüphane</button><button className="xp-btn" onClick={()=>{setArchived(true);setSelection([])}} aria-pressed={archived}>Arşiv</button><span title={p.directory||'Kütüphane'}>{p.directory?.split(/[\\/]/).slice(-1)[0]||'Nubbo'}</span></div>
    <div className="canvas-library-scroll" onContextMenu={e=>context(e)}>
      {view==='canvases'&&!!p.recovery?.length&&<div className="workspace-recovery"><h3>Kurtarılan çalışmalar</h3>{p.recovery.map(d=><div className="workspace-recovery-row" key={d.id}><span>{d.name}</span><button className="xp-btn" disabled={locked} onClick={()=>p.onRestoreDraft?.(d.id)}>Taslağı Aç</button><button className="xp-btn" disabled={locked} onClick={()=>p.onDiscardDraft?.(d.id)}>Sil</button></div>)}</div>}
      <LibraryTree library={p.library} mode={view==='canvases'?'canvas':'automation'} archived={archived} disabled={locked} selected={selection} onSelect={setSelection} onContext={(e,item)=>context(e,item)} onMove={(refs,parentId)=>void p.onLibraryChange?.({action:'move',refs,parentId})} onOpen={item=>{if(item.kind==='canvas'){const c=p.library.canvases.find(c=>c.id===item.id);if(c)p.onOpenCanvas(c)}else if(item.kind==='automation'){const a=p.library.automations.find(a=>a.id===item.id);if(a){if(editor?.id===a.id)setCollapsed(!collapsed);else void choose(a)}}}} itemName={item=>item.kind==='automation'&&editor?.id===item.id?editor.name+(dirty?' *':''):item.name} renderAfter={item=>view==='automations'&&editor?.id===item.id&&!collapsed?<div className="automation-editor-attached">{editView}</div>:null}/>
      {view==='automations'&&<div className="automation-expanded-area">
        {editor&&!editor.id&&autoCard()}

      </div>}
    </div>
    <div className="library-statusbar">{archived?'Arşiv':'Kütüphane'} · {selection.length?`${selection.length} öğe seçili`:'Sağ tık: işlemler'}</div>
    {menu&&createPortal(<div className="library-context-menu" role="menu" style={{left:menu.x,top:menu.y}}><fieldset disabled={locked} style={{border:0,padding:0,margin:0}}>
      {menu.entryId ? <>
        <button role="menuitem" onClick={()=>action(()=>{const c=p.library.canvases.find(c=>c.id===editor?.entries.find(e=>e.id===menu.entryId)?.canvasId);if(c)p.onOpenCanvas(c)})}>Tuvali Aç</button>
        <button role="menuitem" onClick={()=>action(()=>editor&&setEditor({...editor,entries:editAutomationEntries(editor.entries,menu.entryId!,'up')}))}>Yukarı Taşı</button>
        <button role="menuitem" onClick={()=>action(()=>editor&&setEditor({...editor,entries:editAutomationEntries(editor.entries,menu.entryId!,'down')}))}>Aşağı Taşı</button>
        <button role="menuitem" onClick={()=>action(()=>void removeEntry(menu.entryId!))}>Listeden Çıkar</button>
      </> : <>
        {menu.item?.kind==='canvas'&&<><button role="menuitem" onClick={()=>action(()=>{const c=p.library.canvases.find(c=>c.id===menu.item!.id);if(c)p.onOpenCanvas(c)})}>Aç</button><button role="menuitem" onClick={()=>askName('Tuvali Yeniden Adlandır',menu.item!.name,name=>void p.onRenameCanvas(menu.item!.id,name))}>Yeniden Adlandır…</button><button role="menuitem" onClick={()=>action(()=>p.onDuplicateCanvas?.(menu.item!.id))}>Çoğalt</button><button role="menuitem" onClick={()=>action(()=>p.onExportCanvas?.(menu.item!.id))}>Dışa Aktar…</button><button role="menuitem" onClick={()=>action(()=>p.onCloseCanvas(menu.item!.id))}>Açık Sekmesini Kapat</button><button role="menuitem" onClick={()=>action(()=>p.onDeleteCanvas(menu.item!.id))}>Sil…</button><hr/></>}
        {(menu.item?.kind==='automation'||menu.automation||(!menu.item&&editor))&&<>
          <button role="menuitem" onClick={()=>action(()=>{const a=p.library.automations.find(a=>a.id===(menu.item?.id??menu.automation?.id??editor?.id));if(a)void choose(a)})}>Düzenle / Genişlet</button><button role="menuitem" disabled={dirty} onClick={()=>action(()=>{const id=menu.item?.id??menu.automation?.id??editor?.id;if(id)p.onOpenAutomation(id)})}>Otomasyonu Aç</button>
          <button role="menuitem" onClick={()=>askName('Otomasyonu Yeniden Adlandır',menu.item?.name??menu.automation?.name??editor?.name??'',async name=>{const id=menu.item?.id??menu.automation?.id??editor?.id;const a=p.library.automations.find(a=>a.id===id);if(id&&editor?.id!==id&&a){if(await reviewDraft())setEditor({...editorFor(a),name})}else change(e=>({...e,name}))})}>Yeniden Adlandır…</button>
          <button role="menuitem" onClick={()=>action(()=>{if(editor)void persist(editor)})}>Değişiklikleri Kaydet</button><button role="menuitem" onClick={()=>action(()=>void discard())}>Değişikliklerden Vazgeç…</button>
          <button role="menuitem" disabled={dirty} onClick={()=>action(()=>{const id=menu.item?.id??menu.automation?.id??editor?.id;if(id)p.onExportAutomation(id)})}>Dışa Aktar…</button>
          <button role="menuitem" onClick={()=>action(()=>{const id=menu.item?.id??menu.automation?.id??editor?.id;if(id)p.onDeleteAutomation(id)})}>Sil…</button>
          {stale&&<button role="menuitem" onClick={()=>action(()=>void(async()=>{if(!dirty||await p.onConfirm('Güncel kaydı yüklemek için taslaktan vazgeçilsin mi?')){setEditor(source?editorFor(source):null);setFailed(false)}})())}>Yeniden Yükle</button>}<hr/>
        </>}
        {menu.item?.kind==='folder'&&<><button role="menuitem" onClick={()=>askName('Klasörü Yeniden Adlandır',menu.item!.name,name=>void p.onLibraryChange?.({action:'renameFolder',id:menu.item!.id,name}))}>Yeniden Adlandır…</button><button role="menuitem" onClick={()=>action(()=>void p.onLibraryChange?.({action:'deleteFolder',id:menu.item!.id}))}>Boş Klasörü Sil</button><hr/></>}
        {refs.length>0&&<><button role="menuitem" onClick={()=>action(()=>void p.onLibraryChange?.({action:'archive',refs,archived:!archived}))}>{archived?'Arşivden Geri Al':'Arşivle'}</button><button role="menuitem" onClick={()=>action(()=>void p.onLibraryChange?.({action:'move',refs,parentId:undefined}))}>Ana Klasöre Taşı</button><hr/></>}
        <button role="menuitem" onClick={()=>askName('Yeni Klasör','Yeni Klasör',name=>void p.onLibraryChange?.({action:'newFolder',name,parentId:parent}))}>Yeni Klasör…</button>
        <button role="menuitem" onClick={()=>action(()=>p.onNewCanvas?.(parent))}>Yeni Tuval</button>
        <button role="menuitem" onClick={()=>action(()=>void choose(undefined,parent))}>Yeni Otomasyon</button>
        {p.hasCanvas&&<button role="menuitem" onClick={()=>action(p.onSaveCanvas)}>Açık Tuvali Kaydet</button>}
        {p.onSaveSequence&&<button role="menuitem" onClick={()=>action(p.onSaveSequence!)}>Açık Sırayı Otomasyon Kaydet…</button>}
        {p.onSaveAll&&<button role="menuitem" onClick={()=>action(p.onSaveAll!)}>Tümünü Kaydet</button>}
        {p.onManageLibrary&&<><hr/>{([['reveal','Kütüphane Klasörünü Aç'],['open','Başka Kütüphane Aç…'],['copy','Farklı Klasöre Kaydet…'],['backup','Kütüphaneyi Yedekle'],['restore','Yedekten Geri Yükle…']]as const).map(([mode,label])=><button role="menuitem" key={mode} onClick={()=>action(()=>p.onManageLibrary?.(mode))}>{label}</button>)}</>}
      </>}
    </fieldset></div>,document.body)}
    {question&&<WorkspaceNameDialog title={question.title} initial={question.initial} onAnswer={name=>{const answer=question.answer;setQuestion(null);if(name!==null)answer(name)}}/>}
    {picker&&createPortal(<div className="modal-backdrop"><div className="xp-dialog library-canvas-picker" role="dialog" aria-modal="true" aria-label="Otomasyona Tuval Ekle"><div className="xp-dialog-title">Otomasyona Tuval Ekle</div><div className="library-picker-body"><div className="library-explorer-toolbar"><button className="xp-btn" onClick={()=>{setPickerArchived(false);setPickerRefs([])}}>Kütüphane</button><button className="xp-btn" onClick={()=>{setPickerArchived(true);setPickerRefs([])}}>Arşiv</button></div><LibraryTree archived={pickerArchived} library={{...p.library,canvases:available}} selected={pickerRefs} onSelect={setPickerRefs}/><div className="workspace-picker-actions"><button className="xp-btn" disabled={!pickerRefs.some(r=>r.kind==='canvas')} onClick={addPicked}>Ekle</button><button className="xp-btn" onClick={()=>setPicker(false)}>İptal</button></div></div></div></div>,document.body)}
  </section>
}
