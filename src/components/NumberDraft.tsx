import { useEffect, useState } from 'react'
export default function NumberDraft(p: { id?: string; value: number; min: number; max: number; step?: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(p.value))
  useEffect(() => setText(String(p.value)), [p.value])
  const commit = () => {
    const parsed = text.trim() ? Number(text) : NaN
    const value = Number.isFinite(parsed) ? Math.max(p.min, Math.min(p.max, parsed)) : p.value
    setText(String(value)); p.onCommit(value)
  }
  return <input id={p.id} className="xp-input" type="number" min={p.min} max={p.max} step={p.step} value={text}
    onChange={e => { const raw = e.target.value; setText(raw); const n = raw.trim() ? Number(raw) : NaN; if (Number.isFinite(n) && n >= p.min && n <= p.max) p.onCommit(n) }} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }} />
}
