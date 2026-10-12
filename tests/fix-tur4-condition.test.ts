import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScanResult } from '../electron/matcher'
const state = vi.hoisted(() => ({ stopped: false, scans: [] as unknown[], actions: [] as string[], items: [] as unknown[], requests: [] as string[] }))
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
import { createNode, DEFAULT_SETTINGS } from '../electron/graph-types'
import { setStopCheck } from '../electron/openrouter'
function make(apiKey = 'test-key') {
  return createAgent({ log: () => {}, send: () => {}, shouldStop: () => state.stopped, settings: () => ({ ...DEFAULT_SETTINGS, apiKey, llmPrompts: {}, model: 'test/model', agentModel: 'test/model', agentBackups: [], visionModel: 'test/model', visionBackups: [], findOrder: ['windows', 'onnx', 'list'] as never, findOff: [] }) }).executor
}
const condition = (text: string) => ({ ...createNode('condition', 0, 0), text })
const row = (text: string) => ({ id: 1, text, type: 'Text', src: 'ocr', x: 20, y: 30, w: 170, h: 20, ocrSources: ['onnx'] })
function respond(value: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => { state.requests.push(String(init.body)); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ satisfied: (value as {id?: unknown}).id != null, ...(value as object) }) } }] }) } }))
}
beforeEach(() => { state.stopped = false; state.scans = []; state.actions = []; state.items = []; state.requests = []; setStopCheck(() => false) })
afterEach(() => { vi.unstubAllGlobals(); setStopCheck(() => false); expect(state.actions).toEqual([]) })
describe('Condition contract 1.9.98: the plain sentence is always judged by the text model', () => {
  it('asks the model in the UIA stage and in the OCR stage of one lap', async () => {
    state.items = [{ ...row('Yükleme sürüyor'), src: 'uia', type: 'Text' }, { ...row('All jobs completed 60/60'), id: 2 }]
    // Reader stages field their own evidence, so each stage asks its own prompt and gets its own answer.
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      state.requests.push(String(init.body))
      const answer = state.requests.length === 1 ? { satisfied: false, id: null, reason: 'UIA shows only a running job' } : { satisfied: true, id: 2, reason: 'OCR status line is complete' }
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }) }
    }))
    expect(await make().exists('', condition('iş bitti mi?'))).toBe(true)
    expect(state.scans).toHaveLength(2)
    expect(state.requests).toHaveLength(2)
    expect(state.requests[0]).toContain('Source: current UI Automation')
    expect(state.requests[0]).not.toContain('All jobs completed 60/60')
    expect(state.requests[1]).toContain('Source: current Windows + ONNX OCR')
    expect(state.requests[1]).toContain('All jobs completed 60/60')
  })
  it('a quoted instruction is no longer a local shortcut: the model is still asked', async () => {
    state.items = [{ ...row('Bitti'), src: 'uia', type: 'Button' }]
    respond({ id: 1, reason: 'button text matches' })
    expect(await make().exists('', condition('"Bitti"'))).toBe(true)
    expect(state.requests).toHaveLength(1)
    expect(state.requests[0]).toContain('Instruction: \\"Bitti\\"')
  })
  it('an empty condition box without a saved target is refused with the new message', async () => {
    await expect(make().exists('', condition(''))).rejects.toThrow('koşul için ne aradığını yaz')
    expect(state.scans).toHaveLength(0)
    expect(state.requests).toHaveLength(0)
  })
  it('a missing text model is reported as such, with no local fallback', async () => {
    state.items = [row('Bitti')]
    await expect(make('').exists('', condition('iş bitti mi?'))).rejects.toThrow('Koşul artık her zaman metin modeline sorar; API anahtarı ya da yerel model gerekli.')
    expect(state.requests).toHaveLength(0)
  })
  it('the condition window travels to the model as context and does not scope the scan', async () => {
    state.items = [{ ...row('Toplama tamamlandı'), src: 'uia', type: 'Button' }]
    respond({ id: 1, reason: 'the chosen window reports completion' })
    const n = { ...condition('toplama tamamlandı mı?'), conditionWindow: 'Fixture', conditionWindowMatch: 'exact' as const }
    expect(await make().exists('', n)).toBe(true)
    expect(state.scans[0]).toMatchObject({ readOnly: true }); expect(state.scans[0]).not.toHaveProperty('windowTitle'); expect(state.scans[0]).not.toHaveProperty('strictWindow')
    expect(state.requests[0]).toContain('Requested application/window context: Fixture')
    expect(state.requests[0]).toContain('toplama tamamlandı mı?')
  })
})
