import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createNode, DEFAULT_SETTINGS } from '../electron/graph-types'
import { runYap } from '../electron/yap'
import { yapActionRecord, yapDetailPage, yapMessages, yapToolSummary } from '../electron/yap-context'
import { recoveryExecutor } from '../electron/recovery-runtime'
import type { RecoveryToolResult } from '../electron/recovery'
import type { ToolMessage } from '../electron/openrouter'
import type { ToolContext } from '../electron/tools'
import type { Executor } from '../electron/runner'

const native = vi.hoisted(() => ({ read: vi.fn(), powershell: vi.fn() }))
vi.mock('../electron/tools', () => ({ callTool: native.read }))
vi.mock('../electron/agent', () => ({ createAgent: () => { throw Error('unexpected isolated agent') } }))
vi.mock('../electron/windows-tools', async importOriginal => ({ ...await importOriginal<object>(), runPowerShell: native.powershell }))

const call = (name: string, args: object = {}): ToolMessage => ({ role: 'assistant', content: null, tool_calls: [{ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
const frame = (): RecoveryToolResult => ({ ok: true, outcome: 'tamam', message: 'screen', data: {
  matched: true, sig: 'SAME_IMAGE', window: 'Editor', hwnd: '123', pid: 55,
  area: { x: 0, y: 0, w: 100, h: 100 }, image: { data: 'AA==', mime: 'image/png' },
  items: Array.from({ length: 220 }, (_, id) => ({ id, text: id === 150 ? 'Save IMPORTANT_DETAIL' : `Item ${id}`, src: 'uia', x: id, y: 2, w: 3, h: 4 })),
} })
beforeEach(() => {
  vi.clearAllMocks()
  native.read.mockImplementation(async () => frame())
  native.powershell.mockResolvedValue({ ok: true, outcome: 'tamam', message: 'window', data: { stdout: '{"hwnd":"123","pid":55,"maximized":true}' } })
})
afterEach(() => vi.useRealTimers())
const jsonState = (messages: ToolMessage[]) => JSON.parse(typeof messages[1].content === 'string' ? messages[1].content : (messages[1].content as { text: string }[])[0].text)

it('both compaction levels actually shrink large metadata while retaining the task, image, ledger and latest error', () => {
  const observation = frame()
  observation.data!.windows = Array.from({ length: 40 }, (_, i) => ({ handle: String(i + 1), pid: i + 1, title: 'WINDOW'.repeat(80) }))
  observation.data!.verbose = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [`k${i}`, 'v'.repeat(500)]))
  const ledger = Array.from({ length: 30 }, (_, i) => yapActionRecord('act_type', { text: `SENT${i}`.repeat(40) }, { ok: true, outcome: 'tamam', message: 'sent' }))
  const options = { system: 'rules', task: 'EXACT_TASK', context: { vars: { file: 'EXACT_FILE' } }, observation, ledger,
    lastResult: { tool: 'powershell_run', result: { ok: false, outcome: 'hata', message: 'DO_NOT_REPEAT_DELIVERY_UNKNOWN', data: { stdout: 'NATIVE_RESULT'.repeat(100) } } } }
  const packets = [0, 1, 2].map(compact => yapMessages({ ...options, compact }))
  const sizes = packets.map(packet => JSON.stringify(packet).length)
  expect(sizes[1]).toBeLessThan(sizes[0]); expect(sizes[2]).toBeLessThan(sizes[1])
  for (const packet of packets) {
    const state = jsonState(packet)
    expect(state.task).toBe('EXACT_TASK'); expect(state.context.vars.file).toBe('EXACT_FILE')
    expect(state.sentActions).toHaveLength(30); expect(state.lastResult.result.message).toContain('DO_NOT_REPEAT')
    expect(JSON.stringify(packet)).toContain('image_url')
  }
})

it('a full 60-action ledger fits the compact request without dropping action identities', () => {
  const ledger = Array.from({ length: 60 }, (_, i) => yapActionRecord('act_type', { text: `T${i}`.repeat(1000) }, { ok: true, outcome: 'tamam', message: 'sent' }))
  const messages = yapMessages({ system: 'rules', task: 'TASK', context: {}, observation: frame(), ledger, compact: 2 })
  expect(jsonState(messages).sentActions).toHaveLength(60)
  expect(jsonState(messages).sentActions.map((entry: { key: string }) => entry.key)).toEqual(ledger.map(entry => entry.key))
  expect(JSON.stringify(messages).length).toBeLessThan(16000)
})

it('large screen metadata is compacted before the first request instead of failing an otherwise small task', async () => {
  const observation = frame()
  observation.data!.windows = Array.from({ length: 40 }, (_, i) => ({ title: 'W'.repeat(500), handle: String(i + 1), pid: i + 1 }))
  observation.data!.verbose = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [`key${i}`, 'V'.repeat(500)]))
  let calls = 0
  await expect(runYap({ ...createNode('ai', 0, 0), prompt: 'EXACT_SMALL_TASK' }, {}, { shouldStop: () => false, log: () => {},
    makeExecute: () => async () => observation,
    turn: async ({ messages }) => {
      calls++
      expect(jsonState(messages).task).toBe('EXACT_SMALL_TASK')
      expect(jsonState(messages).currentObservation.data.omittedDetails).toBe(true)
      expect(JSON.stringify(messages)).toContain('image_url')
      return call('task_complete', { summary: 'observed' })
    },
  })).resolves.toBe(true)
  expect(calls).toBe(1)
})

it('detail filtering can find a target after the first 24 items and keeps current IDs', () => {
  const result = yapDetailPage(frame(), { details: true, query: 'SAVE' })
  expect(result.data).toMatchObject({ totalItems: 220, matchedItems: 1, offset: 0, nextOffset: null })
  expect(result.data!.items).toMatchObject([{ id: 150, text: 'Save IMPORTANT_DETAIL' }])
  expect((frame().data!.items as unknown[])).toHaveLength(220)
})

it('detail pages provide accurate continuation offsets without accumulating old pages', () => {
  const first = yapDetailPage(frame(), { details: true, limit: 24 })
  const next = yapDetailPage(frame(), { details: true, offset: first.data!.nextOffset, limit: 24 })
  expect(first.data).toMatchObject({ offset: 0, returnedItems: 24, nextOffset: 24 })
  expect(next.data).toMatchObject({ offset: 24, returnedItems: 24, nextOffset: 48 })
  expect((next.data!.items as { id: number }[])[0].id).toBe(24)
})

it('compaction of a detail page gives the offset of the first item omitted from the summary', () => {
  const page = yapDetailPage(frame(), { details: true, offset: 24 })
  const packet = yapMessages({ system: 'rules', task: 'TASK', context: {}, ledger: [], observation: page,
    lastResult: { tool: 'screen_read', result: yapToolSummary(page, true) }, compact: 2 })
  expect(jsonState(packet).lastResult.result.items).toHaveLength(8)
  expect(jsonState(packet).lastResult.result.data.nextOffset).toBe(32)
})

it('reading seven different pages of the same frame is not mistaken for an idle-read loop', async () => {
  let turn = 0
  await expect(runYap({ ...createNode('ai', 0, 0), prompt: 'inspect' }, {}, {
    shouldStop: () => false, log: () => {}, makeExecute: () => async (_name, args) => yapDetailPage(frame(), args),
    turn: async () => ++turn <= 7 ? call('screen_read', { details: true, offset: (turn - 1) * 24 }) : call('task_complete', { summary: 'inspected' }),
  })).resolves.toBe(true)
  expect(turn).toBe(8)
})

it('a transient model retry preserves the requested detail result and window identity', async () => {
  vi.useFakeTimers()
  let turn = 0
  const execute = vi.fn(async (_name: string, args: Record<string, unknown>) => yapDetailPage(frame(), args))
  const pending = runYap(createNode('ai', 0, 0), {}, { shouldStop: () => false, log: () => {}, makeExecute: () => execute,
    turn: async ({ messages }) => {
      if (++turn === 1) return call('screen_read', { hwnd: '123', pid: 55, details: true, query: 'Save' })
      if (turn === 2) throw Error('temporary offline')
      expect(jsonState(messages).lastResult.result.items[0].id).toBe(150)
      expect(jsonState(messages).currentObservation.data.hwnd).toBe('123')
      return call('task_complete', { summary: 'done' })
    },
  })
  await vi.advanceTimersByTimeAsync(3100); expect(await pending).toBe(true)
  expect(execute.mock.calls[2]).toEqual(['screen.read', { hwnd: '123', pid: 55 }])
})

it.each([3600000, -3600000])('wall clock jump %s cannot expire or extend the Yap task budget', async jump => {
  vi.useFakeTimers()
  let turn = 0
  await expect(runYap({ ...createNode('ai', 0, 0), timeoutMs: 10000 }, {}, {
    shouldStop: () => false, log: () => {}, makeExecute: () => async name => {
      if (name === 'act.key') vi.setSystemTime(Date.now() + jump)
      return frame()
    },
    turn: async () => ++turn === 1 ? call('act_key', { keys: 'enter' }) : turn === 2 ? call('screen_read') : call('task_complete', { summary: 'done' }),
  })).resolves.toBe(true)
})

it('retry delay still lasts three elapsed seconds when the wall clock moves backwards', async () => {
  vi.useFakeTimers()
  let turn = 0
  const pending = runYap(createNode('ai', 0, 0), {}, { shouldStop: () => false, log: () => {}, makeExecute: () => async () => frame(),
    turn: async () => { if (++turn === 1) throw Error('temporary'); return call('task_complete', { summary: 'done' }) },
  })
  await vi.advanceTimersByTimeAsync(1000); vi.setSystemTime(Date.now() - 3600000)
  await vi.advanceTimersByTimeAsync(2100); expect(await pending).toBe(true); expect(turn).toBe(2)
})

function desktop() {
  const node = createNode('ai', 0, 0)
  const pointer = vi.fn(async (action: { x?: number; y?: number; mode: string }) => ({ x: action.x ?? 7, y: action.y ?? 8, sent: action.mode !== 'move' }))
  const source = { pointerAction: pointer, key: async () => {}, type: async () => {}, click: async () => {}, log: () => {}, step: () => {}, shouldStop: () => false, exists: async () => false } as Executor
  const base = { getSettings: () => ({ ...DEFAULT_SETTINGS, stepDelayMs: 0 }), log: () => {} } as unknown as ToolContext
  return { pointer, execute: recoveryExecutor({ graph: { nodes: [node], edges: [] }, node, live: node, error: Error(''), vars: {}, stepNo: 1, ahead: {} }, base, () => false, source, true) }
}

it.each(['window_action', 'powershell_run', 'act.key'])('%s invalidates the previous coordinate area', async name => {
  const h = desktop()
  await h.execute('screen.read', {})
  await h.execute(name, name === 'window_action' ? { action: 'maximize', hwnd: '123', pid: 55 } : name === 'powershell_run' ? { code: 'fixture' } : { keys: 'enter' })
  await expect(h.execute('act.clickPoint', { x: .5, y: .5 })).rejects.toThrow('screen_read')
  await expect(h.execute('act.clickCurrent', {})).rejects.toThrow('screen_read')
  expect(h.pointer).not.toHaveBeenCalled()
  await h.execute('screen.read', {})
  await expect(h.execute('act.clickPoint', { x: .5, y: .5 })).resolves.toMatchObject({ ok: true })
})

it('even a thrown window action clears the old area before it can be reused', async () => {
  const h = desktop()
  await h.execute('screen.read', {})
  native.powershell.mockRejectedValueOnce(Error('delivery unknown'))
  await expect(h.execute('window_action', { action: 'maximize' })).rejects.toThrow('delivery unknown')
  await expect(h.execute('act.clickPoint', { x: .5, y: .5 })).rejects.toThrow('screen_read')
  expect(h.pointer).not.toHaveBeenCalled()
})

it('a click invalidates the previous frame; a move alone retains its coordinate mapping', async () => {
  const h = desktop()
  await h.execute('screen.read', {})
  await h.execute('act.move', { x: .5, y: .5 })
  await h.execute('act.clickCurrent', {})
  await expect(h.execute('act.clickCurrent', {})).rejects.toThrow('screen_read')
  expect(h.pointer).toHaveBeenCalledTimes(2)
})
