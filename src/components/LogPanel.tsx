import { useEffect, useRef } from 'react'
import type { LogEntry } from '../types'

export default function LogPanel({ logs, onClear, onOpenFolder }: { logs: LogEntry[]; onClear: () => void; onOpenFolder?: () => void }) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [logs])
  return (
    <div className="bottom-panel">
      <div className="panel-header">
        <span>Ajan Günlüğü</span>
        <span>
          {onOpenFolder && (
            <button type="button" className="xp-btn small" onClick={onOpenFolder} title="Her çalıştırmanın günlük dosyası ve hata anlarının ekran görüntüleri">
              Günlük klasörü
            </button>
          )}{' '}
          <button type="button" className="xp-btn small" onClick={onClear}>
            Temizle
          </button>
        </span>
      </div>
      <div className="log-body">
        {logs.length === 0 && <div className="log-line info">Hazır.</div>}
        {logs.map((l) => (
          <div key={l.id} className={`log-line ${l.level}`}>
            [{new Date(l.at).toLocaleTimeString('tr-TR')}] {l.message}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  )
}
