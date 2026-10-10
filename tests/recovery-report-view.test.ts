import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph } from '../electron/graph-types'
import type { RecoveryReport } from '../electron/recovery'
import { recoverySettings } from '../electron/recovery-settings'
import { recoveryOutcome, recoveryReportIndex } from '../src/lib/recovery-report-view'
const report = (id: string, nodeId: string, patch: Partial<RecoveryReport> = {}): RecoveryReport => ({ id, nodeId, startedAt: 1, endedAt: 2,
  model: 'fixture/model', nodeTitle: 'Action', error: 'Missing target', context: {}, result: 'retry', probableCause: 'Covered window',
  evidence: 'Window in front', summary: 'Returned', actions: [], ...patch })
describe('recovery report projection', () => {
  it('aggregates nested packages and loops without modifying the saved graph, and separates saved canvases', () => {
    const child = createNode('click', 10, 20)
    const inner = { ...createNode('package', 0, 0), inner: { nodes: [child], edges: [] } }
    const outer = { ...createNode('package', 0, 0), inner: { nodes: [inner], edges: [] } }
    const loop = { ...createNode('loop', 0, 0), members: [outer.id] }
    const graph: AgentGraph = { nodes: [outer, loop], edges: [] }
    const before = JSON.stringify(graph)
    const a = report('a', child.id, { canvasId: 'saved', startedAt: 5 })
    const b = report('legacy', child.id)
    const result = recoveryReportIndex(graph, [b, a, a, report('other', child.id, { canvasId: 'other' })], 'saved')
    expect(result.get(outer.id)?.map(r => r.id)).toEqual(['a', 'legacy'])
    expect(result.get(loop.id)?.map(r => r.id)).toEqual(['a', 'legacy'])
    expect(recoveryReportIndex(inner.inner!, [a], 'saved').get(child.id)).toEqual([a])
    expect(JSON.stringify(graph)).toBe(before)
  })
  it('requires a recorded resume result before claiming successful continuation', () => {
    expect(recoveryOutcome(report('a', 'n', { result: 'completed' }))).toContain('henüz')
    expect(recoveryOutcome(report('a', 'n', { resumed: true }))).toContain('başarılı')
    expect(recoveryOutcome(report('a', 'n', { resumed: false }))).toContain('başarısız')
  })
  it('loads old settings with an empty dedicated key and preserves independent credentials', () => {
    expect(recoverySettings({ model: 'old' }).apiKey).toBe('')
    expect(recoverySettings({ apiKey: ' dedicated ', model: 'old' }).apiKey).toBe('dedicated')
  })
})
