import type { LogEntry } from '../types'

type Props = {
  logs: LogEntry[]
  onClear: () => void
}

export default function LogPanel({ logs, onClear }: Props) {
  return (
    <div className="bottom-panel">
      <div className="panel-header">
        <span>Ajan Günlüğü</span>
        <button type="button" className="xp-btn" onClick={onClear}>
          Temizle
        </button>
      </div>
      <div className="panel-body" style={{ padding: 0 }}>
        {logs.length === 0 && (
          <div className="log-line info">Hazır.</div>
        )}
        {logs.map((l) => (
          <div key={l.id} className={`log-line ${l.level}`}>
            [{new Date(l.at).toLocaleTimeString()}] {l.message}
          </div>
        ))}
      </div>
    </div>
  )
}
