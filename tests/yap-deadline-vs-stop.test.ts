import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNode } from '../electron/graph-types'
import { StoppedError } from '../electron/runner'
import { runYap } from '../electron/yap'

/** Model waiting is unbounded; task execution deadlines and user Stop stay distinct. */
const cevap = (calls: unknown[]) => ({ role: 'assistant', content: '', tool_calls: calls }) as never
const aracCagrisi = (name: string, args: Record<string, unknown>) => ({ id: `c-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })

afterEach(() => { vi.useRealTimers() })

describe('U08: Yap süre sınırı ≠ kullanıcı durdurması', () => {
  it('model waiting beyond the old task deadline does not end Yap or replay tools', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    let turn = 0, tools = 0
    const node = { ...createNode('ai', 0, 0), prompt: 'test', timeoutMs: 10_000 }
    expect(await runYap(node, {}, {
      shouldStop: () => false, log: () => {},
      makeExecute: () => async () => { tools++; return { ok: true, outcome: 'tamam', message: 'ok' } },
      turn: async ({ shouldStop }) => {
        await vi.advanceTimersByTimeAsync(999_999)
        expect(shouldStop()).toBe(false)
        return ++turn === 1 ? cevap([aracCagrisi('screen_read', {})]) : cevap([aracCagrisi('task_complete', { summary: 'done' })])
      },
    })).toBe(true)
    expect(tools).toBe(2)
  })

  it('gerçek kullanıcı durdurması StoppedError olarak kalır', async () => {
    const deps = {
      shouldStop: () => true,
      log: () => {},
      makeExecute: () => async () => ({ ok: true, outcome: 'tamam', message: 'ok' }),
      turn: async () => cevap([aracCagrisi('screen_read', {})]),
    }
    const node = { ...createNode('ai', 0, 0), prompt: 'bir şey yap' }
    await expect(runYap(node, {}, deps as never)).rejects.toBeInstanceOf(StoppedError)
  })

  it('normal tamamlanma bozulmadı: gözlem sonrası task_complete true döner', async () => {
    let adim = 0
    const deps = {
      shouldStop: () => false,
      log: () => {},
      makeExecute: () => async () => ({ ok: true, outcome: 'tamam', message: 'ok' }),
      turn: async () => {
        adim += 1
        if (adim === 1) return cevap([aracCagrisi('screen_read', {})])
        return cevap([aracCagrisi('task_complete', { summary: 'bitti' })])
      },
    }
    const node = { ...createNode('ai', 0, 0), prompt: 'bir şey yap' }
    await expect(runYap(node, {}, deps as never)).resolves.toBe(true)
  })
})

it('Stop during model waiting cancels before any action; the initial observation is read-only', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0)
  let stop = false
  const execute = vi.fn(async () => ({ ok: true, outcome: 'tamam' as const, message: 'ok' }))
  await expect(runYap({ ...createNode('ai', 0, 0), timeoutMs: 10_000 }, {}, {
    shouldStop: () => stop, log: () => {}, makeExecute: () => execute,
    turn: async ({ shouldStop }) => { vi.setSystemTime(999_999); stop = true; expect(shouldStop()).toBe(true); throw new StoppedError() },
  })).rejects.toBeInstanceOf(StoppedError)
  expect(execute).toHaveBeenCalledExactlyOnceWith('screen.read', {})
})

it('deadline çalışan araca ulaşır ve sonraki araç başlatılmaz', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  let calls = 0
  const node = { ...createNode('ai', 0, 0), prompt: 'test', timeoutMs: 10_000 }
  await expect(runYap(node, {}, {
    shouldStop: () => false, log: () => {},
    makeExecute: stop => async () => {
      calls++
      await vi.advanceTimersByTimeAsync(10_000)
      expect(stop()).toBe(true)
      throw new StoppedError()
    },
    turn: async () => cevap([aracCagrisi('screen_read', {}), aracCagrisi('screen_read', {})]),
  })).rejects.toThrow('Yap süresi doldu.')
  expect(calls).toBe(1)
})
