import { act, createElement } from 'react'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../electron/graph-types'
import SidePanel from '../src/components/SidePanel'
import ModelChain from '../src/components/ModelChain'
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

it('a late catalog reply cannot overwrite a newer result', async () => {
  const complete: ((models: any[]) => void)[] = []
  api.listLocalModels.mockImplementation(() => new Promise(resolve => complete.push(resolve)))
  let older!: Promise<unknown>, newer!: Promise<unknown>
  await act(async () => { older = panel().onLoadLocalModels() })
  // Reachable by switching away from the Local settings section and reopening it:
  // the per-component busy flag resets, but the first App callback remains active.
  await act(async () => { newer = panel().onLoadLocalModels() })
  await act(async () => { complete[1]([{ id: 'latest-inventory', vision: true }]); await newer })
  expect(panel().models.map((m: any) => m.id)).toEqual(['local:latest-inventory'])
  await act(async () => { complete[0]([{ id: 'old-inventory', vision: false }]); await older })
  // The completed newer request owns the catalog.
  expect(panel().models.map((m: any) => m.id)).toEqual(['local:latest-inventory'])
})

it('AUDIT: failed autosave stays blocked until the same failed field is retried', async () => {
  api.saveSettings = vi.fn().mockRejectedValueOnce(new Error('disk unavailable')).mockImplementation(async (patch: any) => {
    stored = { ...stored, ...patch }; return structuredClone(stored)
  })
  api.testVision = vi.fn(async () => ({ model: 'fixture', text: 'ok' }))
  await act(async () => panel().setSettings((s: any) => ({ ...s, localTimeoutMs: 321000 })))
  await act(async () => panel().setSettings((s: any) => ({ ...s, visionModel: 'new-model' })))
  await act(async () => { await panel().onTestVision() })
  expect(api.testVision).not.toHaveBeenCalled()
  expect(panel().settingsSaveStatus).toContain('localTimeoutMs')
  await act(async () => { await panel().onSaveSettings({ localTimeoutMs: 321000 }) })
  await act(async () => { await panel().onTestVision() })
  expect(api.testVision).toHaveBeenCalledOnce()
})

it('AUDIT: prompt deletion survives an outstanding earlier prompt save', async () => {
  const requests: any[] = [], complete: ((value: any) => void)[] = []
  api.saveSettings = (patch: any) => { requests.push(patch); return new Promise(resolve => complete.push(resolve)) }
  await act(async () => panel().setSettings((s: any) => ({ ...s, llmPrompts: { list: 'custom' } })))
  await act(async () => panel().setSettings((s: any) => ({ ...s, llmPrompts: {} })))
  await act(async () => { complete[0]({ ...stored, llmPrompts: { list: 'custom' } }) })
  expect(panel().settings.llmPrompts).toEqual({})
  expect(requests[1]).toEqual({ llmPrompts: {} })
  await act(async () => { complete[1]({ ...stored, llmPrompts: {} }) })
  expect(panel().savedSettings.llmPrompts).toEqual({})
})

it('AUDIT: a local model catalog request waits through all queued settings writes', async () => {
  const requests: any[] = [], complete: ((value: any) => void)[] = []
  api.saveSettings = (patch: any) => { requests.push(patch); return new Promise(resolve => complete.push(resolve)) }
  await act(async () => panel().setSettings((s: any) => ({ ...s, model: 'first' })))
  await act(async () => panel().setSettings((s: any) => ({ ...s, localBaseUrl: 'http://localhost:9001/v1' })))
  let catalog!: Promise<unknown>
  await act(async () => { catalog = panel().onLoadLocalModels() })
  expect(api.listLocalModels).not.toHaveBeenCalled()
  await act(async () => { complete[0]({ ...stored, ...requests[0] }) })
  expect(api.listLocalModels).not.toHaveBeenCalled()
  await act(async () => { complete[1]({ ...stored, ...requests[1] }); await catalog })
  expect(api.listLocalModels).toHaveBeenCalledWith('http://localhost:9001/v1')
})

it('unfinished model text stays local until blur confirmation', async () => {
  // Exercise the actual model row component with App's actual autosave setter.
  let row!: ReactTestRenderer
  act(() => { row = create(createElement(ModelChain, { primary: 'old/model', backups: [], listId: 'audit-models', placeholder: '',
    onChange: (model, backups) => panel().setSettings((s: any) => ({ ...s, recovery: { ...s.recovery, model, backups } })) })) })
  await act(async () => { row.root.findByType('input').props.onChange({ target: { value: 'new/prov' } }) })
  // No runtime settings write has happened while the row is still being edited.
  expect(stored.recovery?.model).toBe(DEFAULT_SETTINGS.recovery?.model)
  expect(panel().savedSettings.recovery?.model).toBe(DEFAULT_SETTINGS.recovery?.model)
  await act(async () => { row.root.findByType('input').props.onBlur() })
  expect(stored.recovery.model).toBe('new/prov')
  act(() => row.unmount())
})
