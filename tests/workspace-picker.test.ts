// @vitest-environment jsdom
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkspaceWelcome, { WorkspacePicker } from '../src/components/WorkspaceWelcome'
import type { CanvasLibrary } from '../electron/graph-types'
const library: CanvasLibrary = {
  canvases: [{ id: 'canvas-1', name: 'First', updatedAt: 1, graph: { nodes: [], edges: [] } }],
  automations: [{ id: 'empty', name: 'Empty', updatedAt: 1, entries: [] }],
}
let mounted: ReactTestRenderer | undefined
const buttons = () => mounted!.root.findAllByType('button')
const action = (text: string) => buttons().find(b => b.children.includes(text))!
afterEach(() => { if (mounted) act(() => mounted!.unmount()); mounted = undefined })
describe('workspace entry and saved-item picker', () => {
  it('routes each welcome card to its intended action', () => {
    const onOpen = vi.fn(), onNew = vi.fn()
    act(() => { mounted = create(createElement(WorkspaceWelcome, { disabled: false, onOpen, onNew })) })
    act(() => buttons()[0].props.onClick()); act(() => buttons()[1].props.onClick()); act(() => buttons()[2].props.onClick())
    expect(onOpen.mock.calls).toEqual([['canvas'], ['automation']])
    expect(onNew).toHaveBeenCalledOnce()
  })
  it('waits for persistence before dismissing and suppresses duplicate open requests', async () => {
    let resolve!: (ok: boolean) => void
    const onOpen = vi.fn(() => new Promise<boolean>(done => { resolve = done })), onCancel = vi.fn()
    act(() => { mounted = create(createElement(WorkspacePicker, { kind: 'canvas', library, onOpen, onCancel })) })
    let opening!: Promise<void>
    await act(async () => { opening = action('Aç').props.onClick() })
    expect(onCancel).not.toHaveBeenCalled()
    expect(action('Açılıyor…').props.disabled).toBe(true)
    await act(async () => { await buttons().find(b => b.props.className?.includes('workspace-picker-row'))!.props.onDoubleClick() })
    expect(onOpen).toHaveBeenCalledOnce()
    await act(async () => { resolve(true); await opening })
    expect(onCancel).toHaveBeenCalledOnce()
  })
  it('retains a failed selection and allows retry', async () => {
    const onOpen = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true), onCancel = vi.fn()
    act(() => { mounted = create(createElement(WorkspacePicker, { kind: 'canvas', library, onOpen, onCancel })) })
    await act(async () => { await action('Aç').props.onClick() })
    expect(onCancel).not.toHaveBeenCalled()
    expect(mounted!.root.findAllByType('p').some(p => p.children.includes('Açılamadı. Kayıtları kontrol edip tekrar deneyebilirsin.'))).toBe(true)
    await act(async () => { await action('Aç').props.onClick() })
    expect(onCancel).toHaveBeenCalledOnce()
  })
  it('does not open empty automations, including by double click', async () => {
    const onOpen = vi.fn().mockResolvedValue(true), onCancel = vi.fn()
    act(() => { mounted = create(createElement(WorkspacePicker, { kind: 'automation', library, onOpen, onCancel })) })
    expect(action('Aç').props.disabled).toBe(true)
    await act(async () => { await buttons().find(b => b.props.className?.includes('workspace-picker-row'))!.props.onDoubleClick() })
    expect(onOpen).not.toHaveBeenCalled()
  })
})
