import { useEffect, useState } from 'react'
export default function NumberDraft(p: { id?: string; value: number; min: number; max: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(p.value))
  useEffect(() => setText(String(p.value)), [p.value])
  const commit = () => {
    const parsed = text.trim() ? Number(text) : NaN
    const value = Number.isFinite(parsed) ? Math.max(p.min, Math.min(p.max, parsed)) : p.value
    setText(String(value)); p.onCommit(value)
  }
  return <input id={p.id} className="xp-input" type="number" min={p.min} max={p.max} value={text}
    onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }} />
}
