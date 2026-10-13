import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ScanResult, ScreenItem } from '../electron/matcher'

const state = vi.hoisted(() => ({ scan: null as unknown, point: { x: 0, y: 0 }, clicks: [] as [number, number][], requests: [] as any[], logs: [] as string[] }))
vi.mock('electron', () => ({ screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1000, height: 700 }, scaleFactor: 1 }) } }))
vi.mock('../electron/a11y-bridge', () => ({
  isLocked: async () => false, scan: async (opts: any) => opts?.cursorMarker ? { ...state.scan as object, cursor: { ...state.point } } : state.scan, discardShot: () => {},
  locate: async () => null, findImage: async () => null,
  clickAt: async (x: number, y: number) => { state.clicks.push([x, y]) },
  moveMouse: async (x: number, y: number) => { state.point = { x, y }; return { hwnd: 1 } }, sendKeys: async () => {},
  clickCurrentAt: async (x: number, y: number) => { state.clicks.push([x, y]) },
  cursorPos: async () => ({ ...state.point }), inputTarget: async () => ({ hwnd: '1', pid: 10, title: 'Fixture', rect: { x: 0, y: 0, w: 1000, h: 700 } }),
  assertInputTarget: async () => {}, focusedValue: async () => null,
  inputState: async () => ({ type: 'Edit', window: 'Fixture' }),
  foreground: async () => ({ title: 'Fixture', pid: 10, hwnd: '1', proc: 'fixture' }), windowRect: async () => ({ x: 0, y: 0, w: 1000, h: 700 }),
}))
vi.mock('../electron/browser', () => ({ userChromeItems: async () => null }))
vi.mock('../electron/shots', () => ({ rememberShot: () => {} }))

import { createAgent } from '../electron/agent'
import { createNode, DEFAULT_SETTINGS } from '../electron/graph-types'
import { chooseOcrWord, setLocalEndpoint, setStopCheck } from '../electron/openrouter'
import { normalizePrompts, WORD_CHOICE_PROMPT } from '../electron/llm-flow'
import { wordCandidates } from '../electron/word-targets'

const row: ScreenItem = { id: 7, text: '04_Hunyuanm Blender 5.2', src: 'ocr', type: 'Text', x: 100, y: 80, w: 400, h: 20,
  words: [{ t: '04_Hunyuanm', x: 100, y: 80, w: 100, h: 20 }, { t: 'Blender', x: 300, y: 80, w: 80, h: 20 }, { t: '5.2', x: 450, y: 80, w: 40, h: 20 }] }
const scan: ScanResult = { area: { x: 0, y: 0, w: 1000, h: 700 }, items: [row], image: { data: Buffer.from('FAKE_IMAGE').toString('base64'), w: 1000, h: 700 }, ocr: true, uiaCount: 0, ocrCount: 1, window: 'Fixture' }
const ids = () => wordCandidates(state.scan as ScanResult).filter(c => c.wordIndex !== undefined)
function respond(first: number, second: unknown, fallback = false) {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const request = JSON.parse(init.body); state.requests.push(request)
    const short = typeof request.messages[1].content === 'string' && request.messages[1].content.startsWith('Instruction:')
    const pointerCheck = JSON.stringify(request.messages).includes('confirm|adjust|uncertain')
    const reply = pointerCheck ? { decision: 'confirm', reason: 'pointer on visual target' } : short ? second : fallback && state.requests.length > 2 ? { intent: 'target', x: 900, y: 800, reason: 'fallback' } : { id: first, text: 'fixture', reason: 'fixture' }
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }) }
  }))
}
const executor = (patch: Record<string, unknown> = {}) => createAgent({ log: (_level, text) => state.logs.push(text), send: () => {}, shouldStop: () => false,
  settings: () => ({ ...DEFAULT_SETTINGS, apiKey: 'fake', model: 'first/model', findOrder: ['list'], findOff: [], sendScreenshot: true, stepDelayMs: 0, screenCheck: 'off', ...patch }) }).executor
const click = (prompt = 'Masaüstündeki Blender 5.2') => ({ ...createNode('click', 0, 0), prompt })
beforeEach(() => { state.scan = scan; state.clicks = []; state.requests = []; state.logs = []; setLocalEndpoint(''); setStopCheck(() => false) })
afterEach(() => { vi.unstubAllGlobals(); setLocalEndpoint(''); setStopCheck(() => false) })

it('second model corrects Hunyuan to Blender and clicks only the real Blender box', async () => {
  respond(ids()[0].item.id, { id: ids()[1].item.id })
  await executor({ wordChoiceModel: 'second/model' }).click(click(), 1)
  expect(state.requests).toHaveLength(2)
  expect(state.requests.map(r => r.model)).toEqual(['first/model', 'second/model'])
  expect(state.requests[1].messages).toHaveLength(2)
  expect(state.requests[1].messages[0].content).toBe(WORD_CHOICE_PROMPT)
  expect(typeof state.requests[1].messages[1].content).toBe('string')
  expect(JSON.stringify(state.requests[1])).not.toContain('image_url')
  expect(state.requests[1].reasoning).toEqual({ enabled: false })
  expect(state.clicks).toEqual([[340, 90]])
  expect(state.logs.some(line => line.includes(`“Blender” (#${ids()[1].item.id})`))).toBe(true)
})
it('keeps the full instruction including negation; no longest-word override after the reply', async () => {
  const negative = { ...row, text: 'Delete Keep', words: [{ t: 'Delete', x: 100, y: 80, w: 100, h: 20 }, { t: 'Keep', x: 300, y: 80, w: 80, h: 20 }] }
  state.scan = { ...scan, items: [negative] }
  respond(ids()[0].item.id, { id: ids()[1].item.id })
  await executor().click(click('Delete değil Keep düğmesine tıkla'), 1)
  expect(state.requests[1].messages[1].content).toContain('Delete değil Keep düğmesine tıkla')
  expect(state.clicks).toEqual([[340, 90]])
})
it('one-word OCR skips the second call', async () => {
  state.scan = { ...scan, items: [{ ...row, text: 'Blender', words: [row.words![1]] }] }
  respond(ids()[0].item.id, { id: null })
  await executor().click(click(), 1)
  expect(state.requests).toHaveLength(1)
  expect(state.clicks).toEqual([[340, 90]])
})
it('UIA controls skip the second call', async () => {
  state.scan = { ...scan, items: [{ ...row, src: 'uia', type: 'Button', text: 'Blender', words: undefined }] }
  respond(7, { id: null })
  await executor().click(click(), 1)
  expect(state.requests).toHaveLength(1)
})
it('null second choice uses the existing visual stage instead of clicking the first word', async () => {
  respond(ids()[0].item.id, { id: null }, true)
  await executor({ findOrder: ['list', 'tars'], visionModel: 'vision/model', visionBackups: [] }).click(click(), 1)
  expect(state.clicks).toEqual([[900, 560]])
  expect(state.logs.some(line => line.includes('İkinci kelime seçimi belirsiz'))).toBe(true)
})
it('invalid ID cannot select another row or revive the first-word click', async () => {
  respond(ids()[0].item.id, { id: 999 }, true)
  await executor({ findOrder: ['list', 'tars'], visionModel: 'vision/model', visionBackups: [] }).click(click(), 1)
  expect(state.clicks).toEqual([[900, 560]])
})
it('custom prompt is saved and used; empty dedicated model follows the text chain', async () => {
  respond(ids()[0].item.id, { id: ids()[1].item.id })
  const prompts = normalizePrompts({ wordChoice: 'CUSTOM WORD PROMPT' })
  await executor({ llmPrompts: prompts }).click(click(), 1)
  expect(state.requests[1].model).toBe('first/model')
  expect(state.requests[1].messages[0].content).toBe('CUSTOM WORD PROMPT')
})
it('local second choice requests reasoning off even when general local thinking is high', async () => {
  setLocalEndpoint('http://127.0.0.1:11434/v1', 10000, false, false, 'high')
  respond(ids()[0].item.id, { id: ids()[1].item.id })
  await executor({ wordChoiceModel: 'local:quick' }).click(click(), 1)
  expect(state.requests[1].model).toBe('quick')
  expect(state.requests[1].reasoning_effort).toBe('none')
  expect(state.requests[1].reasoning).toBeUndefined()
})
it('service rejection can try the configured backup once without changing the words', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const request = JSON.parse(init.body); state.requests.push(request)
    return request.model === 'bad/model' ? { ok: false, status: 404, text: async () => 'model missing' }
      : { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ id: ids()[1].item.id }) } }] }) }
  }))
  const result = await chooseOcrWord({ apiKey: 'fake', model: ['bad/model', 'backup/model'], scan, parentId: row.id, prompt: 'Blender' })
  expect(result?.text).toBe('Blender')
  expect(state.requests.at(-1).model).toBe('backup/model')
  expect(state.requests[0].messages).toEqual(state.requests.at(-1).messages)
})
it('stop interrupts second selection before input is dispatched', async () => {
  setStopCheck(() => true)
  await expect(chooseOcrWord({ apiKey: 'fake', model: 'first/model', scan, parentId: row.id, prompt: 'Blender' })).rejects.toThrow()
  expect(state.clicks).toEqual([])
})
