// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CheckpointsPanel from '../src/components/CheckpointsPanel'
import type { XpAgentApi } from '../src/types'
import type { CheckpointDetail, CheckpointInfo } from '../electron/checkpoint-types'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
const cp = (id: string): CheckpointInfo => ({ id, runId: 'run', ordinal: 1, canvasId: 'canvas', canvasName: id, label: 'Lap 2', at: 100, endedAt: 200, status: 'completed', outputCount: 1, roots: ['C:\\outputs'], issues: [] })
const info = (id: string): CheckpointDetail => ({ ...cp(id), outputs: [{ path: `C:\\outputs\\${id}.blend`, kind: 'file', change: 'created', firstSeen: 120, lastSeen: 130, size: 10, present: true }] })
const click = async (button: Element) => { await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() }) }
function button(text: string) { const match = [...document.querySelectorAll('button')].find(b => b.textContent === text); if (!match) throw new Error(`Missing ${text}`); return match }
async function mount(running = false, overrides: Partial<XpAgentApi> = {}) {
  const api = { listCheckpoints: vi.fn(async () => [cp('one'), cp('two')]), checkpointMonitoring: vi.fn(async () => ({ automatic: true, active: running, roots: ['C:\\'], issues: [] })), checkpointDetail: vi.fn(async (id: string) => info(id)), checkpointSnapshot: vi.fn(), openPath: vi.fn(async () => true), showInFolder: vi.fn(async () => true), ...overrides } as unknown as XpAgentApi
  const onRun = vi.fn(async () => {}), onClose = vi.fn()
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root!.render(createElement(CheckpointsPanel, { api, running, busy: false, onRun, onClose })); await Promise.resolve() })
  return { api, onRun, onClose }
}
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ''; vi.restoreAllMocks() })
describe('checkpoint UI', () => {
  it('shows chronological rows and only the selected interval; open/reveal and resume use its exact identity', async () => {
    const { api, onRun } = await mount()
    expect([...document.querySelectorAll('.checkpoint-row b')].map(b => b.textContent)).toEqual(['1. one', '2. two'])
    await click(document.querySelectorAll('.checkpoint-row')[1])
    expect(document.querySelector('.checkpoint-outputs')?.textContent).toContain('two.blend')
    expect(document.querySelector('.checkpoint-outputs')?.textContent).not.toContain('one.blend')
    await click(button('Klasörde göster')); expect(api.showInFolder).toHaveBeenCalledWith('C:\\outputs\\two.blend')
    await click(button('Aç')); expect(api.openPath).toHaveBeenCalledWith('C:\\outputs\\two.blend')
    await click(button('Seçiliden çalıştır')); expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'two' }))
  })
  it('allows inspecting a running run while blocking resume without any folder selection controls', async () => {
    const { onRun } = await mount(true)
    await click(document.querySelector('.checkpoint-row')!)
    expect((button('Seçiliden çalıştır') as HTMLButtonElement).disabled).toBe(true)
    expect(document.body.textContent).not.toContain('Klasör ekle')
    expect((button('Klasörde göster') as HTMLButtonElement).disabled).toBe(false)
    expect(onRun).not.toHaveBeenCalled()
  })
  it('a late response for the previous selection cannot replace the current output list', async () => {
    let release!: (detail: CheckpointDetail) => void
    await mount(false, { checkpointDetail: vi.fn((id: string) => id === 'one' ? new Promise<CheckpointDetail>(r => { release = r }) : Promise.resolve(info(id))) })
    await click(document.querySelectorAll('.checkpoint-row')[0])
    await click(document.querySelectorAll('.checkpoint-row')[1])
    await act(async () => release(info('one')))
    expect(document.querySelector('.checkpoint-outputs')?.textContent).toContain('two.blend')
  })
  it('requires no folder selection and keeps missing outputs visibly unavailable', async () => {
    const missing = info('one'); missing.outputs[0].present = false
    const { onClose } = await mount(false, { checkpointDetail: vi.fn(async () => missing) })
    expect(document.body.textContent).toContain('klasör seçmen gerekmez')
    expect(document.body.textContent).not.toContain('Klasör ekle')
    await click(document.querySelector('.checkpoint-row')!)
    expect(document.body.textContent).toContain('Artık bu yolda yok')
    expect((button('Aç') as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
