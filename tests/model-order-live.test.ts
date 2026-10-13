import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ScanResult, ScreenItem } from '../electron/matcher'

const state = vi.hoisted(() => ({ requests: [] as string[], bodies: [] as any[] }))
vi.mock('electron', () => ({ screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1000, height: 700 }, scaleFactor: 1 }) } }))
vi.mock('../electron/a11y-bridge', () => ({
  isLocked: async () => false,
  scan: async () => stateScan,
  discardShot: () => {},
  locate: async () => null,
  findImage: async () => null,
  clickAt: async () => {},
  moveMouse: async () => ({ hwnd: 1 }),
  sendKeys: async () => {},
  clickCurrentAt: async () => {},
  cursorPos: async () => ({ x: 0, y: 0 }),
  inputTarget: async () => ({ hwnd: '1', pid: 10, title: 'Fixture', rect: { x: 0, y: 0, w: 1000, h: 700 } }),
  assertInputTarget: async () => {},
  focusedValue: async () => null,
  inputState: async () => ({ type: 'Edit', window: 'Fixture' }),
  foreground: async () => ({ title: 'Fixture', pid: 10, hwnd: '1', proc: 'fixture' }),
  windowRect: async () => ({ x: 0, y: 0, w: 1000, h: 700 }),
}))
vi.mock('../electron/browser', () => ({ userChromeItems: async () => null }))
vi.mock('../electron/shots', () => ({ rememberShot: () => {} }))

import { createAgent } from '../electron/agent'
import { createNode, DEFAULT_SETTINGS, type AppSettings } from '../electron/graph-types'
import { chooseOcrWord, FatalApiError, listedTextAgrees, parseListedId, setLocalEndpoint, setStopCheck } from '../electron/openrouter'
import { wordCandidates } from '../electron/word-targets'

const row: ScreenItem = { id: 7, text: 'Blender', src: 'ocr', type: 'Text', x: 10, y: 10, w: 80, h: 20, words: [{ t: 'Blender', x: 10, y: 10, w: 80, h: 20 }] }
const stateScan: ScanResult = { area: { x: 0, y: 0, w: 1000, h: 700 }, items: [row], image: null, ocr: true, uiaCount: 0, ocrCount: 1, window: 'Fixture' }
const wordId = () => wordCandidates(stateScan).find(c => c.wordIndex !== undefined)!.item.id
const ok = (id: number) => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ id, text: 'Blender', reason: 'ok' }) } }] }) })

const settings: AppSettings = { ...DEFAULT_SETTINGS, apiKey: 'fake', model: 'A', modelBackups: ['B', 'C'], findOrder: ['list'], findOff: [], sendScreenshot: false, stepDelayMs: 0, screenCheck: 'off', modelRevision: 1, agentModel: '', visionModel: '' }
const click = () => ({ ...createNode('click', 0, 0), prompt: 'Blender' })

beforeEach(() => {
  state.requests = []
  state.bodies = []
  settings.model = 'A'
  settings.modelBackups = ['B', 'C']
  settings.modelRevision = 1
  setLocalEndpoint('')
  setStopCheck(() => false)
})
afterEach(() => { vi.unstubAllGlobals(); setLocalEndpoint(''); setStopCheck(() => false) })

it('kayıt A ile başlar; akış sürerken B kaydı sonraki çağrıyı B yapar ve yedekleri sırayla dener', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body)
    state.requests.push(body.model)
    state.bodies.push(body)
    if (state.requests.length === 1) {
      settings.model = 'B'
      settings.modelBackups = ['C', 'A']
      settings.modelRevision = 2
      return ok(wordId())
    }
    if (body.model === 'B') return { ok: false, status: 500, text: async () => 'down' }
    return ok(wordId())
  }))
  const run = createAgent({ log: () => {}, send: () => {}, shouldStop: () => false, settings: () => settings }).executor
  await run.click(click(), 1)
  expect(state.requests).toEqual(['A'])
  await run.click(click(), 2)
  expect(state.requests).toEqual(['A', 'B', 'C'])
})

it('zorunlu reasoning hatasında yalnız o alan kalkar ve aynı istek üçüncü kez gitmez', async () => {
  const parent: ScreenItem = { id: 1, text: 'Blender 5.2', src: 'ocr', type: 'Text', x: 0, y: 0, w: 80, h: 20, words: [{ t: 'Blender', x: 0, y: 0, w: 40, h: 20 }, { t: '5.2', x: 40, y: 0, w: 20, h: 20 }] }
  const scan: ScanResult = { ...stateScan, items: [parent] }
  const id = wordCandidates(scan).find(c => c.item.text === '5.2')!.item.id
  const bodies: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body)
    bodies.push(body)
    if (bodies.length === 1) return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'Reasoning is mandatory for this endpoint and cannot be disabled.', code: 400 } }) }
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ id }) } }] }) }
  }))
  const picked = await chooseOcrWord({ apiKey: 'k', model: 'z-ai/glm-5.3-flash', scan, parentId: 1, prompt: 'Blender 5.2' })
  expect(picked?.text).toBe('5.2')
  expect(bodies).toHaveLength(2)
  expect(bodies[0].reasoning).toEqual({ enabled: false })
  expect(bodies[1].reasoning).toBeUndefined()
  expect(bodies[1].model).toBe('z-ai/glm-5.3-flash')
})

it('#219 bu isteğin adayına çözülür; listede olmayan ve bozuk metin çözülmez', async () => {
  const parent: ScreenItem = { id: 1, text: 'Blender 5.2', src: 'ocr', type: 'Text', x: 0, y: 0, w: 80, h: 20, words: [{ t: 'Blender', x: 0, y: 0, w: 40, h: 20 }, { t: '5.2', x: 40, y: 0, w: 20, h: 20 }] }
  const scan: ScanResult = { ...stateScan, items: [parent] }
  const id = wordCandidates(scan).find(c => c.item.text === '5.2')!.item.id
  expect(parseListedId(`#${id}`)).toBe(id)
  expect(parseListedId(String(id))).toBe(id)
  expect(parseListedId('#219 extra')).toBeUndefined()
  expect(parseListedId('219,500')).toBeUndefined()
  expect(parseListedId('id 219')).toBeUndefined()
  expect(listedTextAgrees('Blender', 'gpt')).toBe(false)
  expect(listedTextAgrees('Blender', 'Blender')).toBe(true)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ id: `#${id}` }) } }] }) })))
  const picked = await chooseOcrWord({ apiKey: 'k', model: 'gui-owl', scan, parentId: 1, prompt: 'Blender 5.2' })
  expect(picked?.text).toBe('5.2')
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ id: '#99999' }) } }] }) })))
  await expect(chooseOcrWord({ apiKey: 'k', model: 'gui-owl', scan, parentId: 1, prompt: 'Blender 5.2' })).rejects.toThrow(/WORD_CHOICE_INVALID/)
})

it('bakiye hatası aynı isteği yeniden göndermez ve reasoning hatasıyla karışmaz', async () => {
  const parent: ScreenItem = { id: 1, text: 'Blender 5.2', src: 'ocr', type: 'Text', x: 0, y: 0, w: 80, h: 20, words: [{ t: 'Blender', x: 0, y: 0, w: 40, h: 20 }, { t: '5.2', x: 40, y: 0, w: 20, h: 20 }] }
  const scan: ScanResult = { ...stateScan, items: [parent] }
  let calls = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    calls += 1
    return { ok: false, status: 402, text: async () => JSON.stringify({ error: { message: 'Insufficient credits. This request requires more credits.', code: 402 } }) }
  }))
  await expect(chooseOcrWord({ apiKey: 'k', model: ['A', 'B'], scan, parentId: 1, prompt: 'Blender' })).rejects.toBeInstanceOf(FatalApiError)
  expect(calls).toBe(1)
})
