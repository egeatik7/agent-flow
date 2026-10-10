export default function ModelChain(props: {
  primary: string
  backups: string[] | undefined
  listId: string
  placeholder: string
  inputId?: string
  onChange: (primary: string, backups: string[]) => void
}) {
  const rows = [props.primary, ...(props.backups ?? [])].slice(0, 5)
  const setRows = (next: string[]) => {
    const list = next.length ? next.slice(0, 5) : ['']
    props.onChange(list[0] ?? '', list.slice(1))
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const next = rows.slice()
    const [row] = next.splice(i, 1)
    next.splice(j, 0, row)
    setRows(next)
  }
  return (
    <div className="backup-box">
      {rows.map((name, i) => (
        <div className="backup-row" key={i}>
          <span className="backup-n">{i + 1}</span>
          <input
            className="xp-input"
            id={i === 0 ? props.inputId : undefined}
            list={props.listId}
            value={name}
            placeholder={i === 0 ? props.placeholder : 'yedek model adı'}
            onChange={(e) => {
              const next = rows.slice()
              next[i] = e.target.value
              setRows(next)
            }}
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
            onClick={() => setRows(rows.length === 1 ? [''] : rows.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="xp-btn backup-add" disabled={rows.length >= 5} onClick={() => setRows([...rows, ''])}>
        + Yedek
      </button>
    </div>
  )
}
