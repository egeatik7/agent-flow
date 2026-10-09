import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NodeNavigator from '../src/components/NodeNavigator'
import { createNode } from '../electron/graph-types'
let mounted: ReactTestRenderer | undefined
const leaf = { ...createNode('type', 4000, 2000), id: 'leaf', title: 'Leaf' }
const pack = { ...createNode('package', 0, 0), id: 'pack', title: 'Pack' }
const graph = { nodes: [pack, leaf], edges: [] }
const row = (title: string) => mounted!.root.findAllByType('button').find(b => b.props.title?.startsWith(`${title} —`))!
afterEach(() => { if (mounted) act(() => mounted!.unmount()); mounted = undefined; vi.useRealTimers() })
describe('canvas navigator click actions and live display', () => {
  it('centers leaves immediately, distinguishes package double click and cancels stale pending entry', () => {
    vi.useFakeTimers()
    const onNavigate = vi.fn()
    act(() => { mounted = create(createElement(NodeNavigator, { graph, onNavigate, locationKey: 'root', active: true })) })
    act(() => row('Leaf').props.onClick({ detail: 1 }))
    expect(onNavigate).toHaveBeenLastCalledWith('leaf', false)
    act(() => row('Leaf').props.onDoubleClick())
    expect(onNavigate).toHaveBeenLastCalledWith('leaf', true)
    onNavigate.mockClear()
    act(() => row('Pack').props.onClick({ detail: 1 }))
    act(() => row('Pack').props.onClick({ detail: 2 }))
    act(() => row('Pack').props.onDoubleClick())
    act(() => { vi.advanceTimersByTime(500) })
    expect(onNavigate.mock.calls).toEqual([['pack', true]])
    onNavigate.mockClear()
    act(() => row('Pack').props.onClick({ detail: 1 }))
    act(() => { vi.advanceTimersByTime(301) })
    expect(onNavigate.mock.calls).toEqual([['pack', false]])
    onNavigate.mockClear()
    act(() => row('Pack').props.onClick({ detail: 1 }))
    act(() => mounted!.update(createElement(NodeNavigator, { graph, onNavigate, locationKey: 'different-package', active: true })))
    act(() => { vi.advanceTimersByTime(500) })
    expect(onNavigate).not.toHaveBeenCalled()
  })
  it('shows live/stopped/error markers and clears stale running markers when execution finishes', () => {
    const props = { graph, stepStatus: { leaf: 'running' as const }, highlightedNodeIds: ['pack', 'leaf'] }
    act(() => { mounted = create(createElement(NodeNavigator, { ...props, runPhase: 'running' })) })
    expect(row('Pack').props.className).toContain('running'); expect(row('Leaf').props.className).toContain('running')
    act(() => mounted!.update(createElement(NodeNavigator, { ...props, runPhase: 'stopped' })))
    expect(row('Pack').props.className).toContain('stopped'); expect(row('Leaf').props.className).toContain('stopped')
    act(() => mounted!.update(createElement(NodeNavigator, { ...props, runPhase: 'stopped', stepStatus: { leaf: 'error' } })))
    expect(row('Leaf').props.className).toContain('error')
    act(() => mounted!.update(createElement(NodeNavigator, { ...props, runPhase: 'idle' })))
    expect(row('Leaf').props.className).not.toContain('running'); expect(row('Pack').props.className).not.toContain('running')
  })
})
