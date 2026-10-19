import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WindowCloseGuard, CLOSE_REPLY_TIMEOUT_MS } from '../electron/window-close'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('kapanış kapısı: kullanıcı diyaloğu beklerken süre tazelenir', () => {
  it('canlı arayüz işareti süreyi uzatır; cevap yoksa süre yine dolar', () => {
    const guard = new WindowCloseGuard()
    guard.ready = true
    const timedOut: number[] = []
    let sent = 0
    expect(guard.request(() => { sent++ }, { timeoutMs: CLOSE_REPLY_TIMEOUT_MS, onTimeout: (id) => timedOut.push(id) })).toBe(false)
    expect(sent).toBe(1)
    vi.advanceTimersByTime(CLOSE_REPLY_TIMEOUT_MS - 1000)
    guard.touchFor(1, CLOSE_REPLY_TIMEOUT_MS, (id) => timedOut.push(id))
    vi.advanceTimersByTime(CLOSE_REPLY_TIMEOUT_MS - 1000)
    expect(timedOut).toEqual([]) // tazelendi
    vi.advanceTimersByTime(2000)
    expect(timedOut).toEqual([1])
  })

  it('eski istek kimliği yeni kapanış isteğini uzatmaz', () => {
    const guard = new WindowCloseGuard()
    guard.ready = true
    const timedOut: number[] = []
    guard.request(() => {}, { timeoutMs: 1000, onTimeout: (id) => timedOut.push(id) })
    guard.touchFor(99, 1000, (id) => timedOut.push(id))
    vi.advanceTimersByTime(1001)
    expect(timedOut).toEqual([1])
  })

  it('cevap gelirse süre tazeleme pencereyi kapatmaz', () => {
    const guard = new WindowCloseGuard()
    guard.ready = true
    guard.request(() => {}, { timeoutMs: 1000, onTimeout: () => { throw new Error('olmamalı') } })
    guard.touchFor(1, 1000)
    expect(guard.reply(1, false)).toBe(false)
    vi.advanceTimersByTime(5000)
    expect(guard.approved).toBe(false)
  })
})
