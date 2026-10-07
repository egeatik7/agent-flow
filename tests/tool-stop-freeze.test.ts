import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph } from '../electron/graph-types'
import { beginRun, endRun, frozenReport, noteRunFailed, noteUserStop, setDebugRun } from '../electron/tool-state'

const g = (): AgentGraph => ({ nodes: [createNode('start', 0, 0)], edges: [] })

describe('durdurma, debug donmasını üretmez (CLAUDE.md §4)', () => {
  it('kullanıcı durdurduysa motorun durdurma hatası donmuş hata SAYILMAZ', () => {
    beginRun(g())
    setDebugRun(true)
    noteUserStop()
    // Motor, durdurulan koşu için bir hata fırlatıyor; bu bir arıza değildir.
    noteRunFailed('StoppedError: kullanıcı durdurdu')
    expect(frozenReport(), 'durdurma donmuş hata üretti (ajan gerçek arıza sanır)').toBeNull()
    endRun({ ok: false, stopped: true })
    setDebugRun(false)
  })

  it('durdurma yoksa debug hatası yine donar (davranış korunur)', () => {
    beginRun(g())
    setDebugRun(true)
    noteRunFailed('gerçek arıza: hedef bulunamadı')
    expect(frozenReport()).not.toBeNull()
    endRun({ ok: false })
    setDebugRun(false)
  })
})
