import { createElement, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RecoverySettingsPanel from '../src/components/RecoverySettingsPanel'
import { createNode, DEFAULT_SETTINGS, type AppSettings } from '../electron/graph-types'
import { DEFAULT_RECOVERY } from '../electron/recovery-settings'

let mounted: ReactTestRenderer | undefined
afterEach(() => { if (mounted) act(() => mounted!.unmount()); mounted = undefined; vi.unstubAllGlobals() })
describe('recovery settings UI', () => {
  it('saves the model, task and selected leaf permissions while excluding initiative and condition nodes', async () => {
    vi.stubGlobal('window', { xpAgent: { recoveryReports: async () => [] } })
    const click = { ...createNode('click', 0, 0), id: 'click', title: 'Open Blender' }
    const condition = { ...createNode('condition', 0, 0), id: 'condition', title: 'FORBIDDEN CONDITION' }
    const ai = { ...createNode('ai', 0, 0), id: 'ai', title: 'FORBIDDEN INITIATIVE' }
    const onSave = vi.fn()
    function Harness() {
      const [settings, setSettings] = useState<AppSettings>({ ...DEFAULT_SETTINGS, recovery: DEFAULT_RECOVERY })
      return createElement(RecoverySettingsPanel, { settings, setSettings, onSave, graph: { nodes: [click, condition, ai], edges: [] }, models: [], onLoadModels: () => {} })
    }
    await act(async () => { mounted = create(createElement(Harness)) })
    const input = (id: string) => mounted!.root.findByProps({ id })
    act(() => input('recovery-model').props.onChange({ target: { value: 'fixture/smart-model' } }))
    act(() => input('recovery-task').props.onChange({ target: { value: 'Open Blender and process the current GLB.' } }))
    // Search the checkbox list through its rendered text rather than implementation state.
    const check = mounted!.root.findByProps({ className: 'recovery-node-list' }).findByType('input')
    act(() => check.props.onChange({ target: { checked: true } }))
    act(() => mounted!.root.findAllByType('button').find(b => b.children.includes('Kurtarma Ayarlarını Kaydet'))!.props.onClick())
    expect(onSave.mock.calls[0][0].recovery).toMatchObject({ model: 'fixture/smart-model', task: 'Open Blender and process the current GLB.', allowedNodeIds: ['click'] })
    expect(JSON.stringify(mounted!.toJSON())).not.toContain('FORBIDDEN')
  })
  it('shows saved probable cause, evidence, actions and the actual resume result', async () => {
    vi.stubGlobal('window', { xpAgent: { recoveryReports: async () => [{ id: 'r', startedAt: 1, nodeTitle: 'Open Blender', error: 'Missing target',
      probableCause: 'Chrome may have covered the shortcut', evidence: 'Chrome was in front', summary: 'Returned to desktop', result: 'completed', resumed: true, completionBasis: 'model-observed',
      actions: [{ tool: 'act_key', message: 'Win+D sent' }] }] } })
    await act(async () => { mounted = create(createElement(RecoverySettingsPanel, { settings: DEFAULT_SETTINGS, setSettings: () => {}, onSave: () => {}, graph: { nodes: [], edges: [] }, models: [], onLoadModels: () => {} })) })
    const text = JSON.stringify(mounted!.toJSON())
    expect(text).toContain('Chrome may have covered'); expect(text).toContain('Win+D sent')
    expect(text).toContain('akış devam etti'); expect(text).toContain('güncel ekranı görerek')
  })
})
