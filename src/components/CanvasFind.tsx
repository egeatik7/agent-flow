import { useEffect, useRef, useState, type RefObject } from 'react'
import type { AgentGraph } from '../types'
import { searchCanvas, type CanvasSearchHit } from '../lib/canvas-search'
import '../styles/canvas-find.css'

type Props = {
  graph: AgentGraph
  scopeKey?: string
  canvasRef: RefObject<HTMLDivElement>
  pointerRef: RefObject<{ x: number; y: number } | null>
  onNavigate: (hit: CanvasSearchHit) => boolean
}

export default function CanvasFind(p: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [submitted, setSubmitted] = useState<string | null>(null)
  const [hits, setHits] = useState<CanvasSearchHit[]>([])
  const [index, setIndex] = useState(-1)
  const [notice, setNotice] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLFormElement>(null)

  useEffect(() => {
    setOpen(false); setDraft(''); setSubmitted(null); setHits([]); setIndex(-1); setNotice('')
  }, [p.scopeKey])
  useEffect(() => { if (open) { input.current?.focus(); input.current?.select() } }, [open])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'f') return
      const target = event.target instanceof HTMLElement ? event.target : null
      const inPanel = !!target && !!panel.current?.contains(target)
      if (!inPanel && target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      const point = p.pointerRef.current
      const canvas = p.canvasRef.current
      const rect = canvas?.getBoundingClientRect()
      // Pointer position is cleared on leaving the canvas. Do not hijack Ctrl+F elsewhere.
      if (!inPanel && (!point || !rect || point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom)) return
      event.preventDefault(); event.stopPropagation()
      setOpen(true); input.current?.focus(); input.current?.select()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [p.canvasRef, p.pointerRef])

  const go = (nextHits: CanvasSearchHit[], next: number) => {
    if (!nextHits.length) return
    setIndex(next)
    setNotice(p.onNavigate(nextHits[next]) ? '' : 'Bu sonuç artık erişilebilir değil; yeniden Ara.')
  }
  const submit = () => {
    const found = searchCanvas(p.graph, draft)
    setSubmitted(draft.trim()); setHits(found); setIndex(found.length ? 0 : -1); setNotice('')
    if (found.length) go(found, 0)
  }
  const step = (direction: number) => {
    if (hits.length) go(hits, (index + direction + hits.length) % hits.length)
  }
  if (!open) return null
  const pending = submitted !== null && draft.trim() !== submitted
  return <form ref={panel} className="canvas-find" aria-label="Tuvalde ara"
    onSubmit={event => { event.preventDefault(); submit() }}
    onMouseDown={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation() }}
    onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Enter') { event.preventDefault(); submit() }
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1)
      }
    }}>
    <div className="canvas-find-row">
      <label htmlFor="canvas-find-input">Tuvalde ara</label>
      <input id="canvas-find-input" ref={input} value={draft} placeholder="Örn. Save As" autoComplete="off"
        onChange={event => setDraft(event.target.value)} />
      <button className="xp-btn" type="submit">Ara</button>
      <button className="xp-btn" type="button" aria-label="Önceki sonuç" title="Önceki sonuç (←)" disabled={!hits.length} onClick={() => step(-1)}>←</button>
      <button className="xp-btn" type="button" aria-label="Sonraki sonuç" title="Sonraki sonuç (→)" disabled={!hits.length} onClick={() => step(1)}>→</button>
      <button className="xp-btn" type="button" aria-label="Aramayı kapat" title="Kapat (Esc)" onClick={() => setOpen(false)}>×</button>
    </div>
    <div className="canvas-find-status" role="status" aria-live="polite">
      {notice || (submitted === null ? 'Tüm tuval ve paketler · Enter veya Ara ile başlat.' :
        !submitted ? 'Aranacak metni yaz.' : !hits.length ? 'Sonuç bulunamadı.' : `${index + 1} / ${hits.length} · ${hits[index]?.breadcrumb}`)}
      {pending && <span> · Yeni metin için Enter / Ara</span>}
    </div>
  </form>
}
