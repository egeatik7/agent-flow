import { act, createElement, useState } from 'react'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type AppSettings } from '../electron/graph-types'
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
it('yerel sekmesinde düşünme modu seçilir ve kayda geçer', () => {
  const saved: any[] = []
  function Harness() {
    const [s, setS] = useState<AppSettings>({ ...DEFAULT_SETTINGS, localBaseUrl: 'http://127.0.0.1:11434/v1' })
    return createElement(LocalModelSettings, { settings: s, setSettings: setS, onSave: p => saved.push(p), models: [] })
  }
  act(() => { mounted = create(createElement(Harness)) })
  const sec = () => mounted!.root.findAllByType('select').find(x => x.props.id === 'local-think')!
  expect(sec().props.value).toBe('')
  act(() => sec().props.onChange({ target: { value: 'none' } }))
  expect(sec().props.value).toBe('none')
  const kaydet = mounted!.root.findAllByType('button').find(b => b.children.includes('Yerel ayarları kaydet'))!
  act(() => kaydet.props.onClick())
  expect(saved[0].localThink).toBe('none')
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
