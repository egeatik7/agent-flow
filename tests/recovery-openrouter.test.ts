import { afterEach, describe, expect, it, vi } from 'vitest'
import { recoveryToolTurn, setStopCheck, setLocalEndpoint } from '../electron/openrouter'
import { StoppedError } from '../electron/runner'

afterEach(() => { vi.unstubAllGlobals(); setStopCheck(() => false); setLocalEndpoint(undefined) })
const args = { apiKey: 'fixture', models: ['fixture/primary', 'fixture/backup'], messages: [{ role: 'user' as const, content: 'Repair' }], tools: [], shouldStop: () => false, timeoutMs: 1000 }
describe('OpenRouter recovery native tool calls', () => {
  it('routes Yap local tool calls without leaking the OpenRouter key', async () => {
    setLocalEndpoint('http://localhost:1234/v1', 1000, true)
    const fetch = vi.fn(async (url, init) => {
      expect(url).toBe('http://localhost:1234/v1/chat/completions')
      expect(init.headers.Authorization).toBeUndefined()
      expect(JSON.parse(init.body).model).toBe('fixture')
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'ready' }, finish_reason: 'stop' }] }) }
    })
    vi.stubGlobal('fetch', fetch)
    expect((await recoveryToolTurn({ ...args, allowLocal: true, apiKey: '', models: ['local:fixture'] })).content).toBe('ready')
  })
  it('passes tools to the provider and preserves tool identity and opaque reasoning', async () => {
    const fetch = vi.fn(async (_url, init) => {
      const req = JSON.parse(init.body)
      expect(req.parallel_tool_calls).toBe(false); expect(req.tool_choice).toBe('auto')
      expect(req.tools[0].function.name).toBe('act_key')
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null,
        reasoning_details: [{ type: 'reasoning.encrypted', data: 'opaque' }],
        tool_calls: [{ id: 'native-id', type: 'function', function: { name: 'act_key', arguments: '{"keys":"win+d"}' } }],
      } }] }) }
    })
    vi.stubGlobal('fetch', fetch)
    const reply = await recoveryToolTurn({ ...args, tools: [{ type: 'function', function: { name: 'act_key', description: 'Send keys', parameters: { type: 'object', properties: { keys: { type: 'string' } }, required: ['keys'], additionalProperties: false } } }] })
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
