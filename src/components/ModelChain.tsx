import { useRef, useState } from 'react'
export default function ModelChain(props: {
  localModels?: { id: string }[]
  primary: string
  backups: string[] | undefined
  listId: string
  placeholder: string
  inputId?: string
  onChange: (primary: string, backups: string[]) => void
  onCommit?: (primary: string, backups: string[]) => void
}) {
  const rows = [props.primary, ...(props.backups ?? [])].slice(0, 5)
  const latestRows = useRef(rows)
  latestRows.current = rows
  const [draft, setDraft] = useState(false)
  const commit = (list = latestRows.current) => {
    setDraft(false)
    props.onCommit?.(list[0] ?? '', list.slice(1))
  }
  const setRows = (next: string[], save = true) => {
    const list = next.length ? next.slice(0, 5) : ['']
    latestRows.current = list
    props.onChange(list[0] ?? '', list.slice(1))
    if (save) commit(list)
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const next = rows.slice()
    const [row] = next.splice(i, 1)
    next.splice(j, 0, row)
    setRows(next, true)
  }
  return (
    <div className="backup-box">
      {rows.map((name, i) => (
        <div className="backup-row" key={i}>
          <span className="backup-n" title={i === 0 ? 'Ana model' : 'Yedek model'}>{i + 1}</span>
          <input
            className="xp-input"
            id={i === 0 ? props.inputId : undefined}
            list={props.listId}
            title={name.startsWith('local:') ? 'Yerel sunucu' : 'OpenRouter'}
            aria-label={i === 0 ? 'Ana model' : `Yedek model ${i}`}
            value={name}
            placeholder={i === 0 ? props.placeholder : 'yedek model adı'}
            onChange={(e) => {
              const next = rows.slice()
              next[i] = e.target.value
              setDraft(true); setRows(next)
            }}
            onBlur={() => { if (draft) commit() }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit() } }}
          />
          <button type="button" className="xp-btn backup-x" title="Yukarı" disabled={i === 0} onClick={() => move(i, -1)}>
            ↑
          </button>
          <button type="button" className="xp-btn backup-x" title="Aşağı" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
            ↓
          </button>
          <button
            type="button"
            className="xp-btn backup-x"
            title="Bu modeli sil"
            onClick={() => setRows(rows.length === 1 ? [''] : rows.filter((_, j) => j !== i), true)}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="xp-btn backup-add" disabled={rows.length >= 5} onClick={() => setRows([...rows, ''])}>
        + Yedek
      </button>
      {!!props.localModels?.length && <select className="xp-select" aria-label="Yerel model ekle" value=""
        disabled={rows.length >= 5 && rows.every(row => row.trim())}
        onChange={e => {
          if (!e.target.value || rows.includes(e.target.value)) return
          const empty = rows.findIndex(row => !row.trim())
          const next = rows.slice()
          if (empty >= 0) next[empty] = e.target.value
          else next.push(e.target.value)
          setRows(next, true)
        }}>
        <option value="">+ Yerel model ekle…</option>
        {props.localModels.map(m => <option key={m.id} value={m.id} disabled={rows.includes(m.id)}>{m.id.replace(/^local:/, '')}</option>)}
      </select>}
      {props.onCommit && <p className="hint" role="status">Model değişiklikleri otomatik kaydedilir.</p>}
    </div>
  )
}
