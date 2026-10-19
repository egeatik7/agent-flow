import { expect, it } from 'vitest'
import { restoreCheckpointTab } from '../src/lib/checkpoint-resume'
import { createNode, type CanvasBook, type CanvasTab } from '../electron/graph-types'
import type { CheckpointInfo, CheckpointSnapshot } from '../electron/checkpoint-types'
const tab = (id: string): CanvasTab => ({ id, canvasId: id, name: id, graph: { nodes: [createNode('start', 0, 0)], edges: [] } })
const cp: CheckpointInfo = { id: 'cp', runId: 'run', ordinal: 1, canvasId: 'tab:B', canvasName: 'B', label: 'start', at: 10, status: 'completed', roots: [], outputCount: 0, issues: [] }
const snapshot: CheckpointSnapshot = { graph: tab('snapshot').graph, cursor: { packagePath: [], loops: [], scopes: [] } }
it('restores the exact matching canvas, preserves its draft on the left and leaves right-hand sequence intact', () => {
  const book: CanvasBook = { activeId: 'C', tabs: [tab('A'), tab('B'), tab('C')], branches: [{ untouched: true }] }
  const frozen = structuredClone(book)
  const restored = restoreCheckpointTab(book, cp, snapshot)
  expect(restored.activeId).toBe('B')
  expect(restored.tabs.map(t => t.name)).toEqual(['A', 'B · checkpoint öncesi', 'B', 'C'])
  expect(restored.tabs[1].graph).toEqual(frozen.tabs[1].graph)
  expect(restored.tabs[1].canvasId).not.toBe('B')
  expect(restored.tabs[2].graph).toEqual(snapshot.graph)
  expect(restored.tabs.slice(restored.tabs.findIndex(t => t.id === restored.activeId)).map(t => t.name)).toEqual(['B', 'C'])
  expect(restored.branches).toEqual(book.branches)
  expect(book).toEqual(frozen)
  const again = restoreCheckpointTab(restored, cp, snapshot)
  expect(again.tabs.slice(again.tabs.findIndex(t => t.id === 'B')).map(t => t.name)).toEqual(['B', 'C'])
})
it('reopens a closed checkpoint canvas as a new independent document', () => {
  const book: CanvasBook = { activeId: '', tabs: [] }
  const restored = restoreCheckpointTab(book, cp, snapshot)
  expect(restored.tabs).toHaveLength(1)
  expect(restored.tabs[0].graph).toEqual(snapshot.graph)
  expect(restored.tabs[0].name).toBe('B')
  expect(restored.tabs[0].savedId).toBeUndefined()
  expect(restored.activeId).toBe(restored.tabs[0].id)
})
