import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { createNode } from '../electron/graph-types'
import type { RecoveryReport } from '../electron/recovery'
import NodeCanvas from '../src/components/NodeCanvas'
let mounted: ReactTestRenderer | undefined
afterEach(() => { if (mounted) act(() => mounted!.unmount()); mounted = undefined; vi.unstubAllGlobals() })
it('opens package notes during a run without selecting or moving a node, and allows reading older reports', () => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  const leaf = createNode('click', 0, 0)
  const pkg = { ...createNode('package', 0, 0), inner: { nodes: [leaf], edges: [] } }
  const graph = { nodes: [pkg], edges: [] }, before = JSON.stringify(graph)
  const report: RecoveryReport = { id: 'r1', startedAt: 2, endedAt: 3, model: 'fixture', nodeId: leaf.id, nodeTitle: 'Action',
    error: 'Missing target', context: {}, result: 'retry', resumed: true, probableCause: 'Covered', evidence: 'Window on top', summary: 'Recent note', actions: [] }
  const select = vi.fn(), move = vi.fn()
  act(() => { mounted = create(createElement(NodeCanvas, { graph, canvasKey: 'root', selectedNodeId: null, selectedIds: [], selectedEdgeId: null,
    stepStatus: { [pkg.id]: 'running' }, running: true, recoveryReports: [report, { ...report, id: 'r0', startedAt: 1, summary: 'Older note' }],
    onSelectNode: select, onSelectMany: vi.fn(), onSelectEdge: vi.fn(), onMoveNodes: move, onSetMembership: vi.fn(), onWrap: vi.fn(), onConnect: vi.fn(),
    onAddAfter: vi.fn(), onAddAt: vi.fn(), onDeleteNode: vi.fn(), onDeleteEdge: vi.fn(), onDuplicate: vi.fn(), onRunFrom: vi.fn(),
    onEnterPackage: vi.fn(), onUnpackPackage: vi.fn() })) })
  const badge = mounted!.root.findByProps({ className: 'recovery-report-badge' })
  expect(badge.props['aria-label']).toBe('2 kurtarma raporunu aç')
  act(() => badge.props.onClick({ stopPropagation: vi.fn() }))
  expect(mounted!.root.findByProps({ role: 'dialog' })).toBeDefined()
  expect(JSON.stringify(mounted!.toJSON())).toContain('Recent note')
  act(() => mounted!.root.findByProps({ 'aria-label': 'Raporlar' }).findAllByType('button')[1].props.onClick())
  expect(JSON.stringify(mounted!.toJSON())).toContain('Older note')
  act(() => mounted!.root.findByProps({ 'aria-label': 'Notu kapat' }).props.onClick())
  expect(mounted!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
  expect(select).not.toHaveBeenCalled(); expect(move).not.toHaveBeenCalled()
  expect(JSON.stringify(graph)).toBe(before)
})
