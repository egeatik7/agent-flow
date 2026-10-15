import { act, createElement, useState } from 'react'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import ModelChain from '../src/components/ModelChain'
let mounted: ReactTestRenderer | undefined
afterEach(() => { if (mounted) act(() => mounted!.unmount()); mounted = undefined })
function mount() {
  const commit = vi.fn()
  function Fixture() {
    const [rows, setRows] = useState(['A', 'B'])
    return createElement(ModelChain, { primary: rows[0], backups: rows.slice(1), listId: 'models', placeholder: '', localModels: [{ id: 'local:fixture' }], onChange: (a, b) => setRows([a, ...b]), onCommit: commit })
  }
  act(() => { mounted = create(createElement(Fixture)) })
  return commit
}
it('reorder, delete and local selection commit immediately; adding an empty row also emits its change', () => {
  const commit = mount()
  act(() => mounted!.root.findAllByProps({ title: 'Yukarı' })[1].props.onClick())
  expect(commit).toHaveBeenLastCalledWith('B', ['A'])
  act(() => mounted!.root.findAllByProps({ title: 'Bu modeli sil' })[1].props.onClick())
  expect(commit).toHaveBeenLastCalledWith('B', [])
  act(() => mounted!.root.findByProps({ className: 'xp-btn backup-add' }).props.onClick())
  expect(commit).toHaveBeenCalledTimes(3)
  act(() => mounted!.root.findByProps({ 'aria-label': 'Yerel model ekle' }).props.onChange({ target: { value: 'local:fixture' } }))
  expect(commit).toHaveBeenLastCalledWith('B', ['local:fixture'])
})
it('typing remains a draft; Enter and blur commit it', () => {
  const commit = mount()
  act(() => mounted!.root.findAllByType('input')[0].props.onChange({ target: { value: 'local:new-model' } }))
  expect(commit).not.toHaveBeenCalled()
  const preventDefault = vi.fn(), stopPropagation = vi.fn()
  act(() => mounted!.root.findAllByType('input')[0].props.onKeyDown({ key: 'Enter', preventDefault, stopPropagation }))
  expect(commit).toHaveBeenLastCalledWith('local:new-model', ['B'])
  expect(preventDefault).toHaveBeenCalled()
  act(() => mounted!.root.findAllByType('input')[0].props.onChange({ target: { value: 'C' } }))
  act(() => mounted!.root.findAllByType('input')[0].props.onBlur())
  expect(commit).toHaveBeenLastCalledWith('C', ['B'])
})
