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
import { setStopCheck } from '../electron/openrouter'
import { StoppedError, runGraph } from '../electron/runner'
function make(order = ['windows', 'onnx', 'list'], apiKey = 'test-key', llmPrompts = {}) {
  return createAgent({ log: () => {}, send: () => {}, shouldStop: () => state.stopped, settings: () => ({ ...DEFAULT_SETTINGS, apiKey, llmPrompts, model: apiKey ? 'test/model' : '', agentModel: 'test/model', agentBackups: [], visionModel: 'test/model', visionBackups: [], findOrder: order as never, findOff: [] }) }).executor
}
const condition = (text: string) => ({ ...createNode('condition', 0, 0), text })
const row = (text: string) => ({ id: 1, text, type: 'Text', src: 'ocr', x: 20, y: 30, w: 170, h: 20, ocrSources: ['onnx'] })
function respond(value: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => { state.requests.push(String(init.body)); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }) } }))
}
beforeEach(() => { state.stopped = false; state.missingWindow = ''; state.scans = []; state.actions = []; state.items = []; state.scanError = null; state.requests = []; setStopCheck(() => false) })
afterEach(() => { vi.unstubAllGlobals(); setStopCheck(() => false); expect(state.actions).toEqual([]) })
describe('Condition observes UIA then OCR without desktop input', () => {
  it('asks the model about a quoted UIA button instead of matching the text locally', async () => {
    state.items = [{ ...row('Bitti'), src: 'uia', type: 'Button' }]
    respond({ id: 1, reason: 'button reads as asked' })
    expect(await make().exists('', condition('"Bitti"'))).toBe(true)
    expect(state.scans).toHaveLength(1)
    expect(state.scans[0]).toMatchObject({ uia: true, ocr: false, readOnly: true })
    expect(state.requests).toHaveLength(1)
    expect(state.requests[0]).toContain('\\"Bitti\\"')
  })
  it('falls through absent UIA to combined OCR and asks the model there', async () => {
    state.items = [row('Job finished 60/60')]
    respond({ id: 1, reason: 'job status line shows all sixty' })
    expect(await make().exists('', condition('"Job finished 60/60"'))).toBe(true)
    expect(state.scans).toHaveLength(2)
    expect(state.scans[1]).toMatchObject({ uia: false, ocr: true, fresh: true, tilt: true, ocrEngine: 'combined', readOnly: true })
    expect(state.requests).toHaveLength(1)
    expect(state.requests[0]).toContain('Source: current Windows + ONNX OCR')
  })
  it('a counter mismatch is not accepted even when the text is quoted', async () => {
    state.items = [row('Job finished 6/60')]
    respond({ id: null, reason: 'six of sixty is not sixty of sixty' })
    expect(await make().exists('', condition('"Job finished 60/60"'))).toBe(false)
    expect(state.requests).toHaveLength(1)
    expect(state.requests[0]).toContain('Instruction: \\"Job finished 60/60\\"')
  })
  it('semantic UIA state is judged by the condition prompt, with one model call', async () => {
    state.items = [{ ...row('All jobs completed 60/60'), src: 'uia', type: 'Text' }]
    respond({ id: 1, reason: 'all sixty finished' })
    expect(await make().exists('', condition('job finished 60/60 yazıyorsa evet ver'))).toBe(true)
    expect(state.scans).toHaveLength(1); expect(state.requests).toHaveLength(1)
    expect(state.requests[0]).toContain('cautious, read-only')
    expect(state.requests[0]).toContain('Source: current UI Automation')
    expect(state.requests[0]).toContain('job finished 60/60 yazıyorsa evet ver')
  })
  it('UIA absence proceeds to OCR and preserves the whole semantic instruction', async () => {
    state.items = [row('All jobs completed 60/60')]; respond({ id: 1 })
    expect(await make().exists('job finished', condition('"job finished" ve 60/60 görünüyorsa evet'))).toBe(true)
    expect(state.scans).toHaveLength(2); expect(state.requests).toHaveLength(1)
    expect(state.requests[0]).toContain('Source: current Windows + ONNX OCR')
    expect(state.requests[0]).toContain('60/60 görünüyorsa evet')
  })
  it('a negative UIA decision still permits fresh OCR evidence', async () => {
    state.items = [{ ...row('Running'), src: 'uia' }, { ...row('Completed 60/60'), id: 2 }]
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      state.requests.push(String(init.body))
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ id: state.requests.length === 1 ? null : 2 }) } }] }) }
    }))
    expect(await make().exists('', condition('60/60 tamamlandı mı?'))).toBe(true)
    expect(state.requests).toHaveLength(2); expect(state.scans).toHaveLength(2)
  })
  it('negative evidence stops after one pass per reader without screenshot fallback', async () => {
    state.items = [{ ...row('Start'), src: 'uia', type: 'Button' }, { ...row('BAŞLAMADI'), id: 2 }]
    respond({ id: null, reason: 'not completed' })
    expect(await make(['tars']).exists('', condition('İş bitti mi?'))).toBe(false)
    expect(state.scans).toHaveLength(2); expect(state.requests).toHaveLength(2)
    expect(state.requests.every(r => !r.includes('image_url'))).toBe(true)
  })
  it('does not use a recorded target as proof of a semantic state', async () => {
    state.items = [row('Running')]; respond({ id: null })
    const n = { ...condition('İş bitti mi?'), locator: { controlType: 'Button', name: 'Saved', path: '', automationId: 'saved', windowTitle: 'Fixture' } }
    expect(await make().exists('', n)).toBe(false)
  })
  it('a picked textless element can be found by live UIA identity', async () => {
    const n = { ...condition(''), locator: { controlType: 'Button', name: '', path: '', automationId: 'saved', windowTitle: 'Fixture' } }
    expect(await make(undefined, '').exists('', n)).toBe(true)
    expect(state.scans).toHaveLength(0)
  })
  it('a picked text label is checked with both readers', async () => {
    state.items = [{ ...row('Saved'), src: 'uia', type: 'Button' }]
    const n = { ...condition(''), locator: { controlType: 'Button', name: 'Saved', path: '', windowTitle: 'Fixture' } }
    expect(await make(undefined, '').exists('', n)).toBe(true)
  })
  it('Stop propagates rather than choosing No', async () => {
    state.stopped = true
    await expect(make().exists('', condition('"Done"'))).rejects.toBeInstanceOf(StoppedError)
  })
  it('scan failure propagates rather than choosing No', async () => {
    state.scanError = new Error('capture failed')
    await expect(make().exists('', condition('"Done"'))).rejects.toThrow('capture failed')
  })
  it('a condition without a text model is refused instead of being decided locally', async () => {
    state.items = [row('Bitti')]
    await expect(make(undefined, '').exists('', condition('İş bitti mi?'))).rejects.toThrow('Koşul artık her zaman metin modeline sorar')
    expect(state.requests).toHaveLength(0)
  })
  it('API failure propagates instead of being reported as absence', async () => {
    state.items = [row('Bitti')]
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => 'invalid key' })))
    await expect(make().exists('', condition('İş bitti mi?'))).rejects.toThrow('401')
  })
  it('sends each saved condition prompt only to its own reader stage', async () => {
    state.items = [{ ...row('Running'), src: 'uia' }, { ...row('Completed'), id: 2 }]
    respond({ id: null })
    const prompts = { list: 'CLICK_ONLY', conditionUia: 'MY_UIA_OBSERVER', conditionOcr: 'MY_OCR_OBSERVER' }
    expect(await make(undefined, 'test-key', prompts).exists('', condition('İş bitti mi?'))).toBe(false)
    expect(state.requests).toHaveLength(2)
    expect(state.requests[0]).toContain('MY_UIA_OBSERVER'); expect(state.requests[0]).not.toContain('MY_OCR_OBSERVER')
    expect(state.requests[1]).toContain('MY_OCR_OBSERVER'); expect(state.requests[1]).not.toContain('MY_UIA_OBSERVER')
    expect(state.requests.every(r => !r.includes('CLICK_ONLY'))).toBe(true)
  })
  it('empty reader lists produce No without paying for model calls', async () => {
    respond({ id: 1 })
    expect(await make().exists('', condition('İş bitti mi?'))).toBe(false)
    expect(state.scans).toHaveLength(2); expect(state.requests).toHaveLength(0)
  })
  it('the runner follows Yes/No from observed evidence', async () => {
    for (const yes of [true, false]) {
      state.items = [row('All jobs completed 60/60')]; respond({ id: yes ? 1 : null })
      const ex = make(), seen: string[] = []
      ex.step = (id, status) => { if (status === 'running') seen.push(id) }
      const n = condition('"job finished" ve 60/60 görünüyorsa evet')
      const good = { ...createNode('end', 0, 0), id: 'yes' }, bad = { ...createNode('end', 0, 0), id: 'no' }
      await runGraph({ nodes: [n, good, bad], edges: [{ id: 'true', from: n.id, fromPort: 'true', to: 'yes' }, { id: 'false', from: n.id, fromPort: 'false', to: 'no' }] }, ex, { maxSteps: 10, stepDelayMs: 0, startId: n.id })
      expect(seen).toContain(yes ? 'yes' : 'no'); expect(seen).not.toContain(yes ? 'no' : 'yes')
    }
  })
})
describe('Condition window is a read-only search preference', () => {
  const scoped = (text = '"Toplama tamamlandı"') => ({ ...condition(text), conditionWindow: 'Fixture', conditionSource: 'uia' as const })
  it('uses the chosen window without focusing it, and the model decides inside it', async () => {
    state.items = [{ ...row('Toplama tamamlandı'), src: 'uia', type: 'Button' }]
    respond({ id: 1, reason: 'the chosen window reports completion' })
    expect(await make().exists('', scoped())).toBe(true)
    expect(state.scans[0]).toMatchObject({ windowTitle: 'Fixture', strictWindow: 'exact', fresh: true, readOnly: true })
    expect(state.requests).toHaveLength(1)
    expect(state.requests[0]).toContain('Evidence is from the selected window')
  })
  it('an old UIA-only setting still permits OCR evidence, judged by the model', async () => {
    state.items = [row('Toplama tamamlandı')]
    respond({ id: 1, reason: 'the OCR line reports completion' })
    expect(await make().exists('', scoped())).toBe(true)
    expect(state.scans).toHaveLength(2)
    expect(state.scans[1]).toMatchObject({ windowTitle: 'Fixture', uia: false, ocr: true })
    expect(state.requests).toHaveLength(1)
    expect(state.requests[0]).toContain('Source: current Windows + ONNX OCR')
  })
  it('a semantic instruction no longer requires quotes when scoped', async () => {
    state.items = [row('Completed 60/60')]; respond({ id: 1 })
    expect(await make().exists('', scoped('60/60 tamamlandı mı?'))).toBe(true)
  })
  it('missing or changed window titles broaden the search and keep requested window context', async () => {
    state.items = [{ ...row('Toplama tamamlandı'), src: 'uia' }]
    state.missingWindow = 'Fixture'; respond({ id: 1 })
    expect(await make().exists('', scoped())).toBe(true)
    expect(state.scans).toHaveLength(2)
    expect(state.scans[1]).not.toHaveProperty('windowTitle')
    expect(state.requests[0]).toContain('Preferred application/window: Fixture')
    expect(state.requests[0]).toContain('unrelated application')
    state.scans = []; state.requests = []; state.missingWindow = ''
    expect(await make().exists('', { ...scoped(), conditionWindow: 'Old title' })).toBe(true)
    expect(state.scans).toHaveLength(2)
    expect(state.requests[0]).toContain('Old title')
  })
  it('a scoped worker failure is not mistaken for a missing window', async () => {
    state.scanError = new Error('WORKER_CRASH')
    await expect(make().exists('', scoped())).rejects.toThrow('WORKER_CRASH')
    expect(state.scans).toHaveLength(1)
  })
  it('ambiguous window titles broaden once and never retry the ambiguous selection', async () => {
    state.items = [row('Toplama tamamlandı')]; respond({ id: 1 })
    state.scanError = new Error('WINDOW_AMBIGUOUS: Fixture')
    // Only the scoped request fails; broad screen observation succeeds.
    const { scan } = await import('../electron/a11y-bridge')
    const original = scan
    const spy = vi.spyOn(await import('../electron/a11y-bridge'), 'scan').mockImplementation(async opts => {
      state.scanError = opts.strictWindow ? new Error('WINDOW_AMBIGUOUS: Fixture') : null
      return original(opts)
    })
    try {
      expect(await make().exists('', scoped())).toBe(true)
      expect(state.scans).toHaveLength(3)
      expect(state.scans.slice(1).every(s => !(s as { strictWindow?: string }).strictWindow)).toBe(true)
    } finally { spy.mockRestore() }
  })
})

describe('condition review fixes', () => {
  it('the model decides a quoted status embedded in a historical log line instead of matching it locally', async () => {
    state.items = [{ ...row('Log: Toplama tamamlandı yazısını bekle'), src: 'uia' }, { ...row('Log: Toplama tamamlandı yazısını bekle'), id: 2 }]
    respond({ id: null, reason: 'the text only appears inside a log line' })
    expect(await make().exists('', condition('"Toplama tamamlandı"'))).toBe(false)
    // Both readers asked; the second reading is not skipped just because the first said no.
    expect(state.requests).toHaveLength(2)
    expect(state.requests[0]).toContain('Log: Toplama tamamlandı yazısını bekle')
    expect(state.requests[1]).toContain('Source: current Windows + ONNX OCR')
  })
  it('evidence from an unrelated application is evaluated rather than matched blindly', async () => {
    state.missingWindow = 'Blender Project A'; state.items = [row('Toplama tamamlandı')]
    respond({ id: null, reason: 'This status belongs to another application' })
    expect(await make().exists('', { ...condition('"Toplama tamamlandı"'), conditionWindow: 'Blender Project A' })).toBe(false)
    expect(state.requests[0]).toContain('Blender Project A')
  })
  it('UIA errors for a textless saved target are not turned into absence', async () => {
    const bridge = await import('../electron/a11y-bridge')
    const spy = vi.spyOn(bridge, 'locate').mockRejectedValue(new Error('WORKER_CRASH'))
    try {
      const n = { ...condition(''), locator: { controlType: 'Button', name: '', path: '', automationId: 'saved', windowTitle: 'Fixture' } }
      await expect(make().exists('', n)).rejects.toThrow('WORKER_CRASH')
    } finally { spy.mockRestore() }
  })
  it('icon reader errors for a textless saved target are not turned into absence', async () => {
    const bridge = await import('../electron/a11y-bridge')
    const spy = vi.spyOn(bridge, 'findImage').mockRejectedValue(new Error('IMAGE_READER_FAILED'))
    try {
      const n = { ...condition(''), locator: { controlType: 'Point', name: '', path: '', icon: 'saved-image' } }
      await expect(make().exists('', n)).rejects.toThrow('IMAGE_READER_FAILED')
    } finally { spy.mockRestore() }
  })
  it('deadline aborts a pending model request without retries or a false decision', async () => {
    state.items = [row('Running')]
    let requestSignal: AbortSignal | undefined
    const fetchMock = vi.fn(async (_url, init) => {
      requestSignal = init.signal
      return new Promise<never>((_, reject) => requestSignal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const pending = make().exists('', condition('İş bitti mi?'), { signal: controller.signal })
    const assertion = expect(pending).rejects.toBeInstanceOf(ObservationTimeoutError)
    await vi.waitFor(() => expect(requestSignal).toBeDefined())
    controller.abort(new ObservationTimeoutError()); await assertion
    expect(requestSignal!.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
