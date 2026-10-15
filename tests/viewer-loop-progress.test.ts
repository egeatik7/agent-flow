import { describe, it, expect } from 'vitest'
import { createNode } from '../electron/graph-types'
import { runGraph, type Executor, type LoopProgress } from '../electron/runner'
import { ViewerState } from '../electron/viewer-state'
import { applyViewerMessage } from '../src/viewer/model'

const edge = (from: string, to: string) => ({ id: `${from}:${to}`, from, to, fromPort: 'next' })
describe('structured loop telemetry through packages', () => {
 it('keeps outer and inner positions at each leaf and restores the outer stack', async () => {
  const start = createNode('start', 0, 0), click = createNode('click', 300, 200)
  const inner = { ...createNode('loop', 100, 100), title: 'Dosyalar', items: ['a.glb', 'b.glb'], members: [click.id] }
  const innerStart = createNode('start', 0, 0)
  const pkg = { ...createNode('package', 100, 100), inner: { nodes: [innerStart, inner, click], edges: [edge(innerStart.id, inner.id)] } }
  const outer = { ...createNode('loop', 100, 100), title: 'Gruplar', items: ['01', '02'], members: [pkg.id] }
  const state = new ViewerState('test'); let model = state.snapshot()
  state.subscribe(message => { model = applyViewerMessage(model, structuredClone(message)) })
  const seen: LoopProgress[][] = []
  const ex: Executor = { log: () => {}, step: () => {}, shouldStop: () => false,
   click: async () => { seen.push(structuredClone(model.hud!.loops!)) }, type: async () => {}, key: async () => {}, exists: async () => true,
   setLoopProgress: loops => state.event('hud:loops', { loops }) }
  await runGraph({ nodes: [start, outer, pkg], edges: [edge(start.id, outer.id)] }, ex, { maxSteps: 100, stepDelayMs: 0 })
  expect(seen.map(loops => loops.map(l => [l.title, l.index, l.total, l.item]))).toEqual([
   [['Gruplar',1,2,'01'],['Dosyalar',1,2,'a.glb']], [['Gruplar',1,2,'01'],['Dosyalar',2,2,'b.glb']],
   [['Gruplar',2,2,'02'],['Dosyalar',1,2,'a.glb']], [['Gruplar',2,2,'02'],['Dosyalar',2,2,'b.glb']]
  ])
  expect(state.snapshot().hud?.loops).toEqual([])
  expect(model.hud).toEqual(state.snapshot().hud)
 })
})

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ViewerHudScreen from '../src/viewer/ViewerHudScreen'
import { emptyViewerHud } from '../electron/viewer-hud'
it('renders readable memory and a separate row for every enclosing loop', () => {
 const html = renderToStaticMarkup(createElement(ViewerHudScreen, { connected: true, error: '', phoneOnly: true,
  hud: { ...emptyViewerHud(), loops: [
   { id: 'outer', title: 'Grup', index: 2, total: 4, item: '02' },
   { id: 'inner', title: 'Dosya', index: 7, total: 20, item: 'MetalTongs.glb' }
  ], bellek: { ramVram: 'RAM 9,7 / 15,8 GB · VRAM 9,4 / 12,0 GB', butce: 'Bellek bütçesi 29 / 36 GB',
   gpuSatirlari: ['NVIDIA GeForce RTX 3060'], surecSatirlari: ['llama-server: RAM 982 MB'],
   aciklamalar: ['RAM: fiziksel bellek.'], daraliyor: false, eski: false, uyari: '', olcumVar: true, yas: 'az önce ölçüldü', hata: '', satirlar: [] }
  } }))
 for (const text of ['Aktif döngüler', '2 / 4', '7 / 20', 'MetalTongs.glb', 'Bilgisayar belleği', 'RAM 9,7', 'RTX 3060']) expect(html).toContain(text)
})
