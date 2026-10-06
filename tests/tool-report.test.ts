import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph } from '../electron/graph-types'
import { beginRun, endRun, frozenReport, noteError, noteLogLine, noteStep, setDebugRun, setErrorStopHook } from '../electron/tool-state'

function flow(): AgentGraph {
  const start = createNode('start', 0, 0)
  const click = createNode('click', 300, 0)
  click.title = 'Remesh başlat'
  return { nodes: [start, click], edges: [{ id: 'e1', from: start.id, fromPort: 'next', to: click.id }] }
}

describe('koşu raporu', () => {
  it('debug koşusu ilk hatada donar: bağlam, adım geçmişi, günlük ve görüntü', () => {
    const g = flow()
    beginRun(g)
    let stopped = false
    setErrorStopHook(() => {
      stopped = true
    })
    setDebugRun(true)

    noteStep({ id: 'n1', status: 'running' })
    noteStep({ id: 'n1', status: 'done' })
    noteLogLine('info', '[2] Tıkla: Remesh başlat')
    noteLogLine('info', 'Tepki net değil.')
    noteError('Hedef bulunamadı: “Remesh başlat”')
    noteLogLine('error', 'Hata anı kaydedildi: C:\\tmp\\hata-12.png')
    noteStep({ id: 'n2', status: 'error' })

    expect(stopped).toBe(true)
    const report = frozenReport()
    expect(report).not.toBeNull()
    expect(report?.nodeId).toBe('n2')
    expect(report?.error).toContain('Hedef bulunamadı')
    expect(report?.steps.map((s) => s.status)).toEqual(['running', 'done', 'error'])
    expect(report?.log.some((l) => l.text.includes('Remesh başlat'))).toBe(true)
    expect(report?.shot).toBe('C:\\tmp\\hata-12.png')

    // İkinci hata donmuş anı ezmez: rapor ilk kırılmayı anlatır.
    noteStep({ id: 'n3', status: 'error' })
    expect(frozenReport()?.nodeId).toBe('n2')
    setErrorStopHook(null)
  })

  it('debug olmayan koşuda donma olmaz, yeni koşu eski raporu temizler', () => {
    const g = flow()
    setDebugRun(true)
    beginRun(g)
    noteStep({ id: 'a', status: 'error' })
    expect(frozenReport()?.nodeId).toBe('a')

    endRun({ ok: false })
    beginRun(g)
    noteStep({ id: 'b', status: 'error' })
    expect(frozenReport()).toBeNull()
  })
})
