import { useEffect, useRef } from 'react'
import type { ViewerHud } from '../../electron/viewer-types'
import { emptyViewerHud } from '../../electron/viewer-hud'
import mascot from '../assets/nubbo.png'

export default function ViewerHudScreen(p: { hud?: ViewerHud; connected: boolean; error: string; onClose?: () => void; phoneOnly?: boolean }) {
  const hud = p.hud ?? emptyViewerHud(), close = useRef<HTMLButtonElement>(null), onClose = useRef(p.onClose)
  onClose.current = p.onClose
  useEffect(() => {
    if (p.phoneOnly) return
    const previous = document.activeElement as HTMLElement | null
    close.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose.current?.() }
      if (event.key === 'Tab') { event.preventDefault(); close.current?.focus() }
    }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('keydown', key); previous?.focus() }
  }, [p.phoneOnly])
  return <section className={`viewer-hud-screen${p.phoneOnly ? ' viewer-phone-card' : ''}`} role={p.phoneOnly ? 'main' : 'dialog'} aria-modal={p.phoneOnly ? undefined : true} aria-label="Nubbo bilgi kartı">
    <header><strong>Nubbo · Bilgi kartı</strong><span role="status">{p.connected ? '● Canlı' : '○ Bağlantı yok · son alınan bilgi'}</span>{!p.phoneOnly && <button className="xp-btn" ref={close} onClick={p.onClose}>Kapat</button>}</header>
    {!p.connected && p.error && <p className="viewer-connection" role="alert">{p.error}</p>}
    <div className="viewer-hud-content">
      <img className="viewer-hud-mascot" src={mascot} alt="" draggable={false}/>
      <div className={`viewer-hud-card ${hud.level}`}><h1>Nubbo</h1><p className="viewer-hud-text">{hud.text}</p>{hud.countdown && <p className="viewer-hud-countdown" role="timer">{hud.countdown}</p>}</div>
      <div className="viewer-hud-details">{(hud.method || hud.recovering) && <p>{hud.recovering ? 'Kurtarma ajanı devrede · akış bekliyor' : hud.method}</p>}{hud.loop && <p>{hud.loop}</p>}</div>
    </div>
  </section>
}
