import { afterEach, describe, expect, it, vi } from 'vitest'
import { recoveryToolTurn, setStopCheck } from '../electron/openrouter'
import { StoppedError } from '../electron/runner'

afterEach(() => { vi.unstubAllGlobals(); setStopCheck(() => false) })
const args = { apiKey: 'fixture', models: ['fixture/primary', 'fixture/backup'], messages: [{ role: 'user' as const, content: 'Repair' }], tools: [], shouldStop: () => false, timeoutMs: 1000 }
describe('OpenRouter recovery native tool calls', () => {
  it('passes tools to the provider and preserves tool identity and opaque reasoning', async () => {
    const fetch = vi.fn(async (_url, init) => {
      const req = JSON.parse(init.body)
      expect(req.parallel_tool_calls).toBe(false); expect(req.tool_choice).toBe('auto')
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null,
        reasoning_details: [{ type: 'reasoning.encrypted', data: 'opaque' }],
        tool_calls: [{ id: 'native-id', type: 'function', function: { name: 'act_key', arguments: '{"keys":"win+d"}' } }],
      } }] }) }
    })
    vi.stubGlobal('fetch', fetch)
    const reply = await recoveryToolTurn(args)
    expect(reply.tool_calls?.[0].id).toBe('native-id')
    expect(reply.reasoning_details).toEqual([{ type: 'reasoning.encrypted', data: 'opaque' }])
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('uses a finite fallback chain before returning an action', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'tools unsupported' })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'ready' }, finish_reason: 'stop' }] }) })
    vi.stubGlobal('fetch', fetch)
    expect((await recoveryToolTurn(args)).content).toBe('ready')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('does not retry a rejected account key with another model', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 401, text: async () => 'unauthorized' }))
    vi.stubGlobal('fetch', fetch)
    await expect(recoveryToolTurn(args)).rejects.toThrow('API anahtarı')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('honors Stop even when an in-flight provider returns a late successful response', async () => {
    let stop = false
    vi.stubGlobal('fetch', vi.fn(async () => { stop = true; return { ok: true, status: 200, text: async () => '{"choices":[{"message":{"content":"late"}}]}' } }))
    await expect(recoveryToolTurn({ ...args, shouldStop: () => stop })).rejects.toBeInstanceOf(StoppedError)
  })
})
