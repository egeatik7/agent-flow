import { useEffect, useRef, useState } from 'react'
import type { RecoveredCanvas } from '../../electron/graph-types'
import type { ZipCanvasGroup, ZipLibrarySnapshot } from '../../electron/zip-library-storage'
import type { ZipLibraryAction } from '../../electron/zip-library-api'
import WorkspaceNameDialog from './WorkspaceNameDialog'
import { XpWorkspaceIcon } from './WorkspaceWelcome'

type Props = {
  library: ZipLibrarySnapshot
  disabled: boolean
  onAction: (action: ZipLibraryAction) => Promise<boolean>
  onOpenCanvas: (id: string) => void
  onOpenGroup: (id: string) => void
  onNewCanvas: (group?: ZipCanvasGroup) => void
  onSaveCanvas: (group?: ZipCanvasGroup) => void
  onManage: (mode: 'open' | 'reload' | 'reveal') => void
  onConfirm: (message: string) => Promise<boolean>
  recovery?: RecoveredCanvas[]
  onRecover?: (id: string) => void
  onDiscardRecovery?: (id: string) => void
}
type Menu = { x: number; y: number; group?: ZipCanvasGroup; canvasId?: string }
const rowKey = (groupId: string, canvasId = '') => JSON.stringify([groupId, canvasId])
export default function ZipCanvasLibrary(p: Props) {
  const [archived, setArchived] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [menu, setMenu] = useState<Menu | null>(null)
  const [question, setQuestion] = useState<{ title: string; initial: string; submit: (name: string) => void } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [working, setWorking] = useState(false)
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const anchor = useRef(''), tree = useRef<HTMLDivElement>(null), deleting = useRef(false)
  const drag = useRef<{ x: number; y: number; base: Set<string> } | null>(null)
  const disabled = p.disabled || working
  const groups = p.library.groups.filter(g => g.archived === archived)
  const visibleKeys = groups.flatMap(g => [rowKey(g.id), ...(expanded.has(g.id) && !g.problem ? g.canvases.map(c => rowKey(g.id, c.canvasId)) : [])])
  useEffect(() => {
    const valid = new Set(p.library.groups.flatMap(g => [rowKey(g.id), ...g.canvases.map(c => rowKey(g.id, c.canvasId))]))
    setSelected(before => new Set([...before].filter(key => valid.has(key))))
  }, [p.library])
  useEffect(() => {
    if (!menu) return
    const close = (event: PointerEvent) => { if (!(event.target as Element).closest('.library-context-menu')) setMenu(null) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null) }
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key) }
  }, [menu])
  const select = (key: string, event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => {
    const additive = event?.ctrlKey || event?.metaKey
    if (event?.shiftKey && visibleKeys.includes(anchor.current)) {
      const a = visibleKeys.indexOf(anchor.current), b = visibleKeys.indexOf(key)
      const range = visibleKeys.slice(Math.min(a, b), Math.max(a, b) + 1)
      setSelected(before => new Set([...(additive ? before : []), ...range]))
    } else {
      setSelected(before => { const next = new Set(additive ? before : []); if (additive && next.has(key)) next.delete(key); else next.add(key); return next })
      anchor.current = key
    }
  }
  const context = (event: React.MouseEvent, group?: ZipCanvasGroup, canvasId?: string) => {
    event.preventDefault(); if (disabled) return
    if (group && !selected.has(rowKey(group.id, canvasId))) setSelected(new Set([rowKey(group.id, canvasId)]))
    setMenu({ x: Math.min(event.clientX, Math.max(0, window.innerWidth - 250)), y: Math.min(event.clientY, Math.max(0, window.innerHeight - 380)), group, canvasId })
  }
  const toggle = (id: string) => setExpanded(before => { const next = new Set(before); next.has(id) ? next.delete(id) : next.add(id); return next })
  const act = (action: ZipLibraryAction) => { setMenu(null); if (!disabled) void p.onAction(action) }
  const reorder = (group: ZipCanvasGroup, id: string, delta: number) => {
    const order = group.canvases.map(c => c.canvasId), from = order.indexOf(id), to = from + delta
    if (from < 0 || to < 0 || to >= order.length) return
    ;[order[from], order[to]] = [order[to], order[from]]
    act({ action: 'reorder', id: group.id, revision: group.revision, order })
  }
  const removeSelection = async () => {
    if (disabled || deleting.current || !selected.size) return
    const tasks: ZipLibraryAction[] = []
    let count = 0
    for (const group of groups) {
      if (selected.has(rowKey(group.id))) { tasks.push({ action: 'deleteGroup', id: group.id, revision: group.revision }); count += group.canvases.length; continue }
      const ids = group.canvases.filter(c => selected.has(rowKey(group.id, c.canvasId))).map(c => c.canvasId)
      if (ids.length) { tasks.push({ action: 'deleteCanvases', id: group.id, canvasIds: ids, revision: group.revision }); count += ids.length }
    }
    if (!tasks.length) return
    deleting.current = true; setWorking(true); setMenu(null)
    try {
      if (!await p.onConfirm(`${count} tuval ve seçilen ZIP grupları kalıcı olarak silinsin mi? Açık çalışma sekmeleri taslak olarak korunur.`)) return
      for (const task of tasks) if (!await p.onAction(task)) return
      setSelected(new Set())
    } finally { deleting.current = false; setWorking(false) }
  }
  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0 || (event.target as Element).closest('.library-row')) return
    tree.current?.focus(); event.preventDefault()
    drag.current = { x: event.clientX, y: event.clientY, base: event.ctrlKey || event.metaKey ? new Set(selected) : new Set() }
    setSelected(drag.current.base); event.currentTarget.setPointerCapture(event.pointerId)
  }
  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !tree.current) return
    const start = drag.current, area = tree.current.getBoundingClientRect()
    const x = Math.min(start.x, event.clientX), y = Math.min(start.y, event.clientY), w = Math.abs(event.clientX - start.x), h = Math.abs(event.clientY - start.y)
    setBox({ x: x - area.left + tree.current.scrollLeft, y: y - area.top + tree.current.scrollTop, w, h })
    const keys = new Set(start.base)
    for (const row of tree.current.querySelectorAll<HTMLElement>('[data-library-key]')) {
      const r = row.getBoundingClientRect()
      if (r.right > x && r.left < x + w && r.bottom > y && r.top < y + h) keys.add(row.dataset.libraryKey!)
    }
    setSelected(keys)
  }
  const pointerEnd = () => { drag.current = null; setBox(null) }
  const create = () => setQuestion({ title: 'Yeni ZIP grubu', initial: 'Yeni Grup', submit: name => act({ action: 'create', name, archived }) })
  const g = menu?.group, c = g?.canvases.find(c => c.canvasId === menu?.canvasId), index = g?.canvases.findIndex(c => c.canvasId === menu?.canvasId) ?? -1
  return <div className="canvas-library" onContextMenu={event => context(event)}>
    <div className="library-views" role="tablist" aria-label="Kütüphane bölümleri">
      <button className="xp-btn" role="tab" disabled={working} aria-selected={!archived} onClick={() => { setArchived(false); setSelected(new Set()); setMenu(null) }}>Tuvaller</button>
      <button className="xp-btn" role="tab" disabled={working} aria-selected={archived} onClick={() => { setArchived(true); setSelected(new Set()); setMenu(null) }}>Arşiv</button>
    </div>
    <div className="library-explorer-toolbar">
      <button className="xp-btn" disabled={disabled} onClick={create}>Yeni Grup</button>
      <button className="xp-btn" disabled={disabled} onClick={() => act({ action: 'import', archived })}>ZIP Aç…</button>
      <button className="xp-btn" disabled={disabled} onClick={() => p.onSaveCanvas()}>Kaydet</button>
      <button className="xp-btn" disabled={disabled || !selected.size} onClick={() => void removeSelection()}>Sil</button>
    </div>
    <div ref={tree} className="canvas-library-scroll zip-library-tree" role="tree" tabIndex={0} aria-multiselectable="true" aria-label={archived ? 'Arşiv ZIP grupları' : 'Tuval ZIP grupları'}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}
      onKeyDown={event => { if (disabled) return; if (event.key === 'Delete') { event.preventDefault(); void removeSelection() }; if (event.key.toLowerCase() === 'a' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); setSelected(new Set(visibleKeys)) }; if (event.key === 'Escape') { setSelected(new Set()); setMenu(null) } }}>
      {groups.map(group => <div key={group.id}>
        <button className={`library-row${selected.has(rowKey(group.id)) ? ' selected' : ''}`} data-library-key={rowKey(group.id)} role="treeitem" aria-selected={selected.has(rowKey(group.id))} aria-expanded={expanded.has(group.id)} disabled={disabled}
          onClick={event => { select(rowKey(group.id), event); if (!event?.ctrlKey && !event?.metaKey && !event?.shiftKey) toggle(group.id) }} onDoubleClick={() => { if (!group.problem) p.onOpenGroup(group.id) }} onContextMenu={event => { event.stopPropagation(); context(event, group) }}>
          <span aria-hidden="true">{expanded.has(group.id) ? '▾' : '▸'}</span><XpWorkspaceIcon kind="group"/><span className="library-row-name">{group.name}.zip</span><small>{group.canvases.length} tuval</small>
        </button>
        {group.problem && <p className="field-hint warn" role="alert">{group.problem}</p>}
        {expanded.has(group.id) && !group.problem && group.canvases.map((canvas, i) => <button key={canvas.canvasId} className={`library-row${selected.has(rowKey(group.id, canvas.canvasId)) ? ' selected' : ''}`} data-library-key={rowKey(group.id, canvas.canvasId)} role="treeitem" aria-selected={selected.has(rowKey(group.id, canvas.canvasId))} style={{ paddingLeft: 30 }} disabled={disabled}
          onClick={event => select(rowKey(group.id, canvas.canvasId), event)} onDoubleClick={() => p.onOpenCanvas(canvas.canvasId)} onContextMenu={event => { event.stopPropagation(); context(event, group, canvas.canvasId) }}>
          <XpWorkspaceIcon kind="new"/><span className="library-row-name">{String(i + 1).padStart(2, '0')} · {canvas.name}</span>
        </button>)}
      </div>)}
      {!groups.length && <p className="hint">{archived ? 'Arşiv boş.' : 'Yeni bir ZIP grubu oluştur veya ZIP aç.'}</p>}
      {box && <div className="library-marquee" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
    </div>
    <div className="library-statusbar">{selected.size ? `${selected.size} öğe seçili` : 'Ctrl / Shift veya boş alandan kutu çizerek seç.'}</div>
    {!!p.recovery?.length && <details className="zip-recovery"><summary>Kurtarma taslakları ({p.recovery.length})</summary>{p.recovery.map(d => <div key={d.id}><span>{d.name}</span><button className="xp-btn" disabled={disabled} onClick={() => p.onRecover?.(d.id)}>Aç</button><button className="xp-btn" disabled={disabled} onClick={() => p.onDiscardRecovery?.(d.id)}>Sil</button></div>)}</details>}
    {menu && !disabled && <div className="library-context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
      {g && !g.problem && !c && <><button role="menuitem" disabled={!g.canvases.length} onClick={() => { setMenu(null); p.onOpenGroup(g.id) }}>Otomasyon olarak aç</button><button role="menuitem" onClick={() => { setMenu(null); p.onNewCanvas(g) }}>Yeni Tuval</button><button role="menuitem" onClick={() => { setMenu(null); p.onSaveCanvas(g) }}>Tuvali bu ZIP’e kaydet</button><button role="menuitem" onClick={() => act({ action: 'export', id: g.id, revision: g.revision })}>ZIP’i dışa aktar…</button></>}
      {g && c && <><button role="menuitem" onClick={() => { setMenu(null); p.onOpenCanvas(c.canvasId) }}>Tuvali aç</button><button role="menuitem" disabled={index <= 0} onClick={() => reorder(g, c.canvasId, -1)}>Yukarı taşı</button><button role="menuitem" disabled={index >= g.canvases.length - 1} onClick={() => reorder(g, c.canvasId, 1)}>Aşağı taşı</button><button role="menuitem" onClick={() => act({ action: 'copyCanvas', id: g.id, canvasId: c.canvasId, revision: g.revision })}>Tuvali çoğalt</button></>}
      {g && !g.problem && <button role="menuitem" onClick={() => { setMenu(null); setQuestion({ title: c ? 'Tuvalin adı' : 'ZIP grubunun adı', initial: c?.name ?? g.name, submit: name => act(c ? { action: 'renameCanvas', id: g.id, canvasId: c.canvasId, revision: g.revision, name } : { action: 'rename', id: g.id, revision: g.revision, name }) }) }}>Yeniden adlandır</button>}
      {g && !c && !g.problem && <button role="menuitem" onClick={() => act({ action: 'archive', id: g.id, revision: g.revision, archived: !g.archived })}>{g.archived ? 'Tuvallere geri al' : 'Arşive taşı'}</button>}
      {!!selected.size && <button role="menuitem" onClick={() => void removeSelection()}>{selected.size > 1 ? 'Seçilenleri sil' : 'Sil'}</button>}
      {!g && <button role="menuitem" onClick={() => { setMenu(null); create() }}>Yeni ZIP grubu</button>}
      <button role="menuitem" onClick={() => act({ action: 'import', copy: true, archived })}>ZIP’i kopya olarak içe aktar…</button>
      <button role="menuitem" onClick={() => { setMenu(null); p.onManage('reload') }}>Kütüphaneyi yeniden yükle</button>
      <button role="menuitem" onClick={() => { setMenu(null); p.onManage('reveal') }}>Windows’ta aç</button>
      <button role="menuitem" onClick={() => { setMenu(null); p.onManage('open') }}>Kütüphane klasörünü değiştir…</button>
    </div>}
    {question && <WorkspaceNameDialog title={question.title} initial={question.initial} onAnswer={name => { const q = question; setQuestion(null); if (name !== null) q.submit(name) }} />}
  </div>
}

export function ZipWorkspacePicker(p: { kind: 'canvas' | 'group'; library: ZipLibrarySnapshot; onCancel: () => void; onOpen: (id: string) => Promise<boolean> }) {
  const [busy, setBusy] = useState(false)
  const locked = useRef(false), dialog = useRef<HTMLDivElement>(null), cancel = useRef(p.onCancel)
  cancel.current = p.onCancel
  const groups = p.library.groups.filter(g => !g.problem && !g.archived)
  const rows = p.kind === 'group' ? groups.filter(g => g.canvases.length).map(g => ({ id: g.id, name: `${g.name}.zip · ${g.canvases.length} tuval` })) : groups.flatMap(g => g.canvases.map(c => ({ id: c.canvasId, name: `${g.name} / ${c.name}` })))
  const open = async (id: string) => { if (locked.current) return; locked.current = true; setBusy(true); try { if (await p.onOpen(id)) p.onCancel() } finally { locked.current = false; setBusy(false) } }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !locked.current) { event.preventDefault(); cancel.current() }
      if (event.key === 'Tab') {
        const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
        if (!buttons.length) return
        event.preventDefault(); const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus()
      }
    }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('keydown', key); previous?.focus() }
  }, [])
  return <div className="modal-backdrop xp-confirm-backdrop"><div ref={dialog} className="xp-dialog workspace-picker" role="dialog" aria-modal="true" aria-label={p.kind === 'group' ? 'ZIP grubunu aç' : 'Tuval aç'}>
    <div className="titlebar dialog-title"><h1>{p.kind === 'group' ? 'ZIP Grubu Aç' : 'Tuval Aç'}</h1></div>
    <div className="workspace-picker-body"><div className="workspace-picker-list">{rows.map(row => <button className="workspace-picker-row" key={row.id} disabled={busy} onClick={() => void open(row.id)}>{row.name}</button>)}{!rows.length && <p className="hint">Kütüphanede açılacak tuval yok.</p>}</div><button className="xp-btn" disabled={busy} onClick={p.onCancel}>İptal</button></div>
  </div></div>
}
