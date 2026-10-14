import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAgent } from '../electron/agent'
import { createNode, DEFAULT_SETTINGS, type AgentGraph } from '../electron/graph-types'
import { withLibraryLock } from '../electron/library-lock'
import { ModelFailed, runModelChain } from '../electron/openrouter'
import { runGraph, type RecoveryRequest } from '../electron/runner'

const h = vi.hoisted(() => ({ calls: [] as string[], failBeforeWrite: false, failAfterWrite: true }))
vi.mock('electron', () => ({ screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1000, height: 700 }, scaleFactor: 1 }) } }))
vi.mock('../electron/a11y-bridge', () => ({
  nativeWriteStarted: (signal?: AbortSignal, onDispatched?: () => void) => {
    if (signal?.aborted) return false
    onDispatched?.()
    return true
  },
  isLocked: async () => false,
  scan: async () => ({ area: { x: 0, y: 0, w: 1000, h: 700 }, items: [{ id: 1, src: 'uia', type: 'Edit', text: 'Alan', x: 10, y: 20, w: 40, h: 16 }], window: 'Fixture', ocr: false, uiaCount: 1, ocrCount: 0 }),
  clickAt: async () => { h.calls.push('click'); return {} },
  typeText: async (_text: string, _enter: boolean, _clear: boolean, _at?: { x: number; y: number }, _token?: string, _guard?: unknown, hooks?: { onDispatched?: () => void }) => {
    h.calls.push('type')
    if (h.failBeforeWrite) throw new Error('stopped before write')
    hooks?.onDispatched?.()
    if (h.failAfterWrite) throw new Error('native write failed')
    h.calls.push('typed')
    return { writeSent: true }
  },
  sendKeys: async (_keys: string, _title?: string, _target?: unknown, _hwnd?: string, hooks?: { onDispatched?: () => void }) => {
    h.calls.push('enter')
    hooks?.onDispatched?.()
  },
  discardShot: () => {},
  inputState: async () => null,
}))
vi.mock('../electron/runner', async original => ({ ...await original<typeof import('../electron/runner')>(), interruptibleSleep: async () => {} }))

afterEach(() => vi.restoreAllMocks())

it('resumes a focused type without clicking again and reports not_sent text to Recovery', async () => {
  h.calls = []
  h.failBeforeWrite = true
  h.failAfterWrite = false
  const node = { ...createNode('type', 0, 0), prompt: '“Alan”', text: 'merhaba', pressEnter: false }
  const start = createNode('start', 0, 0)
  const graph: AgentGraph = { nodes: [start, node], edges: [{ id: 'e', from: start.id, fromPort: 'next', to: node.id }] }
  let seen: RecoveryRequest | undefined
  const agent = createAgent({
    settings: () => ({ ...DEFAULT_SETTINGS, apiKey: 'k', findOrder: ['uia'], findOff: [], screenCheck: 'off' }),
    shouldStop: () => false,
    log: () => {},
    send: () => {},
  })
  agent.executor.recover = async (request) => {
    seen = request
    h.failBeforeWrite = false
    return 'retry'
  }
  await runGraph(graph, agent.executor, { maxSteps: 10, stepDelayMs: 0 })
  expect(seen?.typeProgress).toMatchObject({ focus: 'sent', text: 'not_sent', enter: 'not_sent' })
  expect(seen?.inputDelivery).toBe('not_sent')
  expect(seen?.inputAlreadySent).toBe(false)
  expect(h.calls.filter(call => call === 'click')).toEqual(['click'])
  expect(h.calls).toContain('typed')
})

it('rejects a model attempt once the remaining budget is already gone and rejects a late answer', async () => {
  vi.useFakeTimers()
  const start = Date.now()
  const late = vi.fn(async () => {
    vi.setSystemTime(start + 5_000)
    return 'late'
  })
  await expect(runModelChain(['m'], late, 0, { maxWaitMs: 200, maxCycles: 1 })).rejects.toBeInstanceOf(ModelFailed)
  expect(late).toHaveBeenCalledTimes(1)
  const skipped = vi.fn(async () => {
    vi.setSystemTime(start + 10_000)
    throw new Error('transient')
  })
  await expect(runModelChain(['m'], skipped, 0, { maxWaitMs: 100, maxCycles: 3 })).rejects.toBeInstanceOf(ModelFailed)
  expect(skipped).toHaveBeenCalledTimes(1)
  vi.useRealTimers()
})

it('keeps the library lock while an overlapping async caller is still inside it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-lock-'))
  const name = '.nubbo-library.lock'
  const present = () => fs.readdirSync(dir).some(entry => entry.toLowerCase() === name)
  let releaseFirst: () => void = () => {}
  const first = withLibraryLock(dir, () => new Promise<void>(resolve => { releaseFirst = resolve }))
  const second = withLibraryLock(dir, async () => {
    expect(present()).toBe(true)
    releaseFirst()
    await first
    expect(present()).toBe(true)
  })
  await second
  expect(present()).toBe(false)
  fs.rmSync(dir, { recursive: true, force: true })
})
