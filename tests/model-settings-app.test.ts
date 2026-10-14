import { act, createElement } from 'react'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../electron/graph-types'
import SidePanel from '../src/components/SidePanel'
let App: typeof import('../src/App').default
vi.mock('../src/components/TitleBar', () => ({ default: () => null }))
vi.mock('../src/components/Toolbar', () => ({ default: () => null }))
vi.mock('../src/components/NodeCanvas', () => ({ default: () => null }))
vi.mock('../src/components/CanvasTabs', () => ({ default: () => null }))
vi.mock('../src/components/SidePanel', () => ({ default: () => null }))
vi.mock('../src/components/LogPanel', () => ({ default: () => null }))
let mounted: ReactTestRenderer | undefined
let stored: any
const api: any = {}
const panel = () => mounted!.root.findByType(SidePanel).props
beforeEach(async () => {
  stored = { ...DEFAULT_SETTINGS, localBaseUrl: 'http://localhost:8080/v1' }
  Object.assign(api, {
    getSettings: async () => structuredClone(stored),
    getCanvases: async () => ({ activeId: '', tabs: [], library: { schemaVersion: 2, automations: [], canvases: [] } }),
    saveCanvases: async () => true,
    listWindows: async () => [], bootReady: () => {}, onAgentLog: () => () => {}, onAgentStep: () => () => {}, onAgentPatch: () => () => {},
    listLocalModels: vi.fn(async () => [{ id: 'fixture', vision: false }]),
    listModels: async () => [{ id: 'cloud/fixture', vision: true }],
    saveSettings: vi.fn(async (partial: any) => { stored = { ...stored, ...partial, ...(partial.recovery ? { recovery: { ...stored.recovery, ...partial.recovery } } : {}) }; return structuredClone(stored) }),
  })
  vi.stubGlobal('window', { xpAgent: api, addEventListener: () => {}, removeEventListener: () => {}, setTimeout, clearTimeout })
  vi.stubGlobal('requestAnimationFrame', (cb: any) => { cb(); return 0 })
  App = (await import('../src/App')).default
  await act(async () => { mounted = create(createElement(App)) })
})
afterEach(() => { if (mounted) act(() => mounted!.unmount()); mounted = undefined; vi.unstubAllGlobals() })
it('refreshing the cloud catalog preserves local choices and a live vision declaration', async () => {
  await act(async () => { await panel().onLoadLocalModels() })
  await act(async () => { await panel().onLoadModels() })
  expect(panel().models.map((m: any) => m.id)).toEqual(['cloud/fixture', 'local:fixture'])
  act(() => panel().setSettings((s: any) => ({ ...s, localVision: true })))
  expect(panel().models.find((m: any) => m.id === 'local:fixture').vision).toBe(true)
  act(() => panel().setSettings((s: any) => ({ ...s, localVision: false })))
  expect(panel().models.find((m: any) => m.id === 'local:fixture').vision).toBe(false)
})
it('automatic edits persist alongside an explicit partial save', async () => {
  act(() => panel().setSettings((s: any) => ({ ...s, model: 'local:draft', localBaseUrl: 'http://localhost:9999/v1' })))
  await act(async () => { await panel().onSaveSettings({ apiKey: 'saved-cloud-key' }) })
  expect(panel().settings).toMatchObject({ model: 'local:draft', localBaseUrl: 'http://localhost:9999/v1', apiKey: 'saved-cloud-key' })
})
it('a failed local request propagates an error instead of claiming an empty success', async () => {
  api.listLocalModels.mockRejectedValueOnce(new Error('server unavailable'))
  await act(async () => { await expect(panel().onLoadLocalModels()).rejects.toThrow('server unavailable') })
  expect(panel().models).toEqual([])
})
it('a model response from a previous server address cannot populate the current catalog', async () => {
  let reply!: (models: any[]) => void
  api.listLocalModels.mockImplementationOnce(() => new Promise(resolve => { reply = resolve }))
  let response!: Promise<unknown>
  await act(async () => { response = panel().onLoadLocalModels().catch((e: Error) => e.message) })
  act(() => panel().setSettings((s: any) => ({ ...s, localBaseUrl: 'http://localhost:9999/v1' })))
  await act(async () => { reply([{ id: 'old-server', vision: true }]); await response })
  expect(await response).toContain('Sunucu adresi değişti')
  expect(panel().models).toEqual([])
})

it('serializes in-flight saves; older replies cannot replace newer visible typing', async () => {
  const requests: any[] = [], completions: ((value: any) => void)[] = []
  api.saveSettings = vi.fn((partial: any) => { requests.push(partial); return new Promise(resolve => completions.push(resolve)) })
  let first!: Promise<void>, second!: Promise<void>
  await act(async () => { first = panel().onSaveSettings({ model: 'A', modelBackups: ['B'] }) })
  await act(async () => { second = panel().onSaveSettings({ model: 'B', modelBackups: ['A'] }) })
  expect(requests).toHaveLength(1)
  expect(panel().settings.model).toBe('B')
  await act(async () => { completions[0]({ ...DEFAULT_SETTINGS, ...requests[0], modelRevision: 1 }) })
  expect(requests).toHaveLength(2)
  expect(panel().settings.model).toBe('B')
  expect(panel().savedSettings.model).toBe('A')
  await act(async () => { completions[1]({ ...DEFAULT_SETTINGS, ...requests[1], modelRevision: 2 }); await Promise.all([first, second]) })
  expect(panel().settings).toMatchObject({ model: 'B', modelBackups: ['A'], modelRevision: 2 })
  expect(panel().savedSettings.model).toBe('B')
  expect(panel().settingsSaveStatus).toContain('Otomatik kaydedildi')
})
it('automatic typing survives normalization and a disk failure is visibly reported', async () => {
  const completions: ((value: any) => void)[] = []
  api.saveSettings = () => new Promise(resolve => completions.push(resolve))
  let pending!: Promise<void>
  await act(async () => { pending = panel().onSaveSettings({ visionModel: 'A' }) })
  act(() => panel().setSettings((s: any) => ({ ...s, visionModel: 'new draft ' })))
  await act(async () => { completions[0]({ ...DEFAULT_SETTINGS, visionModel: 'A' }) })
  expect(panel().settings.visionModel).toBe('new draft ')
  await act(async () => { completions[1]({ ...DEFAULT_SETTINGS, visionModel: 'new draft' }); await pending })
  expect(panel().settings.visionModel).toBe('new draft ')
  expect(panel().savedSettings.visionModel).toBe('new draft')
  api.saveSettings = async () => { throw new Error('fixture disk failure') }
  await act(async () => { await panel().onSaveSettings({ visionModel: 'B' }) })
  expect(panel().settingsSaveStatus).toContain('Kaydedilemedi')
})
it('reopening loads automatically saved settings without touching a Save button', async () => {
  await act(async () => panel().setSettings((s: any) => ({ ...s, model: 'local:owl', modelBackups: ['fallback'], localTimeoutMs: 12345,
    localThink: false, sendScreenshot: true, llmPrompts: { ...s.llmPrompts, list: 'custom instruction\n' }, recovery: { ...s.recovery, task: 'custom recovery' } })))
  expect(stored).toMatchObject({ model: 'local:owl', localTimeoutMs: 12345, localThink: false, recovery: { task: 'custom recovery' } })
  act(() => mounted!.unmount())
  await act(async () => { mounted = create(createElement(App)) })
  expect(panel().settings).toMatchObject({ model: 'local:owl', modelBackups: ['fallback'], localTimeoutMs: 12345,
    localThink: false, sendScreenshot: true, llmPrompts: { list: 'custom instruction\n' }, recovery: { task: 'custom recovery' } })
})
it('tests and catalog requests wait for pending saves and do not run after a failed save', async () => {
  let complete!: (value: any) => void
  api.saveSettings = () => new Promise(resolve => { complete = resolve })
  api.testVision = vi.fn(async () => ({ model: 'B', text: 'fixture' }))
  let test!: Promise<void>
  await act(async () => panel().setSettings((s: any) => ({ ...s, visionModel: 'B' })))
  await act(async () => { test = panel().onTestVision() })
  expect(api.testVision).not.toHaveBeenCalled()
  await act(async () => { complete({ ...stored, visionModel: 'B' }); await test })
  expect(api.testVision).toHaveBeenCalledOnce()
  api.saveSettings = async () => { throw new Error('disk failure') }
  await act(async () => panel().setSettings((s: any) => ({ ...s, localBaseUrl: 'http://localhost:9999/v1' })))
  await act(async () => { await expect(panel().onLoadLocalModels()).rejects.toThrow('Ayar kaydı') })
  expect(api.listLocalModels).not.toHaveBeenCalled()
})

it('closing waits for the last automatic write and refuses to close after a disk failure', async () => {
  let close!: (id: number) => void
  api.onCloseRequested = (callback: any) => { close = callback; return () => {} }
  api.finishClose = vi.fn(async () => {})
  act(() => mounted!.unmount())
  await act(async () => { mounted = create(createElement(App)) })
  let finish!: (value: any) => void
  api.saveSettings = () => new Promise(resolve => { finish = resolve })
  await act(async () => panel().setSettings((s: any) => ({ ...s, model: 'persistent' })))
  await act(async () => close(1))
  expect(api.finishClose).not.toHaveBeenCalled()
  await act(async () => { finish({ ...stored, model: 'persistent' }) })
  expect(api.finishClose).toHaveBeenCalledWith(1, true)
  api.saveSettings = async () => { throw new Error('disk failure') }
  await act(async () => panel().setSettings((s: any) => ({ ...s, model: 'failed' })))
  await act(async () => close(2))
  expect(api.finishClose).toHaveBeenLastCalledWith(2, false)
})
