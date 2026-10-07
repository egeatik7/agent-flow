import { afterEach, describe, expect, it, vi } from 'vitest'
import { chooseScreenTarget, setStopCheck, validateTargetReply, ModelRejected, guiStep } from '../electron/openrouter'
import type { ScanResult } from '../electron/matcher'
afterEach(() => { vi.unstubAllGlobals(); setStopCheck(() => false) })
const scan = { area: { x: 0, y: 0, w: 1000, h: 700 }, items: [{ id: 1, text: 'path', type: 'Edit', src: 'uia', x: 100, y: 100, w: 200, h: 20 }], image: null } as ScanResult
describe('target response failures', () => {
  it('rejects reasoning prose ending in incomplete JSON instead of returning absent target', () => {
    expect(() => validateTargetReply('We need id 181. So {"id":181,"reason":"Görsel klasörü altı')).toThrow(ModelRejected)
    expect(() => validateTargetReply('{"id":null,"reason":"No observed target"}')).not.toThrow()
  })
  it('moves to the next model after invalid target JSON and uses its actual observed ID', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const req = JSON.parse(init.body); calls.push(req.model)
      return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: req.model === 'broken' ? 'Need {"id":1,' : '{"id":1}' }, finish_reason: 'stop' }] }) }
    }))
    const result = await chooseScreenTarget({ apiKey: 'fake', model: ['broken', 'valid'], prompt: 'path', kind: 'click', stepTitle: 'Click', scan, sendImage: false })
    expect(result.id).toBe(1); expect(calls).toEqual(['broken', 'valid'])
  })
  it('rejects finish_reason=length even if an early JSON object happens to be complete', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const req = JSON.parse(init.body); calls.push(req.model)
      return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: req.model === 'cut' ? '{"id":null}' : '{"id":1}' }, finish_reason: req.model === 'cut' ? 'length' : 'stop' }] }) }
    }))
    expect((await chooseScreenTarget({ apiKey: 'fake', model: ['cut', 'valid'], prompt: 'path', kind: 'click', stepTitle: 'Click', scan, sendImage: false })).id).toBe(1)
    expect(calls).toEqual(['cut', 'valid'])
  })
  it('adds scope/move contract to runtime messages even with a saved old screenshot prompt', async () => {
    let req: any
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      req = JSON.parse(init.body)
      return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: '{"action":"finished"}' } }] }) }
    }))
    await guiStep({ apiKey: 'fake', model: 'model', goal: 'Open existing profile', initiative: true, jsonPrompt: 'SAVED CUSTOM', history: [], screen: { data: 'fake', w: 1000, h: 700 } })
    expect(req.messages[0].content).toBe('SAVED CUSTOM')
    expect(req.messages[1].content[0].text).toContain('return finished/done immediately')
    expect(req.messages[1].content[0].text).toContain('Add/New/Create')
    expect(req.messages[1].content[0].text).toContain('use click_current')
  })
})
