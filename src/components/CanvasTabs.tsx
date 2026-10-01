import { useEffect, useRef, useState } from 'react'

export type CanvasTabItem = { id: string; name: string }

type Props = {
  tabs: CanvasTabItem[]
  activeId: string
  disabled: boolean
  onSelect: (id: string) => void
  onAdd: () => void
  onClose: (id: string) => void
  onRename: (id: string, name: string) => void
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
    <div className="canvas-tabs" role="tablist" aria-label="Tuval sekmeleri">
      {p.tabs.map((tab) => {
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
              <span className="canvas-tab-name">{tab.name}</span>
            )}
            <button
              type="button"
              className="canvas-tab-x"
              title="Tuvali kapat"
              disabled={p.disabled || p.tabs.length < 2}
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
  )
}
