import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScanResult } from '../electron/matcher'
const state = vi.hoisted(() => ({ stopped: false, scans: [] as unknown[], actions: [] as string[], items: [] as unknown[], models: [] as string[], requests: [] as string[] }))
vi.mock('electron', () => ({ screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1000, height: 700 }, scaleFactor: 1 }) } }))
vi.mock('../electron/a11y-bridge', () => ({
  isLocked: async () => false,
  scan: async (opts: unknown) => { state.scans.push(opts); return { missingWindow: '', items: state.items, area: { x: 0, y: 0, w: 1000, h: 700 }, image: { data: 'test', w: 1000, h: 700 }, window: 'Fixture', ocr: true, ocrCount: state.items.length, uiaCount: 0, ocrEngine: 'combined' } },
  discardShot: () => {},
  applyOnnx: async (s: ScanResult) => s,
  locate: async () => ({ x: 0, y: 0, w: 50, h: 30, enabled: true, name: 'Saved' }),
  findImage: async () => ({ score: .99, x: 10, y: 10 }),
  clickAt: async () => state.actions.push('click'), moveMouse: async () => state.actions.push('move'), sendKeys: async () => state.actions.push('keys'), typeText: async () => state.actions.push('type'),
}))
vi.mock('../electron/browser', () => ({ userChromeItems: async () => null }))
vi.mock('../electron/shots', () => ({ rememberShot: () => {} }))
import { createAgent } from '../electron/agent'
import { createNode, DEFAULT_SETTINGS, modelChain } from '../electron/graph-types'
import { setStopCheck } from '../electron/openrouter'
function make(patch: Record<string, unknown> = {}) {
  return createAgent({ log: () => {}, send: () => {}, shouldStop: () => state.stopped, settings: () => ({ ...DEFAULT_SETTINGS, apiKey: 'test-key', model: 'text/main', modelBackups: [], findOrder: ['windows', 'onnx', 'list'] as never, findOff: [], ...patch }) }).executor
}
const condition = (text: string) => ({ ...createNode('condition', 0, 0), text })
const row = (text: string) => ({ id: 1, text, type: 'Text', src: 'uia', x: 20, y: 30, w: 170, h: 20 })
/**
 * Records every outgoing model name. The first `failFor` requests get a temporary outage (503),
 * which is the failure the chain answers by moving to the next model in order.
 */
function respond(value: unknown, failFor = 0) {
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(String(init.body)) as { model?: string }
    state.requests.push(String(init.body)); state.models.push(String(body.model ?? ''))
    if (state.models.length <= failFor) return { ok: false, status: 503, text: async () => 'temporary outage' }
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }) }
  }))
}
/** The model names the condition asked, in the order the requests actually went out. */
const chainOf = () => state.models
beforeEach(() => { state.stopped = false; state.scans = []; state.actions = []; state.items = []; state.models = []; state.requests = []; setStopCheck(() => false) })
afterEach(() => { vi.unstubAllGlobals(); setStopCheck(() => false); expect(state.actions).toEqual([]) })

describe('Koşul modeli — condition model chain', () => {
  it('uses the condition chain on its own and never the text chain', async () => {
    state.items = [row('Done 60/60')]
    respond({ satisfied: true, id: 1 })
    expect(await make({ conditionModel: 'cond/one', conditionBackups: ['cond/two'] }).exists('', condition('bitti mi?'))).toBe(true)
    expect(chainOf()).toEqual(['cond/one'])
    expect(state.requests[0]).toContain('bitti mi?')
    expect(state.requests[0]).not.toContain('text/main')
  })
  it('falls back to the Metin Modeli chain while the condition field is empty', async () => {
    state.items = [row('Done 60/60')]
    respond({ satisfied: true, id: 1 })
    expect(await make({ conditionModel: '', conditionBackups: [], model: 'text/main', modelBackups: ['text/backup'] }).exists('', condition('bitti mi?'))).toBe(true)
    expect(chainOf()).toEqual(['text/main'])
    expect(state.requests[0]).toContain('bitti mi?')
    expect(state.requests[0]).not.toContain('cond/one')
  })
  it('keeps the backup order of the condition chain', async () => {
    state.items = [row('Done 60/60')]
    respond({ satisfied: true, id: 1 }, 2)
    expect(await make({ conditionModel: 'cond/one', conditionBackups: ['cond/two', 'cond/three'] }).exists('', condition('bitti mi?'))).toBe(true)
    expect(chainOf()).toEqual(['cond/one', 'cond/two', 'cond/three'])
    expect(chainOf()).not.toContain('text/main')
  })
  it('asks both readers with the condition chain and never with the text chain', async () => {
    state.items = [{ ...row('Running 6/60'), src: 'ocr' }]
    respond({ satisfied: false, id: 1 }, 1)
    expect(await make({ conditionModel: 'cond/one', conditionBackups: [] }).exists('', condition('60/60 tamamlandı mı?'))).toBe(false)
    expect(state.scans).toHaveLength(2)
    expect(chainOf()).toEqual(['cond/one', 'cond/one'])
    expect(chainOf()).not.toContain('text/main')
  })
  it('a blank primary name alone does not disable the condition chain', async () => {
    state.items = [row('Done 60/60')]
    respond({ satisfied: true, id: 1 })
    expect(await make({ conditionModel: '', conditionBackups: ['cond/two'] }).exists('', condition('bitti mi?'))).toBe(true)
    expect(chainOf()).toEqual(['cond/two'])
  })
})

describe('Koşul modeli — defaults', () => {
  it('DEFAULT_SETTINGS ships both new fields empty', () => {
    expect(DEFAULT_SETTINGS.conditionModel).toBe('')
    expect(DEFAULT_SETTINGS.conditionBackups).toEqual([])
    expect(modelChain(DEFAULT_SETTINGS.conditionModel, DEFAULT_SETTINGS.conditionBackups)).toEqual([])
    expect(modelChain(DEFAULT_SETTINGS.conditionModel, DEFAULT_SETTINGS.conditionBackups)).not.toContain(DEFAULT_SETTINGS.model)
  })
})
