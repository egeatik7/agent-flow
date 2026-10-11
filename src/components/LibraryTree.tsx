import { Fragment, type ReactNode, useEffect, useRef, useState, type MouseEvent } from 'react'
import type { CanvasLibrary } from '../types'
import { isArchived, type LibraryRef } from '../../electron/library-tree'
export const refKey = (ref: LibraryRef) => `${ref.kind}:${ref.id}`
export type LibraryItem = LibraryRef & { name: string; parentId?: string; folderId?: string; archived?: boolean }
export function FileIcon({ kind }: { kind: LibraryRef['kind'] }) {
 return <svg className="library-file-icon" viewBox="0 0 20 20" aria-hidden="true">{kind === 'folder' ? <><path d="M1 5V3h7l2 2h8v12H1z" fill="#dc9b29" stroke="#a26e18"/><path d="M1 7h18l-2 10H1z" fill="#ffda72" stroke="#c08a27"/><path d="M3 9h13" stroke="#fff4b0"/></> : <><path d="M4 1h8l4 4v13H4z" fill="#fff" stroke="#6984a5"/><path d="M12 1v5h4" fill="#bdd8f5" stroke="#6984a5"/><path d="M7 9h6M7 12h6M7 15h4" stroke={kind === 'automation' ? '#398a39' : '#4676ae'} strokeWidth="2"/>{kind === 'automation' && <path d="M1 11h4v4h3" fill="none" stroke="#4a9b43" strokeWidth="2"/>}</>}</svg>
}
export default function LibraryTree(p: {
 library: CanvasLibrary; mode?: 'canvas' | 'automation'; archived?: boolean; disabled?: boolean
 selected?: LibraryRef[]; onSelect?: (refs: LibraryRef[]) => void
 onOpen?: (item: LibraryItem) => void; onContext?: (e: MouseEvent, item?: LibraryItem) => void
 itemName?: (item: LibraryItem) => string
 renderAfter?: (item: LibraryItem) => ReactNode
 onMove?: (refs: LibraryRef[], parentId?: string) => void
}) {
 const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
 const [localSelected, setLocalSelected] = useState<LibraryRef[]>([])
 const selected = p.selected ?? localSelected
 const select = (refs: LibraryRef[]) => { setLocalSelected(refs); p.onSelect?.(refs) }
 const anchor = useRef('')
 const [over, setOver] = useState('')
 const items: LibraryItem[] = [ ...(p.library.folders ?? []).map(f => ({ ...f, kind: 'folder' as const })), ...(p.mode === 'automation' ? p.library.automations.map(a => ({ ...a, kind: 'automation' as const })) : p.library.canvases.map(c => ({ ...c, kind: 'canvas' as const }))) ].filter(item => isArchived(p.library, item) === !!p.archived)
 const parentOf = (item: LibraryItem) => {
  const parent = item.kind === 'folder' ? item.parentId : item.folderId
  if (p.archived && parent && !isArchived(p.library, p.library.folders?.find(f => f.id === parent) ?? {})) return undefined
  return parent
 }
 const visible: { item: LibraryItem; depth: number }[] = []
 const visit = (parent: string | undefined, depth: number) => {
  if (depth > 50) return
  const children = items.filter(i => parentOf(i) === parent).sort((a,b) => (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1) || a.name.localeCompare(b.name, 'tr', { numeric: true }))
  for (const item of children) { visible.push({ item, depth }); if (item.kind === 'folder' && expanded.has(item.id)) visit(item.id, depth + 1) }
 }; visit(undefined, 0)
 useEffect(() => { if (!p.selected) setLocalSelected(current => current.filter(r => items.some(i => refKey(i) === refKey(r)))) }, [p.library, p.mode, p.archived])
 const toggle = (id: string) => setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
 const pick = (item: LibraryItem, e: MouseEvent) => {
  const key = refKey(item)
  if (e.shiftKey && anchor.current) { const a = visible.findIndex(v => refKey(v.item) === anchor.current), b = visible.findIndex(v => refKey(v.item) === key); select(visible.slice(Math.min(a < 0 ? b : a,b),Math.max(a,b)+1).map(v => ({kind:v.item.kind,id:v.item.id}))) }
  else if (e.ctrlKey || e.metaKey) { select(selected.some(r => refKey(r) === key) ? selected.filter(r => refKey(r) !== key) : [...selected, {kind:item.kind,id:item.id}]); anchor.current = key }
  else { select([{kind:item.kind,id:item.id}]); anchor.current = key }
 }
 const drop = (e: React.DragEvent, parentId?: string) => {
  e.preventDefault(); e.stopPropagation(); setOver(''); if (p.disabled) return
  try { const refs = JSON.parse(e.dataTransfer.getData('application/x-nubbo-library')) as LibraryRef[]; if (Array.isArray(refs) && refs.length) p.onMove?.(refs, parentId) } catch { /* Other drag sources are ignored. */ }
 }
 return <div className="library-tree" role="tree" aria-label={p.mode === 'automation' ? 'Otomasyon klasörleri' : 'Tuval klasörleri'} onContextMenu={e => { e.preventDefault(); p.onContext?.(e) }}
  onDragOver={e => { if (p.onMove && !p.disabled) {e.preventDefault(); e.dataTransfer.dropEffect='move'} }} onDrop={e => drop(e)}>
  {!visible.length && <div className="library-empty">{p.archived ? 'Arşiv boş.' : 'Sağ tıkla bir klasör veya tuval oluştur.'}</div>}
  {visible.map(({item,depth}) => {
   const key=refKey(item), active=selected.some(r=>refKey(r)===key), folder=item.kind==='folder'
   return <Fragment key={key}><div role="treeitem" aria-selected={active} aria-expanded={folder ? expanded.has(item.id) : undefined} aria-level={depth+1} tabIndex={active || (!selected.length && visible[0]?.item === item) ? 0 : -1}
    className={`library-tree-row${active ? ' selected' : ''}${over === key ? ' drop-target' : ''}`} style={{paddingLeft:depth*15+4}} draggable={!!p.onMove && !p.disabled}
    onClick={e=>pick(item,e)} onDoubleClick={()=>{if(!p.disabled)folder ? toggle(item.id) : p.onOpen?.(item)}}
    onKeyDown={e=>{const i=visible.findIndex(v=>refKey(v.item)===key); if(e.key==='Enter'){if(!p.disabled)folder ? toggle(item.id) : p.onOpen?.(item)} else if(e.key==='ArrowRight'&&folder){setExpanded(s=>new Set([...s,item.id]))} else if(e.key==='ArrowLeft'&&folder){setExpanded(s=>{const n=new Set(s);n.delete(item.id);return n})} else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const next=visible[Math.max(0,Math.min(visible.length-1,i+(e.key==='ArrowDown'?1:-1)))];select([{kind:next.item.kind,id:next.item.id}]);(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role=treeitem]')[visible.indexOf(next)])?.focus()} }}
    onContextMenu={e=>{e.preventDefault();e.stopPropagation();if(!active)select([{kind:item.kind,id:item.id}]);p.onContext?.(e,item)}}
    onDragStart={e=>{const refs=active?selected:[{kind:item.kind,id:item.id}];select(refs);e.dataTransfer.setData('application/x-nubbo-library',JSON.stringify(refs));e.dataTransfer.effectAllowed='move'}}
    onDragOver={e=>{if(folder&&p.onMove&&!p.disabled){e.preventDefault();e.stopPropagation();setOver(key);e.dataTransfer.dropEffect='move'}}} onDragLeave={()=>setOver('')}
    onDrop={e=>{if(folder)drop(e,item.id);else{e.preventDefault();e.stopPropagation()}}}>
    <button type="button" className={`tree-expander${!folder?' empty':''}`} tabIndex={-1} aria-label={folder ? `${expanded.has(item.id)?'Daralt':'Genişlet'} ${item.name}` : undefined} onClick={e=>{e.stopPropagation();if(folder)toggle(item.id)}}>{folder?(expanded.has(item.id)?'−':'+'):''}</button>
    <FileIcon kind={item.kind}/><span className="library-tree-name" title={item.name}>{p.itemName?.(item) ?? item.name}</span>
   </div>{p.renderAfter?.(item)} </Fragment>
  })}
 </div>
}
