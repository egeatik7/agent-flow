import { createElement, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import RecoverySettingsPanel from '../src/components/RecoverySettingsPanel'
import { DEFAULT_SETTINGS, type AppSettings } from '../electron/graph-types'
import { DEFAULT_RECOVERY } from '../electron/recovery-settings'
it('selects Harness, picks a program, tests the draft, and saves continuous full control without a legacy model', async () => {
  const testHarness = vi.fn(async () => ({ ok: true, message: 'MCP ready' })), onSave = vi.fn()
  vi.stubGlobal('window', { xpAgent: { recoveryReports: async () => [], pickHarness: async () => 'C:\\DSH\\dsh.cmd', testHarness } })
  let mounted: ReactTestRenderer | undefined
  function App() {
    const [settings, setSettings] = useState<AppSettings>({ ...DEFAULT_SETTINGS, recovery: { ...DEFAULT_RECOVERY, enabled: true } })
    return createElement(RecoverySettingsPanel, { settings, setSettings, onSave, graph: { nodes: [], edges: [] }, models: [], onLoadModels: () => {} })
  }
  try {
    await act(async () => { mounted = create(createElement(App)) })
    act(() => mounted!.root.findByProps({ id: 'recovery-provider' }).props.onChange({ target: { value: 'harness' } }))
    expect(mounted!.root.findAllByProps({ id: 'recovery-model' })).toHaveLength(0)
    const button = (text: string) => mounted!.root.findAllByType('button').find(b => b.children.includes(text))!
    await act(async () => { await button('Program seç…').props.onClick() })
    expect(mounted!.root.findByProps({ id: 'harness-program' }).props.value).toBe('C:\\DSH\\dsh.cmd')
    await act(async () => { await button('Bağlantıyı dene').props.onClick() })
    expect(testHarness).toHaveBeenCalledWith(expect.objectContaining({ command: 'C:\\DSH\\dsh.cmd', fullControl: true, timeoutMs: 0, autoContinue: true }))
    act(() => button('Kurtarma Ayarlarını Kaydet').props.onClick())
    expect(onSave.mock.calls[0][0].recovery).toMatchObject({ provider: 'harness', enabled: true, model: '', harness: { fullControl: true, timeoutMs: 0 } })
    expect(JSON.stringify(mounted!.toJSON())).toContain('diğer kurtarma ajanı çağrılmaz')
  } finally { if (mounted) act(() => mounted!.unmount()); vi.unstubAllGlobals() }
})
