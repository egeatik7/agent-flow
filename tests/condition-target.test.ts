import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScanResult } from '../electron/matcher'
const state = vi.hoisted(() => ({ stopped: false, scans: [] as unknown[], actions: [] as string[], items: [] as unknown[], scanError: null as Error | null, requests: [] as string[] }))
vi.mock('electron', () => ({ screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1000, height: 700 }, scaleFactor: 1 }) } }))
vi.mock('../electron/a11y-bridge', () => ({
  isLocked: async () => false,
  scan: async (opts: unknown) => { state.scans.push(opts); if (state.scanError) throw state.scanError; return { items: state.items, area: { x: 0, y: 0, w: 1000, h: 700 }, image: { data: 'test', w: 1000, h: 700 }, window: 'Fixture', ocr: true, ocrCount: state.items.length, uiaCount: 0, ocrEngine: 'combined' } },
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
function make(order = ['windows', 'onnx', 'list'], apiKey = 'test-key') {
  return createAgent({ log: () => {}, send: () => {}, shouldStop: () => state.stopped, settings: () => ({ ...DEFAULT_SETTINGS, apiKey, model: 'test/model', agentModel: 'test/model', agentBackups: [], visionModel: 'test/model', visionBackups: [], findOrder: order as never, findOff: [] }) }).executor
}
const condition = (text: string) => ({ ...createNode('condition', 0, 0), text })
const row = (text: string) => ({ id: 1, text, type: 'Text', src: 'ocr', x: 20, y: 30, w: 170, h: 20, ocrSources: ['onnx'] })
function respond(value: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => { state.requests.push(String(init.body)); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }) } }))
}
beforeEach(() => { state.stopped = false; state.scans = []; state.actions = []; state.items = []; state.scanError = null; state.requests = []; setStopCheck(() => false) })
afterEach(() => { vi.unstubAllGlobals(); setStopCheck(() => false); expect(state.actions).toEqual([]) })
describe('Condition uses the shared resolver without desktop input', () => {
  it('quoted-only conditions use local combined OCR without a model/key', async () => {
    state.items = [row('Job finished 60/60')]
    expect(await make(undefined, '').exists('finished 60/60', condition('"finished 60/60"'))).toBe(true)
    expect(await make(undefined, '').exists('finished 6/60', condition('“finished 6/60”'))).toBe(false)
    expect(state.requests).toEqual([])
    expect(state.scans[0]).toMatchObject({ readOnly: true, fresh: true, ocrEngine: 'combined' })
  })
  it('plain text is interpreted by the LLM even when it matches a visible row', async () => {
    state.items = [row('Bitti')]; respond({ id: 1, reason: 'finished' })
    expect(await make().exists('Bitti', condition('Bitti'))).toBe(true)
    expect(state.requests).toHaveLength(1)
    expect(state.scans[0]).toMatchObject({ readOnly: true, ocrEngine: 'combined', deferOnnx: false })
  })
  it('keeps the entire semantic instruction and allows ONNX line evidence without fake words', async () => {
    state.items = [row('All jobs completed 60/60')]; respond({ id: 1, reason: 'completed all sixty' })
    expect(await make().exists('job finished', condition('job finished 60/60 yazıyorsa evet ver'))).toBe(true)
    const request = state.requests[0]
    expect(request).toContain('job finished 60/60 yazıyorsa evet ver'); expect(request).toContain('READ-ONLY existence condition')
    expect(request).toContain('OCR-reader=onnx'); expect(request).toContain('6/60 is not 60/60')
  })
  it('embedded quotes do not bypass the LLM or discard required counters', async () => {
    state.items = [row('Job finished 6/60')]; respond({ id: null, reason: 'only six finished' })
    expect(await make().exists('Job finished', condition('"Job finished" ve 60/60 görünüyorsa evet'))).toBe(false)
    expect(state.requests).toHaveLength(1); expect(state.requests[0]).toContain('60/60 görünüyorsa evet')
  })
  it('absent semantic evidence returns false rather than using stale recorded targets', async () => {
    state.items = [row('Running')]; respond({ id: null, reason: 'still running' })
    const n = { ...condition('İş bitti mi?'), locator: { controlType: 'Button', name: 'Saved', path: '', automationId: 'saved', windowTitle: 'Fixture' } }
    expect(await make().exists(n.text, n)).toBe(false)
  })
  it('a visual-only configuration uses OCR/text evidence instead of screenshot analysis', async () => {
    state.items = [row('Bitti')]; respond({ id: 1, reason: 'completion evidence' })
    expect(await make(['tars']).exists('İş bitti mi?', condition('İş bitti mi?'))).toBe(true)
    expect(state.scans[0]).toMatchObject({ readOnly: true, uia: false, image: 'none', ocrEngine: 'combined' })
    expect(state.requests[0]).toContain('READ-ONLY existence condition')
    expect(state.requests[0]).not.toContain('image_url')
  })
  it('missing OCR evidence returns false without opening a menu or using visual fallback', async () => {
    state.items = [row('BAŞLAMADI')]; respond({ id: null, reason: 'not finished' })
    expect(await make(['tars']).exists('İş bitti mi?', condition('İş bitti mi?'))).toBe(false)
    expect(state.requests).toHaveLength(1)
    expect(state.requests[0]).not.toContain('image_url')
  })
  it('text API failures propagate instead of being reported as absence', async () => {
    state.items = [row('Bitti')]
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => 'invalid key' })))
    await expect(make(['tars']).exists('İş bitti mi?', condition('İş bitti mi?'))).rejects.toThrow('401')
  })
  it('the real runner follows Yes/No while passing the full instruction unchanged', async () => {
    for (const yes of [true, false]) {
      state.items = [row('All jobs completed 60/60')]; respond({ id: yes ? 1 : null })
      const ex = make(), seen: string[] = []
      ex.step = (id, status) => { if (status === 'running') seen.push(id) }
      const n = condition('"job finished" ve 60/60 görünüyorsa evet')
      const good = { ...createNode('end', 0, 0), id: 'yes' }, bad = { ...createNode('end', 0, 0), id: 'no' }
      await runGraph({ nodes: [n, good, bad], edges: [{ id: 'true', from: n.id, fromPort: 'true', to: 'yes' }, { id: 'false', from: n.id, fromPort: 'false', to: 'no' }] }, ex, { maxSteps: 10, stepDelayMs: 0, startId: n.id })
      expect(seen).toContain(yes ? 'yes' : 'no'); expect(seen).not.toContain(yes ? 'no' : 'yes')
      expect(state.requests.at(-1)).toContain('60/60 görünüyorsa evet')
    }
  })
  it('Stop is an error, not a false condition', async () => {
    state.stopped = true
    await expect(make().exists('"Done"', condition('"Done"'))).rejects.toBeInstanceOf(StoppedError)
  })
  it('scan failures and missing API configuration are errors, not false evidence', async () => {
    state.scanError = new Error('capture failed')
    await expect(make().exists('"Done"', condition('"Done"'))).rejects.toThrow('capture failed')
    await expect(make(undefined, '').exists('İş bitti mi?', condition('İş bitti mi?'))).rejects.toThrow('API anahtarı')
  })
  it('captured text without an instruction is found by OCR, never by UIA', async () => {
    state.items = [row('Saved')]
    const n = { ...condition(''), locator: { controlType: 'Button', name: 'Saved', path: '', automationId: 'saved', windowTitle: 'Fixture' } }
    expect(await make(undefined, '').exists('', n)).toBe(true)
    expect(state.scans[0]).toMatchObject({ readOnly: true, uia: false, image: 'none' })
    state.items = [{ ...row('Saved'), src: 'uia', type: 'Button' }]
    expect(await make(undefined, '').exists('', n)).toBe(false)
  })
  it('BAŞLAMADI cannot turn into Yes through UI-TARS after the text model says No', async () => {
    state.items = [row('BAŞLAMADI')]
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      state.requests.push(String(init.body))
      const content = state.requests.length === 1
        ? JSON.stringify({ id: null, reason: 'BAŞLAMADI is not BİTTİ' })
        : "Thought: I see BAŞLAMADI\nIntent: target\nAction: click(start_box='(644,215)')"
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) }
    }))
    expect(await make(['windows', 'onnx', 'list', 'tars', 'offset']).exists('BİTTİ', condition('BİTTİ'))).toBe(false)
    expect(state.requests).toHaveLength(1)
  })
  it('quoted and semantic conditions ignore UIA-only text and never send screenshots', async () => {
    state.items = [{ ...row('Bitti'), src: 'uia', type: 'Pane' }]
    respond({ id: 1, reason: 'UIA says finished' })
    expect(await make().exists('"Bitti"', condition('"Bitti"'))).toBe(false)
    expect(await make(['chrome', 'uia', 'icon', 'windows', 'onnx', 'list', 'tars', 'offset']).exists('Bitti', condition('Bitti'))).toBe(false)
    expect(state.requests).toHaveLength(1)
    expect(state.requests[0]).not.toContain('#1 Pane')
    expect(state.requests[0]).not.toContain('image_url')
    expect(state.scans.every(s => (s as {image: string; uia: boolean}).image === 'none' && (s as {uia: boolean}).uia === false)).toBe(true)
  })
  it('fast/local-only stages do not re-enable model calls for semantic conditions', async () => {
    state.items = [row('Bitti')]; respond({ id: 1 })
    expect(await make(['uia', 'windows', 'onnx']).exists('Bitti', condition('Bitti'))).toBe(false)
    expect(state.requests).toHaveLength(0)
  })
})
