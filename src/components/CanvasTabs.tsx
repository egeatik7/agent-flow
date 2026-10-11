import { useEffect, useRef, useState, type CSSProperties } from 'react'

export type CanvasTabItem = { id: string; name: string; dirty?: boolean }

type Props = {
  tabs: CanvasTabItem[]
  activeId: string
  disabled: boolean
  onSelect: (id: string) => void
  onAdd: () => void
  onClose: (id: string) => void
  onRename: (id: string, name: string) => void
  onMove?: (id: string, delta: -1 | 1) => void
  onReorder?: (id:string,targetId:string,after:boolean)=>void
  onRunAll: () => void
  onStop: () => void
  running: boolean
  sequenceLabel?: string
  onRegisterRenameFlush?: (flush: (() => void) | null) => void
}

export default function CanvasTabs(p: Props) {
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const dragging=useRef(''),colors=useRef(new Map<string,number>()),nextColor=useRef(0)
  const [drop,setDrop]=useState<{id:string;after:boolean}|null>(null)
  const palette=[210,110,32,290,175,345,55,250]
  const inputRef = useRef<HTMLInputElement>(null)
  const rename = useRef<{ id: string | null; name: string }>({ id: null, name: '' })
  rename.current = { id: editId, name: draft }
  useEffect(() => {
    p.onRegisterRenameFlush?.(() => {
      const current = rename.current
      if (!current.id) return
      rename.current = { id: null, name: '' }; setEditId(null)
      p.onRename(current.id, current.name)
    })
    return () => p.onRegisterRenameFlush?.(null)
  })

  useEffect(() => {
    if (editId) inputRef.current?.select()
  }, [editId])

  const commit = () => {
    if (!rename.current.id) return
    const { id, name } = rename.current
    rename.current = { id: null, name: '' }
    setEditId(null)
    p.onRename(id, name)
  }

  return (
    <div className="canvas-tabs-row">
      {p.tabs.length > 0 && <div className="canvas-sequence-controls">
      <button type="button" className="xp-btn canvas-sequence-play" title="Aktif tuvalden başlayıp sağındaki tuvallerle devam et" aria-label="Tuvalleri sırayla oynat" disabled={p.disabled} onClick={p.onRunAll}>▶</button>
      <button type="button" className="xp-btn canvas-sequence-stop" title="Çalışmayı ve tuval sırasını durdur" aria-label="Tuval sırasını durdur" disabled={!p.running} onClick={p.onStop}>■</button>
      {p.sequenceLabel && <span className="canvas-sequence-label" role="status">{p.sequenceLabel}</span>}
      </div>}
      <div className="canvas-tabs" role="tablist" aria-label="Tuval sekmeleri">
      {p.tabs.map((tab) => {
        const on = tab.id === p.activeId
        const editing = editId === tab.id
        if(!colors.current.has(tab.id))colors.current.set(tab.id,palette[nextColor.current++%palette.length])
        const hue=colors.current.get(tab.id)!
        return (
          <div
            key={tab.id}
            className={`canvas-tab${on ? ' active' : ''}${drop?.id===tab.id?(drop.after?' drop-after':' drop-before'):''}`}
            style={{'--tab-hue':hue} as CSSProperties}
            draggable={!p.disabled&&!editing&&!!p.onReorder}
            onDragStart={e=>{if(p.disabled||editing){e.preventDefault();return}dragging.current=tab.id;e.dataTransfer.setData('application/x-nubbo-tab',tab.id);e.dataTransfer.effectAllowed='move'}}
            onDragOver={e=>{if(p.disabled||!dragging.current||dragging.current===tab.id)return;e.preventDefault();e.dataTransfer.dropEffect='move';const r=e.currentTarget.getBoundingClientRect();setDrop({id:tab.id,after:e.clientX>r.left+r.width/2});const strip=e.currentTarget.parentElement;if(strip){const s=strip.getBoundingClientRect();if(e.clientX<s.left+25)strip.scrollLeft-=18;else if(e.clientX>s.right-25)strip.scrollLeft+=18}}}
            onDrop={e=>{e.preventDefault();e.stopPropagation();const id=e.dataTransfer.getData('application/x-nubbo-tab');if(!p.disabled&&id===dragging.current&&p.tabs.some(t=>t.id===id)){const r=e.currentTarget.getBoundingClientRect();p.onReorder?.(id,tab.id,e.clientX>r.left+r.width/2)}dragging.current='';setDrop(null)}}
            onDragEnd={()=>{dragging.current='';setDrop(null)}}
            role="tab"
            aria-selected={on}
            title={editing ? 'Adı yaz, Enter ile bırak' : tab.name}
            onClick={() => {
              if (!p.disabled && !editing) p.onSelect(tab.id)
            }}
            onDoubleClick={(e) => {
              if (p.disabled) return
              e.preventDefault()
              setEditId(tab.id)
              setDraft(tab.name)
            }}
          >
            {editing ? (
              <input
                ref={inputRef}
                className="canvas-tab-rename"
                disabled={p.disabled}
                value={draft}
                maxLength={24}
                aria-label="Tuval adı"
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onBlur={commit}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    ;(e.target as HTMLInputElement).blur()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    rename.current = { id: null, name: '' }
                    setEditId(null)
                  }
                }}
              />
            ) : (
              <span className="canvas-tab-name">{tab.name.length>24?tab.name.slice(0,24)+'…':tab.name}{tab.dirty ? ' *' : ''}</span>
            )}
            <button
              type="button"
              className="canvas-tab-x"
              title="Tuvali kapat"
              disabled={p.disabled}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                if (!p.disabled) p.onClose(tab.id)
              }}
            >
              ×
            </button>
          </div>
        )
      })}
      <button type="button" className="canvas-tab-add" title="Yeni tuval" disabled={p.disabled} onClick={p.onAdd}>
        +
      </button>
      </div>
    </div>
  )
}
