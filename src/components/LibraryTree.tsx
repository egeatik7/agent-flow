import { Fragment, type ReactNode, useEffect, useRef, useState, type MouseEvent } from 'react'
import type { CanvasLibrary } from '../types'
import { isArchived, type LibraryRef } from '../../electron/library-tree'
export const refKey = (ref: LibraryRef) => `${ref.kind}:${ref.id}`
export type LibraryItem = LibraryRef & { name: string; parentId?: string; folderId?: string; archived?: boolean }
export function FileIcon({ kind }: { kind: LibraryRef['kind'] }) {
 return <svg className="library-file-icon" viewBox="0 0 20 20" aria-hidden="true">{kind === 'folder' ? <><path d="M1 5V3h7l2 2h8v12H1z" fill="#dc9b29" stroke="#a26e18"/><path d="M1 7h18l-2 10H1z" fill="#ffda72" stroke="#c08a27"/><path d="M3 9h13" stroke="#fff4b0"/></> : <><path d="M4 1h8l4 4v13H4z" fill="#fff" stroke="#6984a5"/><path d="M12 1v5h4" fill="#bdd8f5" stroke="#6984a5"/><path d="M7 9h6M7 12h6M7 15h4" stroke={kind === 'automation' ? '#398a39' : '#4676ae'} strokeWidth="2"/>{kind === 'automation' && <path d="M1 11h4v4h3" fill="none" stroke="#4a9b43" strokeWidth="2"/>}</>}</svg>
}
export default function LibraryTree(p: {
 library: CanvasLibrary; mode?: 'canvas' | 'automation'; archived?: boolean; disabled?: boolean; touch?:boolean
 selected?: LibraryRef[]; onSelect?: (refs: LibraryRef[]) => void
 onOpen?: (item: LibraryItem) => void; onContext?: (e: MouseEvent, item?: LibraryItem) => void
 itemName?: (item: LibraryItem) => string
 renderAfter?: (item: LibraryItem) => ReactNode
 reveal?: LibraryRef; draftId?:string
 onMove?: (refs: LibraryRef[], parentId?: string) => void
}) {
 const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
 const [localSelected, setLocalSelected] = useState<LibraryRef[]>([])
 const selected = p.selected ?? localSelected
 const select = (refs: LibraryRef[]) => { setLocalSelected(refs); p.onSelect?.(refs) }
 const anchor = useRef('')
 const [over, setOver] = useState('')
 const tree=useRef<HTMLDivElement>(null),cleanup=useRef<(()=>void)|undefined>(undefined),expandTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),dragging=useRef<LibraryRef[]>([])
 const [box,setBox]=useState<{x:number;y:number;w:number;h:number}|null>(null)
 useEffect(()=>()=>{cleanup.current?.();clearTimeout(expandTimer.current)},[])
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
 useEffect(() => {const next=selected.filter(r=>items.some(i=>refKey(i)===refKey(r)));if(next.length!==selected.length)select(next)}, [p.library, p.mode, p.archived])
 useEffect(()=>{const item=items.find(i=>i.id===p.reveal?.id&&i.kind===p.reveal.kind);if(!item)return;const parents:string[]=[];let at=parentOf(item);while(at&&!parents.includes(at)){parents.push(at);at=p.library.folders?.find(f=>f.id===at)?.parentId}setExpanded(current=>parents.every(id=>current.has(id))?current:new Set([...current,...parents]))},[p.reveal?.id,p.reveal?.kind,p.library.folders,p.mode,p.archived])
 const toggle = (id: string) => setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
 const pick = (item: LibraryItem, e: MouseEvent) => {
  const key = refKey(item)
  if (e.shiftKey && anchor.current) { const a = visible.findIndex(v => refKey(v.item) === anchor.current), b = visible.findIndex(v => refKey(v.item) === key); select(visible.slice(Math.min(a < 0 ? b : a,b),Math.max(a,b)+1).map(v => ({kind:v.item.kind,id:v.item.id}))) }
  else if (e.ctrlKey || e.metaKey) { select(selected.some(r => refKey(r) === key) ? selected.filter(r => refKey(r) !== key) : [...selected, {kind:item.kind,id:item.id}]); anchor.current = key }
  else { select([{kind:item.kind,id:item.id}]); anchor.current = key }
 }
 const drop = (e: React.DragEvent, parentId?: string) => {
  e.preventDefault(); e.stopPropagation(); setOver('');clearTimeout(expandTimer.current); if (p.disabled) return
  try { const refs = JSON.parse(e.dataTransfer.getData('application/x-nubbo-library')) as LibraryRef[]; if (Array.isArray(refs) && refs.length && refs.every(r=>items.some(i=>refKey(i)===refKey(r))&&r.id!==p.draftId)) {if(parentId)setExpanded(s=>new Set([...s,parentId]));p.onMove?.(refs, parentId)} } catch { /* Other drag sources are ignored. */ }
  dragging.current=[]
 }
 const marquee=(e:MouseEvent)=>{
  if(p.touch||p.disabled||e.button!==0||(e.target as Element).closest('[role=treeitem],button,input,.automation-editor'))return
  e.preventDefault();cleanup.current?.();const el=tree.current!;el.focus({preventScroll:true});const point=(x:number,y:number)=>{const r=el.getBoundingClientRect();return{x:x-r.left+el.scrollLeft,y:y-r.top+el.scrollTop}},start=point(e.clientX,e.clientY),base=e.ctrlKey||e.metaKey||e.shiftKey?selected:[];let moved=false
  const move=(ev:globalThis.MouseEvent)=>{const end=point(ev.clientX,ev.clientY);if(!moved&&Math.hypot(end.x-start.x,end.y-start.y)<4)return;moved=true;const bounds={x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),w:Math.abs(end.x-start.x),h:Math.abs(end.y-start.y)};setBox(bounds);const r=el.getBoundingClientRect(),hits:LibraryRef[]=[];for(const row of Array.from(el.querySelectorAll<HTMLElement>('[role=treeitem]'))){const rr=row.getBoundingClientRect(),x=rr.left-r.left+el.scrollLeft,y=rr.top-r.top+el.scrollTop;if(x<bounds.x+bounds.w&&x+rr.width>bounds.x&&y<bounds.y+bounds.h&&y+rr.height>bounds.y){const item=items.find(i=>refKey(i)===row.dataset.libraryKey);if(item)hits.push({kind:item.kind,id:item.id})}}select([...new Map([...base,...hits].map(ref=>[refKey(ref),ref])).values()])}
  const done=()=>{if(!moved)select(base);setBox(null);window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',done);cleanup.current=undefined}
  cleanup.current=()=>{window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',done)};window.addEventListener('mousemove',move);window.addEventListener('mouseup',done)
 }
 const accepts=(e:React.DragEvent)=>p.onMove&&!p.disabled&&(dragging.current.length||Array.from(e.dataTransfer.types??[]).includes('application/x-nubbo-library'))
 return <div ref={tree} tabIndex={0} className={`library-tree${over==='@root'?' root-drop-target':''}`} role="tree" aria-multiselectable="true" aria-label={p.mode === 'automation' ? 'Otomasyon klasörleri' : 'Tuval klasörleri'} onContextMenu={e => { e.preventDefault(); p.onContext?.(e) }} onMouseDown={marquee}
  onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();e.stopPropagation();select(visible.map(({item})=>({kind:item.kind,id:item.id}))) }if(e.key==='Escape'){e.stopPropagation();select([])}}}
  onDragOver={e => { if (accepts(e)) {e.preventDefault();e.dataTransfer.dropEffect='move';setOver('@root')} }} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOver('')}} onDrop={e => drop(e)}>
  {!visible.length && <div className="library-empty">{p.archived ? 'Arşiv boş.' : p.touch ? 'Kütüphane boş.' : 'Sağ tıkla bir klasör veya tuval oluştur.'}</div>}
  {visible.map(({item,depth}) => {
   const key=refKey(item), active=selected.some(r=>refKey(r)===key), folder=item.kind==='folder'
   return <Fragment key={key}><div role="treeitem" data-library-key={key} aria-selected={active} aria-expanded={folder ? expanded.has(item.id) : undefined} aria-level={depth+1} tabIndex={active || (!selected.length && visible[0]?.item === item) ? 0 : -1}
    className={`library-tree-row${active ? ' selected' : ''}${over === key ? ' drop-target' : ''}${item.id===p.draftId?' draft':''}`} style={{paddingLeft:depth*15+4}} draggable={!!p.onMove && !p.disabled && item.id!==p.draftId}
    onClick={e=>{e.currentTarget.focus({preventScroll:true});pick(item,e);if(p.touch&&!p.disabled)folder?toggle(item.id):p.onOpen?.(item)}} onDoubleClick={()=>{if(!p.disabled&&!p.touch)folder ? toggle(item.id) : p.onOpen?.(item)}}
    onKeyDown={e=>{const i=visible.findIndex(v=>refKey(v.item)===key); if(e.key==='Enter'){e.stopPropagation();if(!p.disabled)folder ? toggle(item.id) : p.onOpen?.(item)} else if(e.key==='ArrowRight'&&folder){e.stopPropagation();setExpanded(s=>new Set([...s,item.id]))} else if(e.key==='ArrowLeft'&&folder){e.stopPropagation();setExpanded(s=>{const n=new Set(s);n.delete(item.id);return n})} else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();e.stopPropagation();const next=visible[Math.max(0,Math.min(visible.length-1,i+(e.key==='ArrowDown'?1:-1)))];if(e.shiftKey){if(!anchor.current)anchor.current=key;pick(next.item,e as unknown as MouseEvent)}else{select([{kind:next.item.kind,id:next.item.id}]);anchor.current=refKey(next.item)};(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role=treeitem]')[visible.indexOf(next)])?.focus()} }}
    onContextMenu={e=>{e.preventDefault();e.stopPropagation();if(!active)select([{kind:item.kind,id:item.id}]);p.onContext?.(e,item)}}
    onDragStart={e=>{if(p.disabled||item.id===p.draftId){e.preventDefault();return}const refs=(active?selected:[{kind:item.kind,id:item.id}]).filter(r=>r.id!==p.draftId);dragging.current=refs;select(refs);e.dataTransfer.setData('application/x-nubbo-library',JSON.stringify(refs));e.dataTransfer.effectAllowed='move'}} onDragEnd={()=>{dragging.current=[];setOver('');clearTimeout(expandTimer.current)}}
    onDragOver={e=>{e.stopPropagation();if(folder&&accepts(e)){e.preventDefault();if(over!==key){clearTimeout(expandTimer.current);expandTimer.current=setTimeout(()=>setExpanded(s=>new Set([...s,item.id])),600)}setOver(key);e.dataTransfer.dropEffect='move'}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node)){setOver('');clearTimeout(expandTimer.current)}}}
    onDrop={e=>{if(folder)drop(e,item.id);else{e.preventDefault();e.stopPropagation()}}}>
    <button type="button" className={`tree-expander${!folder?' empty':''}`} tabIndex={-1} aria-label={folder ? `${expanded.has(item.id)?'Daralt':'Genişlet'} ${item.name}` : undefined} onClick={e=>{e.stopPropagation();if(folder)toggle(item.id)}}>{folder?(expanded.has(item.id)?'−':'+'):''}</button>
    <FileIcon kind={item.kind}/><span className="library-tree-name" title={item.name}>{p.itemName?.(item) ?? item.name}</span>
   </div>{p.renderAfter?.(item)} </Fragment>
  })}
  {box&&<div className="library-marquee" style={{left:box.x,top:box.y,width:box.w,height:box.h}}/>}
 </div>
}
