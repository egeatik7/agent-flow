// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CheckpointsPanel from '../src/components/CheckpointsPanel'
import type { XpAgentApi } from '../src/types'
import type { CheckpointDetail, CheckpointInfo } from '../electron/checkpoint-types'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
const cp = (id: string): CheckpointInfo => ({ id, runId: 'run', ordinal: id === 'one' ? 1 : 2, canvasId: 'canvas', canvasName: 'Tuval', label: id, at: 100, endedAt: 200, status: 'completed', outputCount: 1, roots: ['C:\\outputs'], issues: [] })
const info = (id: string): CheckpointDetail => ({ ...cp(id), outputs: [{ path: `C:\\outputs\\${id}.blend`, kind: 'file', change: 'created', firstSeen: 120, lastSeen: 130, size: 10, present: true }] })
const click = async (button: Element) => { await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() }) }
function button(text: string) { const match = [...document.querySelectorAll('button')].find(b => b.textContent === text); if (!match) throw new Error(`Missing ${text}`); return match }
function row(id: string) { const match = [...document.querySelectorAll('.checkpoint-row')].find(b => b.querySelector('b')?.textContent === id); if (!match) throw new Error(`Missing row ${id}`); return match }
async function mount(running = false, overrides: Partial<XpAgentApi> = {}) {
  const api = { listCheckpoints: vi.fn(async () => [cp('one'), cp('two')]), checkpointMonitoring: vi.fn(async () => ({ automatic: true, active: running, roots: ['C:\\'], issues: [] })), checkpointDetail: vi.fn(async (id: string) => info(id)), checkpointSnapshot: vi.fn(), openPath: vi.fn(async () => true), showInFolder: vi.fn(async () => true), ...overrides } as unknown as XpAgentApi
  const onRun = vi.fn(async () => {}), onClose = vi.fn()
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root!.render(createElement(CheckpointsPanel, { api, running, busy: false, onRun, onClose })); await Promise.resolve() })
  return { api, onRun, onClose }
}
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ''; vi.restoreAllMocks() })
describe('checkpoint UI', () => {
  it('starts with collapsed outer loops, reads files only on selection, and resumes the exact recorded lap', async () => {
    const activity = [{ key: 'outer', visitId: 'o', loopId: 'accounts', title: 'Accounts', index: 0, total: 3, item: 'Account 1', at: 1, status: 'incomplete' as const, checkpointId: 'one' },
      { key: 'inner', parentKey: 'outer', visitId: 'i', loopId: 'images', title: 'Images', index: 0, total: 20, item: 'chair.png', at: 2, status: 'failed' as const, checkpointId: 'two' }]
    const records: CheckpointInfo[] = [{ ...cp('start'), ordinal: 0, lapPath: [], outputCount: 0, outputScopes: {}, activity },
      { ...cp('one'), lapPath: ['outer'], outputCount: 0, outputScopes: {} }, { ...cp('two'), lapPath: ['outer', 'inner'], outputScopes: { inner: 1 } }]
    const { api, onRun } = await mount(false, { listCheckpoints: vi.fn(async () => records), checkpointDetail: vi.fn(async id => ({ ...info(id), outputs: info(id).outputs.map(o => ({ ...o, lapKey: 'inner' })) })) })
    expect(row('Accounts')).toBeTruthy()
    expect(document.body.textContent).not.toContain('chair.png')
    expect(api.checkpointDetail).not.toHaveBeenCalled()
    await click(button('Çalışan / yarım kalan turu göster'))
    expect(row('1/20 · chair.png')).toBeTruthy()
    expect(document.querySelector('.checkpoint-outputs')?.textContent).toContain('two.blend')
    await click(button('Seçiliden çalıştır'))
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'two' }))
    await click(row('Images'))
    expect((button('Seçiliden çalıştır') as HTMLButtonElement).disabled).toBe(true)
    expect(document.body.textContent).toContain('0 tur tamamlandı')
  })
  it('keeps successfully read outputs visible when another interval cannot be read', async () => {
    await mount(false, { checkpointDetail: vi.fn(async id => { if (id === 'one') throw Error('file locked'); return info(id) }) })
    await click(row('Tuval'))
    expect(document.querySelector('.checkpoint-outputs')?.textContent).toContain('two.blend')
    expect(document.querySelector('[role=alert]')?.textContent).toContain('eksik olabilir')
  })
  it('shows an off-page failed lap without rendering all siblings and preserves detail-only warnings', async () => {
    const activity = Array.from({ length: 250 }, (_, index) => ({ key: `lap-${index}`, visitId: 'visit', loopId: 'loop', title: 'Images', index, total: 250, item: `image-${index}`, at: index,
      status: index === 249 ? 'failed' as const : 'completed' as const, checkpointId: 'one' }))
    const records: CheckpointInfo[] = [{ ...cp('start'), lapPath: [], activity, outputCount: 0 }, { ...cp('one'), lapPath: ['lap-249'], outputScopes: { 'lap-249': 1 } }]
    await mount(false, { listCheckpoints: vi.fn(async () => records), checkpointDetail: vi.fn(async () => ({ ...info('one'), issues: ['Resume reliability warning'], outputs: info('one').outputs.map(o => ({ ...o, lapKey: 'lap-249' })) })) })
    await click(button('Çalışan / yarım kalan turu göster'))
    expect(row('250/250 · image-249')).toBeTruthy()
    expect(document.querySelectorAll('.checkpoint-row').length).toBeLessThan(110)
    expect(document.body.textContent).toContain('Resume reliability warning')
  })
  it('shows chronological rows and only the selected interval; open/reveal and resume use its exact identity', async () => {
    const { api, onRun } = await mount()
    expect([...document.querySelectorAll('.checkpoint-row b')].map(b => b.textContent)).toEqual(['Tuval', 'one', 'two'])
    await click(row('two'))
    expect(document.querySelector('.checkpoint-outputs')?.textContent).toContain('two.blend')
    expect(document.querySelector('.checkpoint-outputs')?.textContent).not.toContain('one.blend')
    await click(button('Klasörde göster')); expect(api.showInFolder).toHaveBeenCalledWith('C:\\outputs\\two.blend')
    await click(button('Aç')); expect(api.openPath).toHaveBeenCalledWith('C:\\outputs\\two.blend')
    await click(button('Seçiliden çalıştır')); expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'two' }))
  })
  it('allows inspecting a running run while blocking resume without any folder selection controls', async () => {
    const { onRun } = await mount(true)
    await click(row('one'))
    expect((button('Seçiliden çalıştır') as HTMLButtonElement).disabled).toBe(true)
    expect(document.body.textContent).not.toContain('Klasör ekle')
    expect((button('Klasörde göster') as HTMLButtonElement).disabled).toBe(false)
    expect(onRun).not.toHaveBeenCalled()
  })
  it('a late response for the previous selection cannot replace the current output list', async () => {
    let release!: (detail: CheckpointDetail) => void
    await mount(false, { checkpointDetail: vi.fn((id: string) => id === 'one' ? new Promise<CheckpointDetail>(r => { release = r }) : Promise.resolve(info(id))) })
    await click(row('one'))
    await click(row('two'))
    await act(async () => release(info('one')))
    expect(document.querySelector('.checkpoint-outputs')?.textContent).toContain('two.blend')
  })
  it('requires no folder selection and keeps missing outputs visibly unavailable', async () => {
    const missing = info('one'); missing.outputs[0].present = false
    const { onClose } = await mount(false, { checkpointDetail: vi.fn(async () => missing) })
    // Klasör seçme denetimi YOK; yerine "akıştaki klasörler izlenir + tüm disk izleme anahtarı" var.
    expect(document.body.textContent).toContain('Tüm diskleri de izle')
    expect(document.body.textContent).toContain('Yalnız akışta yazılı klasörler izlenir')
    expect(document.body.textContent).not.toContain('Klasör ekle')
    await click(row('one'))
    expect(document.body.textContent).toContain('Artık bu yolda yok')
    expect((button('Aç') as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('tüm disk izleme anahtarı opt-in: işaretlenince çağrılır ve yeni durum gösterilir', async () => {
    let wide = false
    const setCheckpointWideWatch = vi.fn(async (on: boolean) => {
      wide = on
      return { automatic: true as const, active: false, roots: on ? ['C:\\'] : [], issues: [], flowRoots: [], pendingRoots: [], wideWatch: on, source: on ? 'disk' as const : 'yok' as const, skippedPaths: 0 }
    })
    await mount(false, { setCheckpointWideWatch })
    const box = document.querySelector('.checkpoint-wide input') as HTMLInputElement
    expect(box).toBeTruthy()
    expect(box.checked).toBe(false) // varsayılan KAPALI
    await act(async () => { box.click(); await Promise.resolve() })
    expect(setCheckpointWideWatch).toHaveBeenCalledWith(true)
    expect(wide).toBe(true)
    expect(document.body.textContent).toContain('Tüm disk izleme AÇIK')
  })
})
