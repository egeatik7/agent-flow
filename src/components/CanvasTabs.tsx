import { useEffect, useRef, useState } from 'react'

export type CanvasTabItem = { id: string; name: string; dirty?: boolean }

type Props = {
  tabs: CanvasTabItem[]
  activeId: string
  disabled: boolean
  onSelect: (id: string) => void
  onAdd: () => void
  onClose: (id: string) => void
  onRename: (id: string, name: string) => void
  onMove: (id: string, delta: -1 | 1) => void
  onRunAll: () => void
  onStop: () => void
  running: boolean
  sequenceLabel?: string
}

export default function CanvasTabs(p: Props) {
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editId) inputRef.current?.select()
  }, [editId])

  const commit = () => {
    if (!editId) return
    const id = editId
    setEditId(null)
    p.onRename(id, draft)
  }

  return (
    <div className="canvas-tabs-row">
      {p.tabs.length > 0 && <div className="canvas-sequence-controls">
      <button type="button" className="xp-btn canvas-sequence-play" title="Açık tuvallerin tamamını soldan sağa oynat" aria-label="Tuvalleri sırayla oynat" disabled={p.disabled} onClick={p.onRunAll}>▶</button>
      <button type="button" className="xp-btn canvas-sequence-stop" title="Çalışmayı ve tuval sırasını durdur" aria-label="Tuval sırasını durdur" disabled={!p.running} onClick={p.onStop}>■</button>
      {p.sequenceLabel && <span className="canvas-sequence-label" role="status">{p.sequenceLabel}</span>}
      </div>}
      <div className="canvas-tabs" role="tablist" aria-label="Tuval sekmeleri">
      {p.tabs.map((tab, index) => {
        const on = tab.id === p.activeId
        const editing = editId === tab.id
        return (
          <div
            key={tab.id}
            className={`canvas-tab${on ? ' active' : ''}`}
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
                maxLength={48}
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
                    setEditId(null)
                  }
                }}
              />
            ) : (
              <span className="canvas-tab-name">{tab.name}{tab.dirty ? ' *' : ''}</span>
            )}
            {on && !editing && <>
              <button type="button" className="canvas-tab-x" title="Tuvali sola taşı" disabled={p.disabled || index === 0} onClick={e => { e.stopPropagation(); p.onMove(tab.id, -1) }}>‹</button>
              <button type="button" className="canvas-tab-x" title="Tuvali sağa taşı" disabled={p.disabled || index === p.tabs.length - 1} onClick={e => { e.stopPropagation(); p.onMove(tab.id, 1) }}>›</button>
            </>}
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
