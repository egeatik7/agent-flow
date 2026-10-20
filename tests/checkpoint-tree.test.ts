import { describe, expect, it } from 'vitest'
import { CheckpointActivity } from '../electron/checkpoint-activity'
import { checkpointTree, treeOutputs, treeAttention } from '../src/lib/checkpoint-tree'
import type { CheckpointDetail, CheckpointInfo, CheckpointLap, CheckpointLoop } from '../electron/checkpoint-types'
import { createNode } from '../electron/graph-types'

const lap = (key: string, patch: Partial<CheckpointLap> = {}): CheckpointLap => ({ key, visitId: key, loopId: key, title: key, index: 0, total: 2, item: 'same.glb', at: 1, status: 'running', ...patch })
const cp = (id: string, patch: Partial<CheckpointInfo> = {}): CheckpointInfo => ({ id, runId: 'run', ordinal: 1, canvasId: 'canvas', canvasName: 'Canvas', label: id, at: 1, status: 'closed', outputCount: 0, roots: [], issues: [], lapPath: [], ...patch })

describe('checkpoint activity identity and execution state', () => {
  it('keeps repeated items and revisits distinct and never derives completion from a file count', () => {
    const activity = new CheckpointActivity(), node = { ...createNode('loop', 0, 0), id: 'loop', title: 'Images' }
    activity.graph({ nodes: [node], edges: [] })
    const frame: CheckpointLoop = { id: node.id, keys: ['same', 'same'], index: 0, isList: true, outerVars: {}, visitId: 'first' }
    activity.context([frame]); activity.checkpoint('cp1')
    activity.context([frame], 'completed')
    activity.context([{ ...frame, index: 1 }])
    activity.context([{ ...frame, visitId: 'second' }])
    expect(activity.laps.size).toBe(3)
    activity.finish('completed')
    expect([...activity.laps.values()].map(l => l.status)).toEqual(['completed', 'incomplete', 'incomplete'])
    expect([...activity.laps.values()][0]).toMatchObject({ title: 'Images', checkpointId: 'cp1' })
  })
  it('returns to the outer context when an inner loop ends, then clears at the canvas boundary', () => {
    const a = new CheckpointActivity()
    const frame = (id: string): CheckpointLoop => ({ id, keys: ['x'], index: 0, isList: true, outerVars: {}, visitId: id })
    a.context([frame('outer'), frame('inner')], 'completed')
    const inner = a.path[1], outer = a.path[0]
    a.context([frame('outer')]); expect(a.path).toEqual([outer]); expect(a.laps.get(inner)?.status).toBe('completed')
    a.context([]); expect(a.path).toEqual([])
  })
})

describe('checkpoint tree', () => {
  it('nests loops inside the actual outer lap and counts completed laps separately from observations', () => {
    const outer = lap('outer', { title: 'Accounts', checkpointId: 'a', status: 'incomplete' })
    const inner = lap('inner', { title: 'Images', parentKey: outer.key, checkpointId: 'b', status: 'completed' })
    const roots = checkpointTree([cp('start', { activity: [outer, inner] }), cp('a', { lapPath: ['outer'] }), cp('b', { lapPath: ['outer', 'inner'], outputCount: 3, outputScopes: { outer: 1, inner: 1, '': 1 } })])
    const account = roots[0].children[0], outerNode = account.children[0], images = outerNode.children[0]
    expect(account.title).toBe('Accounts'); expect(images.title).toBe('Images')
    expect(outerNode.lap?.status).toBe('incomplete'); expect(outerNode.count).toBe(2)
    expect(images.children[0].lap?.status).toBe('completed')
    expect(roots[0].children[1].kind).toBe('unassigned'); expect(roots[0].count).toBe(3)
    expect(treeAttention(roots)?.lap?.key).toBe('outer')
  })
  it('separates resumed runs and keeps legacy checkpoint resume identities without inventing a loop', () => {
    const roots = checkpointTree([cp('old', { lapPath: undefined, outputCount: 1 }), cp('new', { runId: 'retry', parentId: 'old' })])
    expect(roots).toHaveLength(2)
    expect(roots[0].children[0]).toMatchObject({ kind: 'checkpoint', checkpoint: { id: 'old' } })
    expect(roots[1].checkpoint?.id).toBe('new')
  })
  it('keeps orphan/cyclic activity out of the hierarchy and preserves its checkpoint access', () => {
    const roots = checkpointTree([cp('broken', { activity: [lap('x', { parentKey: 'x' })], lapPath: ['x'], outputCount: 1, outputScopes: { x: 1 } })])
    expect(roots[0].children.map(n => n.kind)).toEqual(['checkpoint', 'unassigned'])
  })
  it('filters a lap scope, deduplicates Windows paths, and keeps unknown context visible separately', () => {
    const roots = checkpointTree([cp('start', { activity: [lap('a', { status: 'completed' })] }), cp('a', { lapPath: ['a'], outputCount: 3, outputScopes: { a: 2, '': 1 } })])
    const node = roots[0].children[0].children[0]
    const output = (path: string, lapKey?: string, lastSeen = 1) => ({ path, lapKey, lastSeen, firstSeen: 1, size: 1, kind: 'file' as const, change: 'observed' as const })
    const details: CheckpointDetail[] = [{ ...cp('a'), outputs: [output('C:\\Output\\Same.glb', 'a'), output('c:/output/same.glb', 'a', 2), output('C:/other.glb')] }]
    expect(treeOutputs(node, details, roots[0].lapKeys)).toHaveLength(1)
    expect(treeOutputs(node, details, roots[0].lapKeys)[0].lastSeen).toBe(2)
    expect(treeOutputs(roots[0].children[1], details, roots[0].lapKeys).map(o => o.path)).toEqual(['C:/other.glb'])
  })
})
