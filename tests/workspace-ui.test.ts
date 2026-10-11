// @vitest-environment jsdom
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CanvasTabs from '../src/components/CanvasTabs'
import SaveCanvasDialog from '../src/components/SaveCanvasDialog'
import WorkspaceNameDialog from '../src/components/WorkspaceNameDialog'

let mounted: ReactTestRenderer | undefined
afterEach(() => { if (mounted) act(() => mounted!.unmount()); mounted = undefined })
const props = () => ({ tabs: [{ id: 'tab', name: 'Before' }], activeId: 'tab', disabled: false, running: false,
  onSelect: vi.fn(), onAdd: vi.fn(), onClose: vi.fn(), onRename: vi.fn(), onMove: vi.fn(), onRunAll: vi.fn(), onStop: vi.fn() })

describe('workspace document controls', () => {
  it('flushes a partially typed tab name exactly once before a native save/close', async () => {
    const p = props(); let flush: (() => void) | null = null
    act(() => { mounted = create(createElement(CanvasTabs, { ...p, onRegisterRenameFlush: value => { flush = value } })) })
    act(() => mounted!.root.findByProps({ role: 'tab' }).props.onDoubleClick({ preventDefault: vi.fn() }))
    act(() => mounted!.root.findByProps({ 'aria-label': 'Tuval adı' }).props.onChange({ target: { value: 'Typed before close' } }))
    const blur = mounted!.root.findByProps({ 'aria-label': 'Tuval adı' }).props.onBlur
    act(() => flush!())
    act(() => blur())
    expect(p.onRename.mock.calls).toEqual([['tab', 'Typed before close']])
  })
  it('Escape discards an unfinished name so a later close cannot commit it', () => {
    const p = props(); let flush: (() => void) | null = null
    act(() => { mounted = create(createElement(CanvasTabs, { ...p, onRegisterRenameFlush: value => { flush = value } })) })
    act(() => mounted!.root.findByProps({ role: 'tab' }).props.onDoubleClick({ preventDefault: vi.fn() }))
    act(() => mounted!.root.findByProps({ 'aria-label': 'Tuval adı' }).props.onChange({ target: { value: 'Discarded' } }))
    act(() => mounted!.root.findByProps({ 'aria-label': 'Tuval adı' }).props.onKeyDown({ key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() }))
    act(() => flush!())
    expect(p.onRename).not.toHaveBeenCalled()
  })
  it('uses the same three Save/Discard/Cancel choices for an automation and Escape cancels', () => {
    const answer = vi.fn()
    act(() => { mounted = create(createElement(SaveCanvasDialog, { name: 'Pipeline', kind: 'automation', onAnswer: answer })) })
    expect(JSON.stringify(mounted!.toJSON())).toContain('otomasyonundaki')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(answer.mock.calls).toEqual([['cancel']])
  })
  it('accepts a trimmed name and never submits whitespace as a new record', () => {
    const answer = vi.fn()
    act(() => { mounted = create(createElement(WorkspaceNameDialog, { title: 'Save As', initial: ' Before ', onAnswer: answer })) })
    act(() => mounted!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }))
    expect(answer.mock.calls).toEqual([['Before']])
    act(() => mounted!.root.findByType('input').props.onChange({ target: { value: '   ' } }))
    act(() => mounted!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }))
    expect(answer).toHaveBeenCalledTimes(1)
  })
})
