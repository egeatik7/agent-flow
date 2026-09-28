import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { findTip, type Tip } from './tips'
import './manual.css'

type Pos = { left: number; top: number }

function place(el: Element, x: number, y: number, cardW: number, cardH: number): Pos {
  const r = el.getBoundingClientRect()
  const gap = 12
  const big = r.width > 340 || r.height > 200
  let left = big ? x + 18 : r.right + gap
  let top = big ? y + 22 : r.top
  if (!big && left + cardW > window.innerWidth - 8) left = r.left - cardW - gap
  if (left + cardW > window.innerWidth - 8) left = window.innerWidth - cardW - 8
  if (left < 8) left = 8
  if (top + cardH > window.innerHeight - 8) top = window.innerHeight - cardH - 8
  if (top < 8) top = 8
  return { left, top }
}

/** A read-only card. It never takes clicks, never stops events, never reads app state. */
export default function HelpManual() {
  const [tip, setTip] = useState<Tip | null>(null)
  const [pos, setPos] = useState<Pos>({ left: 8, top: 8 })
  const card = useRef<HTMLDivElement>(null)
  const anchor = useRef<{ el: Element; x: number; y: number } | null>(null)

  useEffect(() => {
    let showTimer = 0
    let hideTimer = 0
    let shown = false
    let current: Element | null = null

    const hide = () => {
      shown = false
      current = null
      anchor.current = null
      setTip(null)
    }

    const onOver = (e: Event) => {
      const pe = e as PointerEvent
      const found = findTip(e.target)
      if (found && found.el === current) {
        window.clearTimeout(hideTimer)
        anchor.current = { el: found.el, x: pe.clientX, y: pe.clientY }
        return
      }
      window.clearTimeout(showTimer)
      window.clearTimeout(hideTimer)
      if (!found) {
        if (shown) hideTimer = window.setTimeout(hide, 140)
        return
      }
      const apply = () => {
        current = found.el
        shown = true
        anchor.current = { el: found.el, x: pe.clientX, y: pe.clientY }
        setTip(found.tip)
        const c = card.current
        setPos(place(found.el, pe.clientX, pe.clientY, c?.offsetWidth || 300, c?.offsetHeight || 150))
      }
      if (shown) apply()
      else showTimer = window.setTimeout(apply, 280)
    }

    const onScroll = () => {
      const a = anchor.current
      if (!a?.el.isConnected) return
      const c = card.current
      setPos(place(a.el, a.x, a.y, c?.offsetWidth || 300, c?.offsetHeight || 150))
    }

    document.addEventListener('pointerover', onOver, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.clearTimeout(showTimer)
      window.clearTimeout(hideTimer)
      document.removeEventListener('pointerover', onOver, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  useLayoutEffect(() => {
    const a = anchor.current
    const c = card.current
    if (!tip || !a || !c) return
    const next = place(a.el, a.x, a.y, c.offsetWidth, c.offsetHeight)
    setPos((prev) => (prev.left === next.left && prev.top === next.top ? prev : next))
  }, [tip])

  if (!tip) return null
  return (
    <div ref={card} className="xpas-manual" style={{ left: pos.left, top: pos.top }} role="note">
      <div className="xpas-manual-bar">El kitabı</div>
      <div className="xpas-manual-title">{tip.title}</div>
      <p className="xpas-manual-text">{tip.text}</p>
    </div>
  )
}
