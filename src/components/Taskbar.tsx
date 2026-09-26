import { useEffect, useState } from 'react'

export default function Taskbar({ recording, running }: { recording: boolean; running: boolean }) {
  const [clock, setClock] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="taskbar">
      <button type="button" className="start-btn">
        <span className="start-logo" aria-hidden />
        başlat
      </button>
      <div className="task-pill">
        <span className="task-icon" />
        XP Agent Studio
      </div>
      <div className="tray">
        {recording && <span className="tray-item rec">● KAYIT</span>}
        {running && <span className="tray-item run">▶ Çalışıyor</span>}
        <span className="clock">{clock.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  )
}
