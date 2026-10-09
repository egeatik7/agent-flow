import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import NodeHierarchy from '../src/components/NodeHierarchy'
import { createNode } from '../electron/graph-types'

describe('hierarchy controls and package navigation', () => {
  it('expands and collapses every folder, retains fold state on graph refresh, passes scoped paths', () => {
    const leaf = { ...createNode('type', 3000, 1000), title: 'Leaf' }
    const loop = { ...createNode('loop', 0, 0), title: 'Loop', members: [leaf.id] }
    const pack = { ...createNode('package', 0, 0), title: 'Package', inner: { nodes: [loop, leaf], edges: [] } }
    const graph = { nodes: [pack], edges: [] }, onNavigate = vi.fn()
    let r: ReturnType<typeof create>
    act(() => { r = create(createElement(NodeHierarchy, { graph, onNavigate })) })
    const button = (text: string) => r!.root.findAllByType('button').find(b => b.children.includes(text))!
    expect(r!.root.findAllByProps({ role: 'treeitem' })).toHaveLength(1)
    act(() => button('Expand All').props.onClick())
    expect(r!.root.findAllByProps({ role: 'treeitem' })).toHaveLength(3)
    const leafButton = () => r!.root.findAllByType('button').find(b => b.props.title?.startsWith('Leaf —'))!
    act(() => leafButton().props.onClick())
    expect(onNavigate).toHaveBeenCalledWith(leaf.id, [pack.id])
    act(() => { r!.update(createElement(NodeHierarchy, { graph: structuredClone(graph), onNavigate })) })
    expect(r!.root.findAllByProps({ role: 'treeitem' })).toHaveLength(3)
    act(() => button('Collapse All').props.onClick())
    expect(r!.root.findAllByProps({ role: 'treeitem' })).toHaveLength(1)
    act(() => r!.root.findByProps({ 'aria-label': 'Package: Genişlet' }).props.onClick())
    expect(r!.root.findAllByProps({ role: 'treeitem' })).toHaveLength(2)
    act(() => r!.unmount())
  })
})
