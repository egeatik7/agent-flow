import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNode } from '../electron/graph-types'
import { StoppedError } from '../electron/runner'
import { runYap } from '../electron/yap'

/**
 * U08 (yönerge) — Yap'ın süre sınırı ile kullanıcı durdurması AYRI raporlanmalı.
 *
 * Ölçülen kusur: `yap.ts` süre sınırını `shouldStop` yüklemine katıyordu; bu yüklem modele verildiği için
 * süre dolduğunda model çağrısı `StoppedError` atıyordu ve yap.ts bunu yakalamadığından koşu
 * "kullanıcı durdurdu" gibi bitiyordu (kalan adımlar çalışmıyor, süre aşımı hiç raporlanmıyordu).
 */
const cevap = (calls: unknown[]) => ({ role: 'assistant', content: '', tool_calls: calls }) as never
const aracCagrisi = (name: string, args: Record<string, unknown>) => ({ id: `c-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })

afterEach(() => { vi.useRealTimers() })

describe('U08: Yap süre sınırı ≠ kullanıcı durdurması', () => {
  it('süre dolduğunda açık "Yap süresi doldu." hatası verir ve araç ÇALIŞTIRMAZ', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    let aracCalisti = 0
    let turnGorduguStop: boolean | null = null
    const deps = {
      shouldStop: () => false,
      log: () => {},
      makeExecute: () => async () => { aracCalisti += 1; return { ok: true, outcome: 'tamam' } },
      turn: async (args: { shouldStop: () => boolean }) => {
        // Model çağrısı sürerken süre sınırı aşılır (ölçülen senaryo).
        vi.setSystemTime(999_999)
        turnGorduguStop = args.shouldStop() // deadline çalışan isteği iptal etmeli
        return cevap([aracCagrisi('screen_read', {})])
      },
    }
    const node = { ...createNode('ai', 0, 0), prompt: 'bir şey yap', timeoutMs: 10_000 }
    await expect(runYap(node, {}, deps as never)).rejects.toThrow('Yap süresi doldu.')
    expect(turnGorduguStop).toBe(true) // Deadline iptal sinyali olarak kalır; dışarıya süre hatası çıkar.
    expect(aracCalisti).toBe(0) // Yanıt deadline sonrası geldiyse yeni araç başlatılmaz
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

it('deadline model iptalini kullanıcı durdurması yerine süre hatası olarak bildirir', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  const node = { ...createNode('ai', 0, 0), prompt: 'test', timeoutMs: 10_000 }
  await expect(runYap(node, {}, {
    shouldStop: () => false, log: () => {},
    makeExecute: () => async () => ({ ok: true, outcome: 'tamam', message: 'ok' }),
    turn: async ({ shouldStop }) => {
      vi.setSystemTime(10_000)
      expect(shouldStop()).toBe(true)
      throw new StoppedError()
    },
  })).rejects.toThrow('Yap süresi doldu.')
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
      vi.setSystemTime(10_000)
      expect(stop()).toBe(true)
      throw new StoppedError()
    },
    turn: async () => cevap([aracCagrisi('screen_read', {}), aracCagrisi('screen_read', {})]),
  })).rejects.toThrow('Yap süresi doldu.')
  expect(calls).toBe(1)
})
