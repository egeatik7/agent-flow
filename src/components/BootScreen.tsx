import { useEffect, useRef, useState } from 'react'
import { version } from '../../package.json'
import nubbo from '../assets/nubbo.png'
import still from '../assets/nubbo-still.png'
import logo from '../assets/nubbo-logo.png'

const BLOCKS = 20

function lineFor(pct: number): string {
  if (pct < 18) return 'Pencere hazırlanıyor…'
  if (pct < 42) return 'Ayarlar okunuyor…'
  if (pct < 68) return 'Tuval yükleniyor…'
  if (pct < 100) return 'Pencereler aranıyor…'
  return 'Hazır.'
}

export default function BootScreen({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const [pct, setPct] = useState(4)
  const [playing, setPlaying] = useState(() => !document.hidden)
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    const onVis = () => setPlaying(!document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPct((p) => {
        const cap = ready ? 100 : 92
        if (p >= cap) return cap
        const step = ready ? 5 : 1.4
        return Math.min(cap, Math.round((p + step) * 10) / 10)
      })
    }, 45)
    return () => window.clearInterval(timer)
  }, [ready])

  useEffect(() => {
    if (pct < 100) return
    const done = window.setTimeout(() => doneRef.current(), 420)
    return () => window.clearTimeout(done)
  }, [pct])

  const shown = Math.min(100, Math.round(pct))
  const filled = Math.round((shown / 100) * BLOCKS)
  const src = broken || !playing ? still : nubbo

  return (
    <div className="boot-shade" role="status" aria-live="polite">
      <div className="boot-window">
        <div className="boot-title">Nubbo Agent Studio</div>
        <div className="boot-body">
          <img className="boot-mascot" src={src} alt="" draggable={false} onError={() => setBroken(true)} />
          <img className="boot-logo" src={logo} alt="Nubbo Agent Studio" draggable={false} />
          <p className="boot-ver">version: {version}</p>
          <div className="boot-track" aria-hidden="true">
            {Array.from({ length: BLOCKS }, (_, i) => (
              <span key={i} className={i < filled ? 'on' : ''} />
            ))}
          </div>
          <p className="boot-pct">{shown}%</p>
          <p className="boot-line">{lineFor(shown)}</p>
        </div>
      </div>
    </div>
  )
}
