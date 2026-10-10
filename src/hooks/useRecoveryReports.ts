import { useEffect, useState } from 'react'
import type { RecoveryReport } from '../../electron/recovery'

export function useRecoveryReports(running: boolean): RecoveryReport[] {
  const [reports, setReports] = useState<RecoveryReport[]>([])
  useEffect(() => {
    let alive = true
    const liveIds = new Set<string>()
    const api = window.xpAgent
    const off = api?.onRecoveryReport?.(report => {
      liveIds.add(report.id)
      if (alive) setReports(prev => [report, ...prev.filter(r => r.id !== report.id)].slice(0,100))
    })
    // Subscribe first; an initial snapshot must not overwrite a newer live update.
    void api?.recoveryReports?.().then(snapshot => {
      if (alive) setReports(prev => [...new Map([...prev, ...snapshot, ...prev.filter(r => liveIds.has(r.id))].map(r => [r.id,r])).values()]
        .sort((a,b) => b.startedAt-a.startedAt).slice(0,100))
    }).catch(() => {})
    return () => { alive = false; off?.() }
  }, [running])
  return reports
}
