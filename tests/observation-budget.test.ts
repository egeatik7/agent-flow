import { describe, expect, it } from 'vitest'
import { createNode } from '../electron/graph-types'
import { runGraph, StoppedError, type Executor } from '../electron/runner'
import { observeWithin, ObservationTimeoutError } from '../electron/observation-budget'
function fixture(timeoutMs = 1000) {
  const n = { ...createNode('condition', 0, 0), id: 'condition', text: 'Bitti mi?', timeoutMs }
  const no = { ...createNode('end', 0, 0), id: 'no' }, yes = { ...createNode('end', 0, 0), id: 'yes' }
  return { nodes: [n, no, yes], edges: [{ id: 'no-edge', from: n.id, fromPort: 'false', to: no.id }, { id: 'yes-edge', from: n.id, fromPort: 'true', to: yes.id }] }
}
function executor(exists: Executor['exists'], seen: string[] = []): Executor {
  return { log: () => {}, shouldStop: () => false, click: async () => {}, type: async () => {}, key: async () => {}, step: (id, status) => { if (status === 'running') seen.push(id) }, exists }
}
describe('condition observes once; repeated checking belongs to an explicit graph loop', () => {
  it.each([0, 1, 600000])('ignores legacy timeout %s and calls exists once on No', async timeoutMs => {
    let calls = 0; const seen: string[] = []
    await runGraph(fixture(timeoutMs), executor(async () => { calls++; return false }, seen), { maxSteps: 10, stepDelayMs: 0, startId: 'condition' })
    expect(calls).toBe(1); expect(seen).toContain('no'); expect(seen).not.toContain('yes')
  })
  it('an old timeout cannot discard the completed model answer', async () => {
    let finish!: (v: boolean) => void; const seen: string[] = []; let calls = 0
    const pending = runGraph(fixture(1), executor(async () => { calls++; return new Promise<boolean>(resolve => { finish = resolve }) }, seen), { maxSteps: 10, stepDelayMs: 0, startId: 'condition' })
    await new Promise(resolve => setTimeout(resolve, 10)); finish(true); await pending
    expect(calls).toBe(1); expect(seen).toContain('yes'); expect(seen).not.toContain('no')
  })
  it('Stop after the observation does not run either branch', async () => {
    const seen: string[] = []; let stopped = false
    const ex = executor(async () => { stopped = true; return true }, seen); ex.shouldStop = () => stopped
    await expect(runGraph(fixture(), ex, { maxSteps: 10, stepDelayMs: 0, startId: 'condition' })).rejects.toBeInstanceOf(StoppedError)
    expect(seen).not.toContain('yes'); expect(seen).not.toContain('no')
  })
  it('runner rejects old screen selections before calling any executor', async () => {
    const graph = fixture(); graph.nodes[0].locator = { name: 'Old', controlType: 'Button', path: '' }
    let calls = 0
    await expect(runGraph(graph, executor(async () => { calls++; return true }), { maxSteps: 10, stepDelayMs: 0, startId: 'condition' })).rejects.toThrow('uyumsuz eski koşul')
    expect(calls).toBe(0)
  })
  it('an explicit Condition -> Timer -> Condition loop performs the next observation', async () => {
    const graph = fixture(); const timer = { ...createNode('wait', 0, 0), id: 'timer', ms: 0 }; graph.nodes.push(timer)
    graph.edges[0].to = timer.id; graph.edges.push({ id: 'again', from: timer.id, fromPort: 'next', to: 'condition' })
    let calls = 0; const seen: string[] = []
    await runGraph(graph, executor(async () => ++calls === 2, seen), { maxSteps: 10, stepDelayMs: 0, startId: 'condition' })
    expect(calls).toBe(2); expect(seen).toEqual(['condition', 'timer', 'condition', 'yes'])
  })
  it('external observation cancellation still suppresses an unhandled reader failure', async () => {
    const controller = new AbortController(); controller.abort(new ObservationTimeoutError())
    await expect(observeWithin(Promise.reject(new Error('reader error')), controller.signal)).rejects.toBeInstanceOf(ObservationTimeoutError)
  })
})
