import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph } from '../electron/graph-types'
import {
  beginRun,
  completeFailure,
  endRun,
  frozenReport,
  noteError,
  noteFailureShot,
  noteLogLine,
  noteRunFailed,
  noteStep,
  noteUserStop,
  recentReports,
  setDebugRun,
  setErrorStopHook,
  setStopAt,
  setStopAtHook,
  stopReason,
} from '../electron/tool-state'

function flow(): AgentGraph {
  const start = createNode('start', 0, 0)
  const click = createNode('click', 300, 0)
  click.title = 'Remesh başlat'
  return { nodes: [start, click], edges: [{ id: 'e1', from: start.id, fromPort: 'next', to: click.id }] }
}

describe('koşu raporu', () => {
  it('adım hatasında donar; motorun mesajı ve görüntüsü sonradan aynı kaydı tamamlar', () => {
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
    noteStep({ id: 'n2', status: 'error' })

    // Donma anında: bağlam tamam, ama mesaj ve görüntü henüz gelmedi.
    const first = frozenReport()
    expect(first).not.toBeNull()
    expect(first?.kind).toBe('step')
    expect(first?.nodeId).toBe('n2')
    expect(first?.error).toBe('')
    expect(first?.errorPending).toBe(true)
    expect(first?.shotPending).toBe(true)
    expect(first?.runId).toBeTruthy()
    expect(first?.failureId).toBeTruthy()
    expect(stopped).toBe(true)

    // Motorun gerçek mesajı ve görüntüsü sonradan gelir: aynı kaydı tamamlar.
    completeFailure('Hedef bulunamadı: “Remesh başlat”')
    noteFailureShot('C:\\Users\\ASUS TUF\\AppData\\Local\\Temp\\hata anı 12.jpg')

    const done = frozenReport()
    expect(done?.error).toContain('Hedef bulunamadı')
    expect(done?.errorPending).toBe(false)
    expect(done?.failureId).toBe(first?.failureId)
    expect(done?.shot).toBe('C:\\Users\\ASUS TUF\\AppData\\Local\\Temp\\hata anı 12.jpg')
    expect(done?.shotPending).toBe(false)
    expect(done?.steps.map((s) => s.status)).toEqual(['running', 'done', 'error'])
    expect(done?.log.some((l) => l.text.includes('Remesh başlat'))).toBe(true)

    // Tamamlanmış bir kaydı başka bir mesaj artık değiştirmez.
    completeFailure('başka bir hata')
    expect(frozenReport()?.error).toContain('Hedef bulunamadı')
    setErrorStopHook(null)
  })

  it('görüntü alınamazsa bunu dürüstçe söyler, yol uydurmaz', () => {
    const g = flow()
    beginRun(g)
    setDebugRun(true)
    noteStep({ id: 'x', status: 'error' })
    noteFailureShot('')
    expect(frozenReport()?.shot).toBe('')
    expect(frozenReport()?.shotPending).toBe(false)
  })

  it('adım olayı olmayan koşu hatasını da yakalar; kullanıcının Durdur u eylemini yakalamaz', () => {
    const g = flow()
    // Koşu hatası: adım olayı yok, mesaj var.
    beginRun(g)
    setDebugRun(true)
    noteRunFailed('“Başlangıç” node’unun “sonra” çıkışı bağlı değil, akış burada bitti.')
    const run = frozenReport()
    expect(run?.kind).toBe('run')
    expect(run?.error).toContain('bağlı değil')
    expect(run?.errorPending).toBe(false)

    // Yeni koşu: eskisi arşivde kalır, yeni rapor eskisini ezmez.
    const oldId = run?.runId as string
    endRun({ ok: false, error: 'x' })
    beginRun(g)
    setDebugRun(true)
    noteStep({ id: 'y', status: 'error' })
    completeFailure('ikinci hata')
    expect(frozenReport()?.error).toBe('ikinci hata')
    expect(frozenReport()?.runId).not.toBe(oldId)
    expect(frozenReport(oldId)?.error).toContain('bağlı değil')
    expect(recentReports().length).toBeGreaterThanOrEqual(2)

    // Kullanıcı durdurdu: hata değil, rapor açılmaz.
    endRun({ ok: false, stopped: true })
    beginRun(g)
    setDebugRun(true)
    noteError('Durduruldu')
    endRun({ ok: false, stopped: true })
    expect(frozenReport()).toBeNull()
  })

  it('sınırlı bölge testi: yalnız sınır node u bitince durur; neden ayrı bildirilir', () => {
    const g = flow()
    let stopped = 0
    setStopAtHook(() => {
      stopped += 1
    })
    beginRun(g)
    setStopAt('n2')
    noteStep({ id: 'n1', status: 'done' })
    expect(stopped).toBe(0)
    expect(stopReason()).toBeNull()
    noteStep({ id: 'n2', status: 'done' })
    expect(stopped).toBe(1)
    expect(stopReason()).toBe('until')
    // Sınırdan sonraki adımlar koşmaya devam etse bile ikinci kez durdurma istenmez.
    noteStep({ id: 'n3', status: 'done' })
    expect(stopped).toBe(1)

    // Nedenler birbirine karışmaz.
    beginRun(g)
    expect(stopReason()).toBeNull()
    noteUserStop()
    expect(stopReason()).toBe('user')
    beginRun(g)
    setDebugRun(true)
    noteStep({ id: 'x', status: 'error' })
    expect(stopReason()).toBe('debug-error')
    endRun({ ok: false })
    beginRun(g)
    setDebugRun(true)
    noteRunFailed('koşu hatası')
    expect(stopReason()).toBe('debug-error')
    setStopAtHook(null)
  })

  it('yeni koşu günlük kuyruğunu temizler', () => {
    const g = flow()
    beginRun(g)
    noteLogLine('info', 'birinci koşunun satırı')
    endRun({ ok: true })
    beginRun(g)
    setDebugRun(true)
    noteStep({ id: 'z', status: 'error' })
    expect(frozenReport()?.log.some((l) => l.text.includes('birinci koşunun'))).toBe(false)
  })
})
