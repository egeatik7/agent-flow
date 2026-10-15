import { afterEach, expect, it, vi } from 'vitest'
import { ModelOutputRejected, ModelRejected, FatalApiError, runModelChain, setStopCheck, chooseScreenTarget, recoveryToolTurn } from '../electron/openrouter'
import { StoppedError } from '../electron/runner'
afterEach(() => { vi.unstubAllGlobals(); setStopCheck(() => false) })
it('tries the same model once more before its backup, and never loops rejected outputs', async () => {
  const calls: string[] = []
  await expect(runModelChain(['A', 'B'], async model => { calls.push(model); throw new ModelOutputRejected('bad JSON') }, 0)).rejects.toThrow('bad JSON')
  expect(calls).toEqual(['A', 'A', 'B', 'B'])
})
it('a corrected second output is accepted without trying a backup', async () => {
  let calls = 0
  await expect(runModelChain(['A', 'B'], async () => { if (++calls === 1) throw new ModelOutputRejected('bad JSON'); return 'valid' }, 0)).resolves.toBe('valid')
  expect(calls).toBe(2)
})
it('configuration errors skip directly to a backup; credit failure advances the finite model alternatives', async () => {
  const calls: string[] = []
  expect(await runModelChain(['A', 'B'], async model => { calls.push(model); if (model === 'A') throw new ModelRejected('disabled'); return 'ok' }, 0)).toBe('ok')
  expect(calls).toEqual(['A', 'B'])
  const fatal = vi.fn(async () => { throw new FatalApiError('HTTP 402') })
  await expect(runModelChain(['A', 'B'], fatal, 0)).rejects.toThrow('402')
  expect(fatal).toHaveBeenCalledTimes(2)
})
it('Stop after the rejected first output prevents the extra attempt', async () => {
  let stopped = false; setStopCheck(() => stopped)
  const run = vi.fn(async () => { stopped = true; throw new ModelOutputRejected('bad JSON') })
  await expect(runModelChain(['A'], run, 0)).rejects.toBeInstanceOf(StoppedError)
  expect(run).toHaveBeenCalledTimes(1)
})
it('an OCR name/ID contradiction gets one fresh answer; legitimate null gets no extra attempt', async () => {
  const requests: string[] = [], replies = [{ id: 1, text: 'Compass.glb' }, { id: 1, text: 'AnvilL1.glb' }, { id: null }]
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => { requests.push(JSON.parse(init.body).model); return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(replies.shift()) } }] }) } }))
  const opts: Parameters<typeof chooseScreenTarget>[0] = { apiKey: 'fake', model: ['A', 'B'], prompt: 'Select a .glb file', kind: 'click', stepTitle: 'fixture', sendImage: false,
    scan: { window: 'Fixture', area: { x: 0, y: 0, w: 1000, h: 700 }, image: null, items: [{ id: 1, text: 'AnvilL1.glb', type: 'Text', src: 'ocr', x: 50, y: 50, w: 80, h: 20 }], ocr: true, uiaCount: 0, ocrCount: 1 } }
  expect((await chooseScreenTarget(opts)).text).toBe('AnvilL1.glb')
  expect(requests).toEqual(['A', 'A'])
  expect((await chooseScreenTarget(opts)).id).toBeNull()
  expect(requests).toEqual(['A', 'A', 'A'])
})

it('tool-call arguments rejected before dispatch get one retry on the same model', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body.model)
    const value = calls.length === 1 ? 'bad integer' : 10
    return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'call', type: 'function', function: { name: 'act_wait', arguments: JSON.stringify({ ms: value }) } }] }, finish_reason: 'tool_calls' }] }) }
  }))
  const result = await recoveryToolTurn({ apiKey: 'fake', models: ['A', 'B'], messages: [{ role: 'user', content: 'wait' }], tools: [{ type: 'function', function: { name: 'act_wait', description: 'wait', parameters: { type: 'object', properties: { ms: { type: 'integer' } }, required: ['ms'], additionalProperties: false } } }], shouldStop: () => false, timeoutMs: 1000 })
  expect(calls).toEqual(['A', 'A'])
  expect(JSON.parse(result.tool_calls![0].function.arguments)).toEqual({ ms: 10 })
})
