import { afterEach, expect, it, vi } from 'vitest'
import { createNode } from '../electron/graph-types'
import { runYap, yapTools } from '../electron/yap'
import { TaskNeedsRecoveryError } from '../electron/method-cycle'
import { StoppedError, runGraph, type RecoveryRequest } from '../electron/runner'
import { yapFailureKind, yapInputEstimate, yapProgressText, type YapProgress } from '../electron/yap-context'
import type { ToolMessage } from '../electron/openrouter'
import type { RecoveryToolResult } from '../electron/recovery'

const call = (name: string, args: object = {}): ToolMessage => ({ role: 'assistant', content: null, tool_calls: [{ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
const screen = (matched = true): RecoveryToolResult => ({ ok: matched, outcome: matched ? 'tamam' : 'hedef-yok', message: 'current screen', data: {
  matched, sig: 'same-screen', windows: [{ title: 'Editor', handle: '123', pid: 55 }], image: { data: 'AA==', mime: 'image/png' },
  items: Array.from({ length: 1000 }, (_, id) => ({ id, text: 'label'.repeat(100), words: Array(100).fill('word') })),
} })
afterEach(() => vi.useRealTimers())

it('starts with one current screenshot and no graph, neighbours, old reasoning or legacy records', async () => {
  const requests: ToolMessage[][] = []
  const execute = vi.fn(async () => screen())
  await runYap({ ...createNode('ai', 0, 0), prompt: 'CURRENT_TASK', trace: ['legacy'] }, { nodeId: 'n', vars: { file: 'CURRENT_FILE' }, packageContext: 'GRAPH_SENTINEL', next: { prompt: 'NEIGHBOUR' } }, {
    shouldStop: () => false, log: () => {}, makeExecute: () => execute,
    turn: async ({ messages }) => { requests.push(messages); return call('task_complete', { summary: 'observed' }) },
  })
  expect(execute).toHaveBeenCalledExactlyOnceWith('screen.read', {})
  const text = JSON.stringify(requests[0])
  expect(requests[0].map(m => m.role)).toEqual(['system', 'user'])
  expect(text).toContain('image_url'); expect(text).toContain('CURRENT_TASK'); expect(text).toContain('CURRENT_FILE')
  expect(text).not.toContain('GRAPH_SENTINEL'); expect(text).not.toContain('NEIGHBOUR'); expect(text).not.toContain('words')
  expect(text.length).toBeLessThan(7000)
})

it('canvas tools are opt-in while the existing code permission stays effective', () => {
  expect(yapTools().map(t => t.function.name)).not.toContain('flow_read')
  expect(yapTools(false, true).map(t => t.function.name)).toContain('flow_read')
  expect(yapTools(false, true).map(t => t.function.name)).not.toContain('powershell_run')
})

it('20 actions retain a bounded complete action ledger and exactly one current image', async () => {
  let turns = 0, reads = 0
  const requests: ToolMessage[][] = []
  const execute = vi.fn(async (name: string) => name === 'screen.read' ? { ...screen(), data: { ...screen().data, sig: String(++reads) } } : { ok: true, outcome: 'tamam', message: 'SENT_RESULT' })
  await runYap({ ...createNode('ai', 0, 0), prompt: 'TASK', maxActions: 25 }, {}, {
    shouldStop: () => false, log: () => {}, makeExecute: () => execute,
    turn: async ({ messages }) => { requests.push(messages); turns++; return turns > 40 ? call('task_complete', { summary: 'done' }) : turns % 2 ? call('act_key', { keys: `KEY${turns}` }) : call('screen_read') },
  })
  const last = JSON.stringify(requests[requests.length - 1])
  expect((last.match(/image_url/g) || []).length).toBe(2) // type and nested image_url property of ONE image part
  expect(requests.every(messages => messages.length === 2)).toBe(true)
  expect(last).toContain('KEY1'); expect(last).toContain('KEY39'); expect(last.length).toBeLessThan(16000)
  expect(execute.mock.calls.filter(([name]) => name === 'act.key')).toHaveLength(20)
})

it('context overflow compacts then hands off, preserves sent input, never replays the action', async () => {
  let turns = 0
  const requests: string[] = []
  const execute = vi.fn(async (name: string) => name === 'screen.read' ? screen() : { ok: true, outcome: 'tamam', message: 'sent' })
  const error = await runYap(createNode('ai', 0, 0), {}, {
    shouldStop: () => false, log: () => {}, makeExecute: () => execute,
    turn: async ({ messages }) => { requests.push(JSON.stringify(messages)); if (++turns === 1) return call('act_key', { keys: 'enter' }); throw Error('request (34506 tokens) exceeds the available context size (32768 tokens)') },
  }).catch(error => error)
  expect(error).toBeInstanceOf(TaskNeedsRecoveryError)
  expect(error.inputMayHaveBeenSent).toBe(true); expect(error.yapActions).toHaveLength(1)
  expect(turns).toBeLessThanOrEqual(4); expect(new Set(requests.slice(1)).size).toBe(requests.length - 1)
  expect(execute.mock.calls.filter(([name]) => name === 'act.key')).toHaveLength(1)
})

it('six transient failures reach Recovery instead of making thousands of requests', async () => {
  vi.useFakeTimers()
  let turns = 0
  const pending = runYap(createNode('ai', 0, 0), {}, { shouldStop: () => false, log: () => {}, makeExecute: () => async () => screen(), turn: async () => { turns++; throw Error('offline') } })
  const rejected = expect(pending).rejects.toBeInstanceOf(TaskNeedsRecoveryError)
  await vi.advanceTimersByTimeAsync(15100); await rejected
  expect(turns).toBe(6)
})

it('a wrong-window observation cannot authorize completion', async () => {
  const answers = [call('task_complete', { summary: 'wrong' }), call('screen_read'), call('task_complete', { summary: 'correct' })]
  let reads = 0, turns = 0
  await runYap(createNode('ai', 0, 0), {}, { shouldStop: () => false, log: () => {}, makeExecute: () => async () => screen(++reads > 1), turn: async () => { turns++; return answers.shift()! } })
  expect(turns).toBe(3)
})

it('a failed fresh read invalidates an older valid observation', async () => {
  let reads = 0, turns = 0
  const answers = [call('screen_read'), call('task_complete', { summary: 'stale' }), call('task_give_up', { reason: 'cannot observe' })]
  const error = await runYap(createNode('ai', 0, 0), {}, { shouldStop: () => false, log: () => {}, makeExecute: () => async () => { if (++reads > 1) throw Error('capture failed'); return screen() }, turn: async () => { turns++; return answers.shift()! } }).catch(error => error)
  expect(error).toBeInstanceOf(TaskNeedsRecoveryError); expect(turns).toBe(3)
})

it('an uncertain key delivery is handed off before an identical key is sent again', async () => {
  const execute = vi.fn(async (name: string) => { if (name === 'act.key') throw Error('delivery unknown'); return screen() })
  const error = await runYap(createNode('ai', 0, 0), {}, { shouldStop: () => false, log: () => {}, makeExecute: () => execute, turn: async () => call('act_key', { keys: 'enter' }) }).catch(error => error)
  expect(error).toBeInstanceOf(TaskNeedsRecoveryError); expect(error.inputMayHaveBeenSent).toBe(true)
  expect(execute.mock.calls.filter(([name]) => name === 'act.key')).toHaveLength(1)
})

it('a nested action handoff also retains the Yap no-replay flag and attempted action', async () => {
  const error = await runYap(createNode('ai', 0, 0), {}, { shouldStop: () => false, log: () => {},
    makeExecute: () => async name => { if (name === 'act.key') throw new TaskNeedsRecoveryError('nested target failure'); return screen() },
    turn: async () => call('act_key', { keys: 'enter' }),
  }).catch(error => error)
  expect(error).toBeInstanceOf(TaskNeedsRecoveryError)
  expect(error.inputMayHaveBeenSent).toBe(true); expect(error.yapActions).toHaveLength(1)
})

it('does not execute later preplanned calls from a batch after its first tool fails', async () => {
  const batch = call('act_key', { keys: 'enter' })
  batch.tool_calls!.push(...call('act_key', { keys: 'delete' }).tool_calls!)
  let turns = 0
  const execute = vi.fn(async (name: string) => name === 'screen.read' ? screen() : { ok: false, outcome: 'hata', message: 'uncertain' })
  await expect(runYap(createNode('ai', 0, 0), {}, { shouldStop: () => false, log: () => {}, makeExecute: () => execute,
    turn: async () => ++turns === 1 ? batch : call('task_give_up', { reason: 'need recovery' }),
  })).rejects.toBeInstanceOf(TaskNeedsRecoveryError)
  expect(execute.mock.calls.filter(([name]) => name === 'act.key')).toHaveLength(1)
})

it('repeated unchanged reads reach Recovery with no input flag', async () => {
  let turns = 0
  const error = await runYap(createNode('ai', 0, 0), {}, { shouldStop: () => false, log: () => {}, makeExecute: () => async () => screen(), turn: async () => { turns++; return call('screen_read') } }).catch(error => error)
  expect(error).toBeInstanceOf(TaskNeedsRecoveryError); expect(error.inputMayHaveBeenSent).toBe(false); expect(turns).toBe(6)
})

it('huge essential task data is handed off without truncating its target or sending an oversized request', async () => {
  const turn = vi.fn(async () => call('task_complete', { summary: 'wrong' }))
  await expect(runYap({ ...createNode('ai', 0, 0), prompt: 'x'.repeat(50000) }, {}, { shouldStop: () => false, log: () => {}, makeExecute: () => async () => screen(), turn })).rejects.toBeInstanceOf(TaskNeedsRecoveryError)
  expect(turn).not.toHaveBeenCalled()
})

it('Stop before the initial observation prevents even read-only work', async () => {
  const execute = vi.fn(async () => screen())
  await expect(runYap(createNode('ai', 0, 0), {}, { shouldStop: () => true, log: () => {}, makeExecute: () => execute, turn: async () => call('screen_read') })).rejects.toBeInstanceOf(StoppedError)
  expect(execute).not.toHaveBeenCalled()
})

it('handoff reaches the runner on the same node; disabled Recovery stops with an explicit explanation', async () => {
  const node = { ...createNode('ai', 0, 0), prompt: 'CURRENT_TASK' }
  const recover = vi.fn(async (request: RecoveryRequest) => {
    expect(request.node.id).toBe(node.id)
    expect(request.error).toBeInstanceOf(TaskNeedsRecoveryError)
    return 'disabled' as const
  })
  const noop = async () => {}
  const result = await runGraph({ nodes: [node], edges: [] }, { shouldStop: () => false, log: () => {}, step: () => {}, click: noop, key: noop, type: noop, exists: async () => false, recover,
    initiative: async () => runYap(node, {}, { shouldStop: () => false, log: () => {}, makeExecute: () => async () => screen(), turn: async () => { throw Error('401 API anahtarı geçersiz') } }),
  }, { maxSteps: 5, stepDelayMs: 0 }).catch(error => error)
  expect(recover).toHaveBeenCalledOnce(); expect(recover.mock.calls[0]).toBeDefined()
  expect(result).toBeInstanceOf(Error); expect(result.message).toContain('kapalı veya kullanılamıyor')
})

it('failure classification includes the exact reported server context error', () => {
  expect(yapFailureKind(Error('request (34506 tokens) exceeds the available context size (32768 tokens)'))).toBe('context')
  expect(yapFailureKind(Error('HTTP 429'))).toBe('transient')
  expect(yapFailureKind(Error('HTTP 401'))).toBe('permanent')
})

it('input estimates exclude base64 bytes and progress separates model replies from actions', () => {
  const estimate = yapInputEstimate([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x'.repeat(1000000) } }] }], [])
  expect(estimate).toBeLessThan(10000)
  const state: YapProgress = { phase: 'retry', lastModelAt: 1000, lastActionAt: null, failures: 3, message: 'İlerleme doğrulanmadı' }
  expect(yapProgressText(state, 5000)).toContain('Model: 4 sn önce')
  expect(yapProgressText(state, 5000)).toContain('Eylem: henüz yok')
})
