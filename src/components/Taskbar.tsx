import { useEffect, useState } from 'react'

export default function Taskbar() {
  const [clock, setClock] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="taskbar">
      <button type="button" className="start-btn">
        <span
          aria-hidden
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: 'linear-gradient(180deg,#fff,#ffd24a 40%,#e08a00)',
            display: 'inline-block',
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.25)',
          }}
        />{' '}
        başlat
      </button>
      <div className="task-pill">
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: 2,
            background: 'linear-gradient(135deg,#fff,#ffd24a,#e08a00)',
            display: 'inline-block',
          }}
        />
        XP Agent Studio
      </div>
      <div className="clock">
        {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  )
}
