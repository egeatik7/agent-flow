import { afterEach, describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode } from '../electron/graph-types'
import { runGraph, StoppedError, type Executor } from '../electron/runner'
import { beginRun, endRun, frozenReport, noteStep, noteUserStop, setDebugRun, setErrorStopHook, snapshot, stopReason } from '../electron/tool-state'

let sequence = 0
const edge = (from: AgentNode, port: string, to: AgentNode) => ({ id: `safe-${++sequence}`, from: from.id, fromPort: port, to: to.id })
const executor = (extra: Partial<Executor> = {}): Executor => ({ log: () => {}, step: () => {}, shouldStop: () => false, click: async () => {}, type: async () => {}, key: async () => {}, exists: async () => false, ...extra })
function fixture(kind: 'ai' | 'type' = 'type', depth = 1) {
  const task = createNode(kind, 0, 0); task.text = '{{öğe}}'; task.prompt = 'Fail task'
  const loop = { ...createNode('loop', 0, 0), items: ['a.glb', 'b.glb', 'c.glb'], members: [task.id], startIndex: 0 }
  const start = createNode('start', 0, 0)
  let graph: AgentGraph = { nodes: [start, loop, task], edges: [edge(start, 'next', loop)] }
  const packagePath: string[] = []
  for (let i = 0; i < depth; i++) {
    const host = { ...createNode('package', 0, 0), inner: graph }, root = createNode('start', 0, 0)
    graph = { nodes: [root, host], edges: [edge(root, 'next', host)] }; packagePath.unshift(host.id)
  }
  return { graph, task, loop, packagePath }
}
afterEach(() => { setErrorStopHook(null); endRun(); setDebugRun(false) })
describe('debug context without changing loop execution policy', () => {
  it('keeps title, package path and item when an unconnected failure follows done', async () => {
    const f = fixture('ai'), id = beginRun(f.graph)
    setDebugRun(true); let stopped = false; setErrorStopHook(() => { stopped = true })
    try { await runGraph(f.graph, executor({ step: (nodeId, status) => noteStep({ id: nodeId, status }), shouldStop: () => stopped, initiative: async () => false }), { maxSteps: 100, stepDelayMs: 0, debug: true }) } catch { /* inspect the actual frozen record */ }
    const report = frozenReport(id)!
    expect(report.nodeId).toBe(f.task.id); expect(report.nodeTitle).toBe(f.task.title)
    expect(report.packagePath).toEqual(f.packagePath)
    expect(report.loops[0]).toMatchObject({ id: f.loop.id, item: 'a.glb', index: 0 })
  })
  it('a user stop remains a user stop with no error count or new frozen failure', async () => {
    const f = fixture(), id = beginRun(f.graph)
    setDebugRun(true); let stopped = false
    try { await runGraph(f.graph, executor({ step: (nodeId, status) => noteStep({ id: nodeId, status }), shouldStop: () => stopped, type: async () => { noteUserStop(); stopped = true; throw new StoppedError() } }), { maxSteps: 100, stepDelayMs: 0, debug: true }) } catch { /* stop */ }
    expect(stopReason()).toBe('user'); expect(snapshot().observed.errors).toBe(0)
    expect(frozenReport(id)).toBeNull()
  })
})
