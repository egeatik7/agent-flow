import { act, createElement, useState } from 'react'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../electron/graph-types'
import LocalModelSettings from '../src/components/LocalModelSettings'
import ModelChain from '../src/components/ModelChain'
let mounted: ReactTestRenderer | undefined
afterEach(() => { if (mounted) act(() => mounted!.unmount()); mounted = undefined })
it('shows server failure and distinguishes a real empty model list', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('Connection refused')).mockResolvedValueOnce([])
  act(() => { mounted = create(createElement(LocalModelSettings, { settings: { ...DEFAULT_SETTINGS, localBaseUrl: 'http://localhost:8080' }, setSettings: () => {}, onSave: () => {}, onLoad: load, models: [] })) })
  const connect = () => mounted!.root.findAllByType('button').find(b => b.children.includes('Bağlan ve modelleri getir'))!
  await act(async () => { await connect().props.onClick() })
  expect(JSON.stringify(mounted!.toJSON())).toContain('Connection refused')
  await act(async () => { await connect().props.onClick() })
  expect(JSON.stringify(mounted!.toJSON())).toContain('model listesi boş')
})
it('adds a local model to the same chain and can promote it without losing the cloud model', () => {
  function Harness() {
    const [rows, setRows] = useState(['cloud/first', ''])
    return createElement(ModelChain, { primary: rows[0], backups: rows.slice(1), listId: 'list', placeholder: '', localModels: [{ id: 'local:fixture' }], onChange: (primary, backups) => setRows([primary, ...backups]) })
  }
  act(() => { mounted = create(createElement(Harness)) })
  act(() => mounted!.root.findByType('select').props.onChange({ target: { value: 'local:fixture' } }))
  const rows = () => mounted!.root.findAllByProps({ className: 'backup-row' })
  act(() => rows()[1].findAllByType('button').find(b => b.props.title === 'Yukarı')!.props.onClick())
  expect(rows().map(row => row.findByType('input').props.value)).toEqual(['local:fixture', 'cloud/first'])
})
