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
const api: any = {}
const panel = () => mounted!.root.findByType(SidePanel).props
beforeEach(async () => {
  Object.assign(api, {
    getSettings: async () => ({ ...DEFAULT_SETTINGS, localBaseUrl: 'http://localhost:8080/v1' }),
    getCanvases: async () => ({ activeId: '', tabs: [], library: { schemaVersion: 2, automations: [], canvases: [] } }),
    listWindows: async () => [], bootReady: () => {}, onAgentLog: () => () => {}, onAgentStep: () => () => {}, onAgentPatch: () => () => {},
    listLocalModels: vi.fn(async () => [{ id: 'fixture', vision: false }]),
    listModels: async () => [{ id: 'cloud/fixture', vision: true }],
    saveSettings: async (partial: any) => ({ ...DEFAULT_SETTINGS, ...partial }),
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
it('a partial save preserves an unrelated unsaved model draft', async () => {
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
  act(() => { response = panel().onLoadLocalModels().catch((e: Error) => e.message) })
  act(() => panel().setSettings((s: any) => ({ ...s, localBaseUrl: 'http://localhost:9999/v1' })))
  await act(async () => { reply([{ id: 'old-server', vision: true }]); await response })
  expect(await response).toContain('Sunucu adresi değişti')
  expect(panel().models).toEqual([])
})
