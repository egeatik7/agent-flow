import { describe, expect, it } from 'vitest'
import type { AgentGraph } from '../electron/graph-types'
import { ViewerState } from '../electron/viewer-state'

/**
 * O18 (yönerge) — tablette yürünmüş-kenar izi masaüstüyle AYNI kurala uymalı.
 *
 * Ölçülen kusur: `viewer-state.ts` `agent:step` dalında iz HİÇ kesilmiyordu ve `agent:edge` dalında ham
 * `e.from === p.to` karşılaştırılıyordu. Masaüstü (`src/lib/run-progress.ts` `progressEdge`/`progressStep`)
 * ise `runNodePath(graph, edge.from).includes(to)` ile ÖNCEKİ TURUN kenarını keser. Bu yüzden döngü/paket
 * çerçevesine yeniden girişte önceki turun kenarları tablette "yürünmüş" kalıyor ve tüm eski yol akan
 * çizgi olarak çiziliyordu.
 *
 * Bu düzeltme YALNIZ izleyici durumunu (görsel) etkiler; motorun yürütmesine dokunmaz.
 */
const graf = (): AgentGraph => ({
  version: 3,
  nodes: [
    { id: 'kutu', kind: 'loop', title: 'Kutu', x: 0, y: 0, members: ['govde'] },
    { id: 'govde', kind: 'click', title: 'Gövde', x: 0, y: 0, prompt: 'a' },
  ],
  edges: [{ from: 'govde', fromPort: 'next', to: 'kutu' }],
  packages: [],
} as unknown as AgentGraph)

function yeniRun() {
  const s = new ViewerState('test')
  s.setBook({ workspaceVersion: 3, tabs: [], activeId: '', zipLibrary: { directory: '', groups: [] } } as never)
  s.begin('run1', 'canvas1', graf())
  return s
}
const kenarlar = (s: ViewerState) => (s.state.run?.edges ?? []).map((e) => e.id)

describe('O18: izleyici izi masaüstü kuralıyla kesilir', () => {
  it('bizi buraya getiren kenar SİLİNMEZ (yeni tur başlarken)', () => {
    const s = yeniRun()
    s.event('agent:edge', { id: 'e1', from: 'govde', to: 'kutu' })
    s.event('agent:step', { id: 'kutu', status: 'running' })
    expect(kenarlar(s)).toEqual(['e1']) // incoming kenar korunur
  })

  it('ikinci turun kenarı önceki turun kenarını KESER (eski yol akan çizgi kalmaz)', () => {
    const s = yeniRun()
    s.event('agent:edge', { id: 'e1', from: 'govde', to: 'kutu' })
    s.event('agent:step', { id: 'kutu', status: 'running' })
    s.event('agent:edge', { id: 'e2', from: 'govde', to: 'kutu' })
    expect(kenarlar(s)).toEqual(['e2']) // ESKİ HATA: ['e1','e2'] kalıyordu
  })

  it('yeniden girişte eski kuyruk atılır (masaüstü progressStep ile aynı)', () => {
    const s = yeniRun()
    s.event('agent:edge', { id: 'e1', from: 'govde', to: 'kutu' })
    s.event('agent:edge', { id: 'e2', from: 'govde', to: 'kutu' })
    s.event('agent:step', { id: 'govde', status: 'running' })
    expect(kenarlar(s)).toEqual([]) // yeni tur başladı; önceki kenar "yürünmüş" sayılmaz
  })

  it('aynı kenar iki kez eklenmez (tekrar olayı izi şişirmez)', () => {
    const s = yeniRun()
    s.event('agent:edge', { id: 'e1', from: 'govde', to: 'kutu' })
    s.event('agent:edge', { id: 'e1', from: 'govde', to: 'kutu' })
    expect(kenarlar(s)).toEqual(['e1'])
  })
})
