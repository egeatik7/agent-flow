import { useEffect, useState } from 'react'
import type { LogLevel } from '../types'

type Status = { level: LogLevel; text: string }

const IDLE: Status = { level: 'info', text: 'Ne yaptığı burada yazacak.' }

export default function Hud() {
  const [status, setStatus] = useState<Status>(IDLE)

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
    return () => {
      document.documentElement.classList.remove('hud-root')
      off?.()
    }
  }, [])

  return (
    <div className="hud">
      <div className={`hud-card ${status.level}`}>
        <div className="hud-title">
          <span className="hud-dot" />
          Nubbo
        </div>
        <p className="hud-text">{status.text}</p>
      </div>
    </div>
  )
}
