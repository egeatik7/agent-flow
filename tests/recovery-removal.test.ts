import { createElement, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { DEFAULT_RECOVERY, recoverySettings } from '../electron/recovery-settings'
import RecoverySettingsPanel from '../src/components/RecoverySettingsPanel'
import { DEFAULT_SETTINGS, type AppSettings } from '../electron/graph-types'

it('drops removed provider configuration while preserving dedicated built-in credentials, permissions and instructions', () => {
  const legacy = { ...DEFAULT_RECOVERY, provider: 'harness', enabled: true, harness: { command: 'old.exe', fullControl: true },
    model: 'saved/model', apiKey: 'dedicated-fixture', task: 'Current GLB', allowCode: false }
  const result = recoverySettings(legacy)
  expect(result).toMatchObject({ enabled: false, model: 'saved/model', apiKey: 'dedicated-fixture', task: 'Current GLB', allowCode: false })
  expect(result).not.toHaveProperty('provider'); expect(result).not.toHaveProperty('harness')
  expect(recoverySettings({ ...result, enabled: true }).enabled).toBe(true)
})
it('keeps already configured built-in recovery enabled', () => {
  const legacy = { ...DEFAULT_RECOVERY, provider: 'nubbo', enabled: true, apiKey: 'dedicated', model: 'saved/model' }
  expect(recoverySettings(legacy)).toMatchObject({ enabled: true, apiKey: 'dedicated', model: 'saved/model' })
})
it('exposes built-in controls for old external settings and lets the user enable and save them', async () => {
  vi.stubGlobal('window', { xpAgent: { recoveryReports: async () => [{ id: 'old', provider: 'harness', startedAt: 1, nodeTitle: 'Old recovery',
    error: 'Old error', probableCause: '', evidence: '', summary: 'Historical report kept', result: 'failed', actions: [] }] } })
  const onSave = vi.fn()
  let mounted: ReactTestRenderer | undefined
  function App() {
    const legacy = { ...DEFAULT_RECOVERY, provider: 'harness', enabled: true, model: 'saved/model', apiKey: 'dedicated', harness: { command: 'old.exe' } }
    const [settings, setSettings] = useState<AppSettings>({ ...DEFAULT_SETTINGS, recovery: legacy })
    return createElement(RecoverySettingsPanel, { settings, setSettings, onSave, graph: { nodes: [], edges: [] }, models: [], onLoadModels: () => {} })
  }
  try {
    await act(async () => { mounted = create(createElement(App)) })
    expect(mounted!.root.findAllByProps({ id: 'recovery-provider' })).toHaveLength(0)
    expect(mounted!.root.findAllByProps({ id: 'harness-program' })).toHaveLength(0)
    expect(mounted!.root.findByProps({ id: 'recovery-api-key' }).props.value).toBe('dedicated')
    expect(JSON.stringify(mounted!.toJSON())).toContain('Historical report kept')
    const enabled = mounted!.root.findAllByType('input').find(i => i.props.type === 'checkbox')!
    expect(enabled.props.checked).toBe(false)
    act(() => enabled.props.onChange({ target: { checked: true } }))
    act(() => mounted!.root.findAllByType('button').find(b => b.children.includes('Kurtarma Ayarlarını Kaydet'))!.props.onClick())
    expect(onSave.mock.calls[0][0].recovery).toMatchObject({ enabled: true, model: 'saved/model', apiKey: 'dedicated' })
    expect(onSave.mock.calls[0][0].recovery).not.toHaveProperty('harness')
  } finally { if (mounted) act(() => mounted!.unmount()); vi.unstubAllGlobals() }
})
