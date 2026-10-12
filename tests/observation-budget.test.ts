import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNode } from '../electron/graph-types'
import { runGraph, type Executor } from '../electron/runner'
import { observeWithin, ObservationTimeoutError } from '../electron/observation-budget'
afterEach(() => vi.useRealTimers())
function graph() {
  const n = { ...createNode('condition', 0, 0), id: 'condition', text: 'Bitti mi?', timeoutMs: 1000 }
  const timeout = { ...createNode('end', 0, 0), id: 'timeout' }, yes = { ...createNode('end', 0, 0), id: 'yes' }
  return { nodes: [n, timeout, yes], edges: [{ id: 'timeout-edge', from: n.id, fromPort: 'false', to: timeout.id }, { id: 'yes-edge', from: n.id, fromPort: 'true', to: yes.id }] }
}
describe('condition deadline', () => {
  it('takes Timeout at the deadline even when the reader hangs; a late Yes cannot run its branch', async () => {
    vi.useFakeTimers(); let finish!: (v: boolean) => void; let signal: AbortSignal | undefined
    const steps: string[] = []
    const ex: Executor = { log: () => {}, shouldStop: () => false, click: async () => {}, type: async () => {}, key: async () => {},
      step: (id, status) => { if (status === 'running') steps.push(id) },
      exists: async (_text, _node, options) => { signal = options?.signal; return new Promise<boolean>(resolve => { finish = resolve }) },
    }
    const pending = runGraph(graph(), ex, { maxSteps: 10, stepDelayMs: 0, startId: 'condition' })
    await vi.advanceTimersByTimeAsync(1000); await pending
    expect(signal!.aborted).toBe(true); expect(steps).toContain('timeout'); expect(steps).not.toContain('yes')
    finish(true); await vi.advanceTimersByTimeAsync(1000)
    expect(steps).not.toContain('yes')
  })
  it('caps the interval between negative observations at the remaining time', async () => {
    vi.useFakeTimers(); let calls = 0
    const ex: Executor = { log: () => {}, shouldStop: () => false, click: async () => {}, type: async () => {}, key: async () => {}, step: () => {}, exists: async () => { calls++; return false } }
    const pending = runGraph(graph(), ex, { maxSteps: 10, stepDelayMs: 0, startId: 'condition' })
    await vi.advanceTimersByTimeAsync(1000); await pending
    expect(calls).toBe(2); expect(vi.getTimerCount()).toBe(0)
  })
  it('does not leave an unhandled reader failure when already cancelled', async () => {
    const controller = new AbortController(); controller.abort(new ObservationTimeoutError())
    await expect(observeWithin(Promise.reject(new Error('reader error')), controller.signal)).rejects.toBeInstanceOf(ObservationTimeoutError)
  })
})
