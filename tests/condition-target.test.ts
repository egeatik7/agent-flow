import { ObservationTimeoutError } from '../electron/observation-budget'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScanResult } from '../electron/matcher'
const state = vi.hoisted(() => ({ stopped: false, missingWindow: '', scans: [] as unknown[], actions: [] as string[], items: [] as unknown[], scanError: null as Error | null, requests: [] as string[] }))
vi.mock('electron', () => ({ screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1000, height: 700 }, scaleFactor: 1 }) } }))
vi.mock('../electron/a11y-bridge', () => ({
  isLocked: async () => false,
  scan: async (opts: unknown) => { state.scans.push(opts); if (state.scanError) throw state.scanError; return { missingWindow: state.missingWindow, items: state.items, area: { x: 0, y: 0, w: 1000, h: 700 }, image: { data: 'test', w: 1000, h: 700 }, window: 'Fixture', ocr: true, ocrCount: state.items.length, uiaCount: 0, ocrEngine: 'combined' } },
  discardShot: () => {},
  applyOnnx: async (s: ScanResult) => s,
  locate: async (_loc: unknown, _win: unknown, readOnly: unknown) => { if (readOnly !== true) state.actions.push('focus-window'); return { x: 0, y: 0, w: 50, h: 30, enabled: true, name: 'Saved' } },
  findImage: async () => ({ score: .99, x: 10, y: 10 }),
  clickAt: async () => state.actions.push('click'), moveMouse: async () => state.actions.push('move'), sendKeys: async () => state.actions.push('keys'), typeText: async () => state.actions.push('type'),
}))
vi.mock('../electron/browser', () => ({ userChromeItems: async () => null }))
vi.mock('../electron/shots', () => ({ rememberShot: () => {} }))
import { createAgent } from '../electron/agent'
import { createNode, DEFAULT_SETTINGS } from '../electron/graph-types'
import { validateConditionReply, setStopCheck } from '../electron/openrouter'
import { StoppedError, runGraph } from '../electron/runner'
function make(order = ['windows', 'onnx', 'list'], apiKey = 'test-key', llmPrompts = {}) {
  return createAgent({ log: () => {}, send: () => {}, shouldStop: () => state.stopped, settings: () => ({ ...DEFAULT_SETTINGS, apiKey, llmPrompts, model: apiKey ? 'test/model' : '', agentModel: 'test/model', agentBackups: [], visionModel: 'test/model', visionBackups: [], findOrder: order as never, findOff: [] }) }).executor
}
const condition = (text: string) => ({ ...createNode('condition', 0, 0), text })
const row = (text: string) => ({ id: 1, text, type: 'Text', src: 'ocr', x: 20, y: 30, w: 170, h: 20, ocrSources: ['onnx'] })
function respond(value: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => { state.requests.push(String(init.body)); const reply = { satisfied: typeof (value as { satisfied?: unknown }).satisfied === 'boolean' ? (value as { satisfied: boolean }).satisfied : (value as { id?: unknown }).id != null, ...(value as object) }; return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }) } }))
}
beforeEach(() => { state.stopped = false; state.missingWindow = ''; state.scans = []; state.actions = []; state.items = []; state.scanError = null; state.requests = []; setStopCheck(() => false) })
afterEach(() => { vi.unstubAllGlobals(); setStopCheck(() => false); expect(state.actions).toEqual([]) })

describe('Condition: one whole-screen observation with model decisions', () => {
  it('asks UIA first and stops on a confirmed positive condition', async () => {
    state.items = [{ ...row('Done 60/60'), src: 'uia', type: 'Button' }]; respond({ satisfied: true, id: 1 })
    expect(await make().exists('', condition('60/60 tamamlandı mı?'))).toBe(true)
    expect(state.scans).toHaveLength(1); expect(state.requests).toHaveLength(1)
    expect(state.scans[0]).toMatchObject({ uia: true, ocr: false, readOnly: true, image: 'none' })
    expect(state.requests[0]).toContain('Source: current UI Automation')
  })
  it('asks about empty UIA, then reads and judges OCR once', async () => {
    state.items = [row('Done 60/60')]; respond({ satisfied: true, id: 1 })
    expect(await make().exists('', condition('60/60 tamamlandı mı?'))).toBe(true)
    expect(state.scans).toHaveLength(2); expect(state.requests).toHaveLength(3)
    expect(state.requests[0]).not.toContain('Done 60/60')
    expect(state.requests[1]).toBe(state.requests[0]) // invalid evidence gets one retry, no extra screen read
    expect(state.requests[2]).toContain('Done 60/60')
    expect(state.scans[1]).toMatchObject({ uia: false, ocr: true, fresh: true, tilt: true, readOnly: true, ocrEngine: 'combined' })
  })
  it('asks both empty reader lists; an empty list is never a local No shortcut', async () => {
    respond({ satisfied: false, id: null, reason: 'reading coverage is unclear' })
    expect(await make().exists('', condition('hata mesajı yoksa evet ver'))).toBe(false)
    expect(state.requests).toHaveLength(2); expect(state.scans).toHaveLength(2)
    expect(state.requests.every(s => s.includes('empty or incomplete reader result alone is not proof'))).toBe(true)
  })
  it('accepts a model-confirmed absence with no selected ID', async () => {
    state.items = [{ ...row('Blender project is ready'), src: 'uia' }]
    respond({ satisfied: true, id: null, reason: 'the requested context is observed and the error is absent' })
    expect(await make().exists('', condition('hata mesajı yoksa evet ver'))).toBe(true)
    expect(state.requests).toHaveLength(1)
  })
  it('empty-list verdict is also the model decision, never inferred from an ID', async () => {
    respond({ satisfied: true, id: null, reason: 'fixture model absence verdict' })
    expect(await make().exists('', condition('hata yok mu?'))).toBe(true)
    expect(state.requests).toHaveLength(1)
  })
  it('satisfied:false remains false even with a valid evidence ID', async () => {
    state.items = [{ ...row('Running 6/60'), src: 'uia' }]; respond({ satisfied: false, id: 1 })
    expect(await make().exists('', condition('60/60 tamamlandı mı?'))).toBe(false)
    expect(state.requests).toHaveLength(3) // the absent OCR evidence ID is retried once
  })
  it('an invented evidence ID cannot prove a positive condition', async () => {
    state.items = [{ ...row('Running'), src: 'uia' }]; respond({ satisfied: true, id: 999 })
    expect(await make().exists('', condition('bitti mi?'))).toBe(false)
  })
  it('preserves full UIA and unsplit OCR evidence, including a late negation/counter', async () => {
    const evidence = 'Job completed ' + 'details '.repeat(35) + 'NOT_COMPLETE_6_OF_60'
    state.items = [{ ...row(evidence), src: 'uia' }, { ...row(evidence), id: 2 }]; respond({ satisfied: false, id: null })
    const before = JSON.stringify(state.items)
    expect(await make().exists('', condition('job completed 60/60?'))).toBe(false)
    expect(state.requests).toHaveLength(2)
    expect(state.requests.every(s => s.includes(evidence))).toBe(true)
    expect(JSON.stringify(state.items)).toBe(before)
  })
  it('sends the whole instruction, with no quoted/local shortcut', async () => {
    state.items = [{ ...row('Done'), src: 'uia' }]; respond({ satisfied: false, id: null })
    expect(await make().exists('Done', condition('"Done" ve 60/60 ise evet'))).toBe(false)
    expect(state.requests[0]).toContain('60/60 ise evet')
  })
  it.each(['exact', 'contains'] as const)('window context never selects a window (%s legacy match)', async match => {
    state.items = [{ ...row('Done'), src: 'uia' }]; respond({ satisfied: false, id: null })
    expect(await make().exists('', { ...condition('bitti mi?'), conditionWindow: 'Missing or ambiguous Blender', conditionWindowMatch: match })).toBe(false)
    expect(state.scans).toHaveLength(2)
    expect(state.scans.every(s => !('windowTitle' in (s as object)) && !('strictWindow' in (s as object)))).toBe(true)
    expect(state.requests.every(s => s.includes('Requested application/window context: Missing or ambiguous Blender'))).toBe(true)
    expect(state.requests.every(s => s.includes('no window was selected or matched'))).toBe(true)
  })
  it('sends custom stage prompts only to their own readers and still enforces the boolean schema', async () => {
    respond({ satisfied: false, id: null })
    expect(await make(undefined, 'test-key', { list: 'CLICK_ONLY', conditionUia: 'MY_UIA', conditionOcr: 'MY_OCR' }).exists('', condition('bitti mi?'))).toBe(false)
    expect(state.requests[0]).toContain('MY_UIA'); expect(state.requests[0]).not.toContain('MY_OCR')
    expect(state.requests[1]).toContain('MY_OCR'); expect(state.requests[1]).not.toContain('MY_UIA')
    expect(state.requests.every(s => s.includes('satisfied') && !s.includes('CLICK_ONLY') && !s.includes('image_url'))).toBe(true)
  })
  it.each(['', 'yeni tarif'])('rejects old selections even when the text is %s, before reads/model calls', async text => {
    const bridge = await import('../electron/a11y-bridge'); const locate = vi.spyOn(bridge, 'locate')
    try {
      await expect(make().exists('', { ...condition(text), locator: { name: 'Old', controlType: 'Button', path: '', windowTitle: 'Old Window' } })).rejects.toThrow('uyumsuz eski koşul')
      expect(state.requests).toHaveLength(0); expect(state.scans).toHaveLength(0); expect(locate).not.toHaveBeenCalled()
    } finally { locate.mockRestore() }
  })
  it('rejects legacy saved icon selections instead of using image matching', async () => {
    await expect(make().exists('', { ...condition(''), locator: { name: '', controlType: 'Point', path: '', icon: 'saved' } })).rejects.toThrow('uyumsuz eski koşul')
  })
  it('rejects blank instructions explicitly', async () => {
    await expect(make().exists('', condition(''))).rejects.toThrow('ne aradığını yaz')
  })
  it('reports a missing model instead of deciding locally', async () => {
    await expect(make(undefined, '').exists('', condition('bitti mi?'))).rejects.toThrow('API anahtarı ya da yerel model gerekli')
    expect(state.scans).toHaveLength(0)
  })
  it('reader failure is a technical error, never a negative branch', async () => {
    state.scanError = new Error('WORKER_CRASH')
    await expect(make().exists('', condition('bitti mi?'))).rejects.toThrow('WORKER_CRASH')
    expect(state.scans).toHaveLength(1)
  })
  it('API failure remains a technical error even on an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => 'invalid key' })))
    await expect(make().exists('', condition('bitti mi?'))).rejects.toThrow('401')
    expect(state.scans).toHaveLength(1)
  })
  it.each([503, 200])('condition retries invalid output once, but does not retry HTTP error %s', async status => {
    const fetchMock = vi.fn(async () => ({ ok: status === 200, status, text: async () => status === 200 ? JSON.stringify({ choices: [{ message: { content: '{"id":null}' } }] }) : 'temporary outage' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(make().exists('', condition('bitti mi?'))).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(status === 200 ? 2 : 1); expect(state.scans).toHaveLength(1)
  })
  it('Stop propagates before observation', async () => {
    state.stopped = true
    await expect(make().exists('', condition('bitti mi?'))).rejects.toBeInstanceOf(StoppedError)
  })
  it('external cancellation aborts a pending model request without a second reader or retry', async () => {
    let requestSignal: AbortSignal | undefined
    const fetchMock = vi.fn(async (_url, init) => { requestSignal = init.signal; return new Promise<never>((_, reject) => requestSignal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController(); const pending = make().exists('', condition('bitti mi?'), { signal: controller.signal })
    const assertion = expect(pending).rejects.toBeInstanceOf(ObservationTimeoutError)
    await vi.waitFor(() => expect(requestSignal).toBeDefined())
    controller.abort(new ObservationTimeoutError()); await assertion
    expect(requestSignal!.aborted).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(1); expect(state.scans).toHaveLength(1)
  })
})

describe('condition response protocol', () => {
  it.each(['null', '{"id":null}', '{"satisfied":"true","id":null}', '{"satisfied":true}', '{"satisfied":true,"id":[1]}'])('refuses malformed or old ID-only reply %s', reply => {
    expect(() => validateConditionReply(reply)).toThrow('MODEL_CONDITION_JSON_INVALID')
  })
  it('accepts explicit boolean absence verdicts without requiring an evidence ID', () => {
    expect(() => validateConditionReply('{"satisfied":true,"id":null}')).not.toThrow()
    expect(() => validateConditionReply('{"satisfied":false,"id":1}')).not.toThrow()
  })
})
