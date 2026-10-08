import { describe, expect, it } from 'vitest'
import { createNode, type CanvasTab } from '../electron/graph-types'
import { CanvasSequence, type CanvasRunResult } from '../src/lib/canvas-sequence'
import { runGraph, StoppedError, type Executor } from '../electron/runner'
const opts = { maxSteps: 20, stepDelayMs: 0, reportEnd: true }
function tab(id: string): CanvasTab {
  const start = createNode('start', 0, 0), end = createNode('end', 200, 0)
  return { id, name: id, graph: { nodes: [start, end], edges: [{ id: `edge-${id}`, from: start.id, fromPort: 'next', to: end.id }] } }
}
const ex = (): Executor => ({ log: () => {}, step: () => {}, shouldStop: () => false, click: async () => {}, type: async () => {}, key: async () => {}, exists: async () => true })
const success = { ok: true, reachedEnd: true }

describe('canvas sequence: one frozen order, honest End evidence, sticky Stop', () => {
  it('runs real graphs left-to-right and exposes the current index', async () => {
    const sequence = new CanvasSequence(), seen: string[] = []
    const result = await sequence.run([tab('A'), tab('B')], async (t, i, total) => {
      expect(sequence.isRunning()).toBe(true); expect(total).toBe(2)
      seen.push(`${i}:${t.id}`)
      const summary = await runGraph(t.graph, ex(), opts)
      return { ok: summary.failed === 0, ...summary }
    })
    expect(seen).toEqual(['0:A', '1:B']); expect(result).toBe('completed'); expect(sequence.isRunning()).toBe(false)
  })
  it.each([{ ok: false, reachedEnd: true }, { ok: true, failed: 1, reachedEnd: true }, { ok: true, reachedEnd: false }, { ok: true }])('never advances on failure or no End: %j', async (bad: CanvasRunResult) => {
    const sequence = new CanvasSequence(), seen: string[] = []
    await expect(sequence.run([tab('A'), tab('B')], async t => { seen.push(t.id); return bad })).rejects.toThrow()
    expect(seen).toEqual(['A']); expect(sequence.isRunning()).toBe(false)
  })
  it('validates every canvas before starting any one of them', async () => {
    const sequence = new CanvasSequence(), bad = tab('B'); bad.graph.nodes.pop()
    let calls = 0
    await expect(sequence.run([tab('A'), bad], async () => { calls++; return success })).rejects.toThrow(/Bitti/)
    expect(calls).toBe(0)
    bad.graph.nodes = bad.graph.nodes.filter(n => n.kind !== 'start')
    await expect(sequence.run([bad], async () => success)).rejects.toThrow(/Başlangıç/)
    await expect(sequence.run([], async () => success)).rejects.toThrow()
  })
  it('freezes graph contents and ordering while asynchronous work is in flight', async () => {
    const tabs = [tab('A'), tab('B')], sequence = new CanvasSequence(), seen: string[] = []
    await sequence.run(tabs, async (t, i) => {
      if (i === 0) { tabs.reverse(); tabs[0].name = 'changed'; tabs[0].graph.nodes[0].title = 'changed'; await Promise.resolve() }
      seen.push(`${t.name}:${t.graph.nodes[0].title}`); return success
    })
    expect(seen[0].startsWith('A:')).toBe(true); expect(seen[1].startsWith('B:')).toBe(true)
    expect(seen[1]).not.toContain('changed')
  })
  it('stop during a pending run remains sticky even when that run reports success', async () => {
    const sequence = new CanvasSequence(), seen: string[] = []
    let release!: (v: CanvasRunResult) => void
    const pending = sequence.run([tab('A'), tab('B')], async t => { seen.push(t.id); return new Promise(resolve => { release = resolve }) })
    await expect(sequence.run([tab('C')], async () => success)).rejects.toThrow(/zaten/)
    sequence.stop(); release(success)
    expect(await pending).toBe('stopped'); expect(seen).toEqual(['A'])
    expect(await sequence.run([tab('C')], async () => success)).toBe('completed')
  })
  it('does not advance after executor Stop, or a thrown exception', async () => {
    const sequence = new CanvasSequence(); let calls = 0
    expect(await sequence.run([tab('A'), tab('B')], async () => { calls++; return { ok: false, stopped: true } })).toBe('stopped')
    expect(calls).toBe(1)
    await expect(sequence.run([tab('A'), tab('B')], async () => { throw new Error('failed') })).rejects.toThrow('failed')
    expect(sequence.isRunning()).toBe(false)
  })
})

describe('runner End evidence is opt-in and scoped to the current graph', () => {
  it('keeps the legacy result shape and reports a real root End only when requested', async () => {
    const t = tab('A')
    expect(await runGraph(t.graph, ex(), { maxSteps: 20, stepDelayMs: 0 })).toEqual({ steps: 2, failed: 0 })
    expect((await runGraph(t.graph, ex(), opts)).reachedEnd).toBe(true)
  })
  it('a disconnected End does not count as reaching it', async () => {
    const t = tab('A'); t.graph.edges = []
    expect((await runGraph(t.graph, ex(), opts)).reachedEnd).toBe(false)
  })
  it('a package-local End does not finish the outer canvas', async () => {
    const t = tab('A'), pkg = createNode('package', 100, 100); pkg.inner = tab('inside').graph
    t.graph.nodes.push(pkg); t.graph.edges = [{ id: 'to-package', from: t.graph.nodes[0].id, fromPort: 'next', to: pkg.id }]
    expect((await runGraph(t.graph, ex(), opts)).reachedEnd).toBe(false)
  })
  it('a stopped run never fabricates End evidence', async () => {
    await expect(runGraph(tab('A').graph, { ...ex(), shouldStop: () => true }, opts)).rejects.toBeInstanceOf(StoppedError)
  })
})
