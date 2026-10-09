import { useEffect, useState } from 'react'
import nubbo from '../assets/nubbo.png'
import still from '../assets/nubbo-still.png'
import aeroMascot from '../assets/nubbo-aero.png'
import type { LogLevel } from '../types'

type Status = { level: LogLevel; text: string }

const IDLE: Status = { level: 'info', text: 'Ne yaptığı burada yazacak.' }

export default function Hud() {
  const [status, setStatus] = useState<Status>(() =>
    window.xpAgent ? IDLE : { level: 'info', text: 'deepseek-v4: şimdi Kaydet’e basmalıyım.' }
  )
  const [loop, setLoop] = useState(() => (window.xpAgent ? '' : 'Modeller · 3/12 · kedi.png'))
  const [method, setMethod] = useState(() => (window.xpAgent ? '' : 'Windows OCR'))
  const [playing, setPlaying] = useState(() => !document.hidden)

  useEffect(() => {
    const onVis = () => setPlaying(!document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    document.documentElement.classList.add('hud-root')
    document.title = ''
    const off = window.xpAgent?.onHud?.((payload) => {
      const p = payload as Partial<Status>
      const text = typeof p.text === 'string' ? p.text.trim() : ''
      if (!text) return
      const level = p.level === 'warn' || p.level === 'error' || p.level === 'success' || p.level === 'info' ? p.level : 'info'
      setStatus({ level, text })
    })
    const offLoop = window.xpAgent?.onHudLoop?.((payload) => {
      const text = typeof (payload as { text?: unknown }).text === 'string' ? (payload as { text: string }).text.trim() : ''
      setLoop(text)
    })
    const offMethod = window.xpAgent?.onHudMethod?.((payload) => {
      const text = typeof (payload as { text?: unknown }).text === 'string' ? (payload as { text: string }).text.trim() : ''
      setMethod(text)
    })
    return () => {
      document.documentElement.classList.remove('hud-root')
      off?.()
      offLoop?.()
      offMethod?.()
    }
  }, [])

  const mascot = playing ? nubbo : still
  return (
    <div className="hud">
      <div className="hud-mascot-slot">
        <img key={mascot} className="hud-mascot brand-xp" src={mascot} alt="" draggable={false} />
        <img className="hud-mascot brand-aero" src={aeroMascot} alt="" draggable={false} />
      </div>
      <div className={`hud-card ${status.level}`}>
        <div className="hud-title">
          <span className="hud-dot" />
          Nubbo
        </div>
        <p className="hud-text">{status.text}</p>
      </div>
      <p className={`hud-line hud-method${method ? ' on' : ''}`}>{method}</p>
      <p className={`hud-line hud-loop${loop ? ' on' : ''}`}>{loop}</p>
    </div>
  )
}
