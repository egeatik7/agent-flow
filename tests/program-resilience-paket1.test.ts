import { afterEach, describe, expect, it, vi } from 'vitest'
import { recoveryToolTurn, setLocalEndpoint, setStopCheck, validateConditionReply, type RecoveryModelSession, type ToolMessage } from '../electron/openrouter'

afterEach(() => { vi.unstubAllGlobals(); setLocalEndpoint(undefined); setStopCheck(() => false) })

describe('condition evidence contract', () => {
  it('rejects the logged positive-null answer instead of advancing past a missing download button', () => {
    expect(() => validateConditionReply(JSON.stringify({ satisfied: true, id: null, text: '生成失败', reason: 'The download button is not visible.' }))).toThrow('EVIDENCE_MISSING')
  })
  it('keeps an evidenced positive and an explicitly reasoned absence question compatible', () => {
    expect(() => validateConditionReply('{"satisfied":true,"id":42}')).not.toThrow()
    expect(() => validateConditionReply('{"satisfied":true,"id":null,"basis":"absence","reason":"Current application is visible; no error is shown."}')).not.toThrow()
  })
  it.each([true, false])('does not turn unknown coverage into satisfied:%s', satisfied => {
    expect(() => validateConditionReply(JSON.stringify({ satisfied, id: null, basis: 'unknown' }))).toThrow('UNDECIDED')
  })
  it.each([['absence'], {}, 42])('rejects a non-string evidence basis: %j', basis => {
    expect(() => validateConditionReply(JSON.stringify({ satisfied: true, id: null, basis, reason: 'x' }))).toThrow('JSON_INVALID')
  })
})

const messages: ToolMessage[] = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,fixture' } }] }]
const base = { apiKey: 'PRIVATE_FIXTURE_KEY', models: ['fixture/primary', 'fixture/backup'], messages, tools: [], shouldStop: () => false, timeoutMs: 1000, stage: 'recovery', revision: 1 }
const success = () => ({ ok: true, status: 200, text: async () => '{"choices":[{"message":{"content":"ready"},"finish_reason":"stop"}]}' })

describe('image capability observations belong to one recovery session', () => {
  function provider(rejection = 'No endpoints found that support image input', status = 404) {
    const models: string[] = []
    const fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body)
      models.push(body.model)
      expect(init.body).not.toContain('PRIVATE_FIXTURE_KEY')
      expect(init.body).not.toContain('modelSession')
      expect(init.body).not.toContain('imageUnsupported')
      if (body.model === 'fixture/primary' && JSON.stringify(body.messages).includes('image_url')) return { ok: false, status, text: async () => rejection }
      return success()
    })
    vi.stubGlobal('fetch', fetch)
    return models
  }
  it('falls back once, skips only the incompatible image model on later image turns, and permits text turns', async () => {
    const models = provider()
    const modelSession: RecoveryModelSession = { imageUnsupported: new Set() }
    await recoveryToolTurn({ ...base, modelSession })
    await recoveryToolTurn({ ...base, modelSession })
    await recoveryToolTurn({ ...base, modelSession, messages: [{ role: 'user', content: 'Text-only observation' }] })
    expect(models).toEqual(['fixture/primary', 'fixture/backup', 'fixture/backup', 'fixture/primary'])
  })
  it.each(['revision', 'key', 'new-session'] as const)('retries the primary after %s changes', async change => {
    const models = provider()
    const modelSession: RecoveryModelSession = { imageUnsupported: new Set() }
    await recoveryToolTurn({ ...base, modelSession })
    await recoveryToolTurn({ ...base, modelSession,
      ...(change === 'revision' ? { revision: 2 } : change === 'key' ? { apiKey: 'NEW_KEY' } : { modelSession: { imageUnsupported: new Set<string>() } }),
    })
    expect(models).toEqual(['fixture/primary', 'fixture/backup', 'fixture/primary', 'fixture/backup'])
  })
  it.each([404, 429])('does not cache a generic HTTP %s failure as a vision limitation', async status => {
    const models = provider('Temporary provider failure', status)
    const modelSession: RecoveryModelSession = { imageUnsupported: new Set() }
    await recoveryToolTurn({ ...base, modelSession })
    await recoveryToolTurn({ ...base, modelSession })
    expect(models).toEqual(['fixture/primary', 'fixture/backup', 'fixture/primary', 'fixture/backup'])
    expect(modelSession.imageUnsupported.size).toBe(0)
  })
})
