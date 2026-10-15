import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ point: { x: 0, y: 0 }, moves: [] as any[], clicks: [] as any[], scans: [] as any[], requests: [] as any[], answers: [] as any[], stopped: false, stopOnRetry: false, drift: false, marker: true, locked: false, windowChanged: false }))
vi.mock('electron', () => ({ screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1000, height: 700 }, scaleFactor: 1 }) } }))
vi.mock('../electron/a11y-bridge', () => ({
  isLocked: async () => h.locked,
  scan: async (opts: any) => { h.scans.push(opts); return { area: { x: 0, y: 0, w: 1000, h: 700 }, image: { data: Buffer.from(opts.cursorMarker ? `AFTER_MOVE_${h.moves.length}` : 'INITIAL').toString('base64'), w: 1000, h: 700 }, cursor: opts.cursorMarker && h.marker ? { ...h.point } : null, items: [], window: 'Fixture', ocr: false, uiaCount: 0, ocrCount: 0 } },
  discardShot: () => {}, foreground: async () => ({ title: 'Fixture', pid: 10, hwnd: '42', proc: 'fixture' }),
  moveMouse: async (x: number, y: number) => { h.point = { x, y }; h.moves.push({ x, y }); return { hwnd: 42 } },
  cursorPos: async () => ({ ...h.point }),
  clickAt: async (...args: any[]) => { h.clicks.push({ direct: args }) },
  clickCurrentAt: async (...args: any[]) => { if (h.windowChanged) throw Error('INPUT_CLICK_STALE'); h.clicks.push({ current: args }) },
}))
vi.mock('../electron/browser', () => ({ userChromeItems: async () => null }))
vi.mock('../electron/shots', () => ({ rememberShot: () => {} }))
vi.mock('../electron/runner', async importOriginal => ({ ...await importOriginal<any>(), interruptibleSleep: async (ms: number) => { if (ms >= 3000 && h.stopOnRetry) h.stopped = true } }))
import { createAgent } from '../electron/agent'
import { createNode, DEFAULT_SETTINGS } from '../electron/graph-types'
import { setLocalEndpoint, setStopCheck } from '../electron/openrouter'
function executor(extra: Partial<typeof DEFAULT_SETTINGS> = {}) { return createAgent({ log: () => {}, send: () => {}, shouldStop: () => h.stopped, settings: () => ({ ...DEFAULT_SETTINGS, apiKey: 'fixture', model: 'vision', agentModel: 'vision', agentBackups: [], findOrder: ['tars'], findOff: [], screenCheck: 'off', stepDelayMs: 0, ...extra }) }).executor }
const node = (mode: 'left' | 'double' | 'right' | 'move' = 'left') => ({ ...createNode('click', 0, 0), prompt: 'Masaüstündeki Blender', clickMode: mode })
beforeEach(() => {
  Object.assign(h, { point: { x: 0, y: 0 }, moves: [], clicks: [], scans: [], requests: [], answers: [], stopped: false, stopOnRetry: false, drift: false, marker: true, locked: false, windowChanged: false })
  setLocalEndpoint(''); setStopCheck(() => h.stopped)
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); h.requests.push(body)
    const verification = JSON.stringify(body.messages).includes('"decision\\"') || JSON.stringify(body.messages).includes('confirm|adjust|uncertain')
    const reply = verification ? h.answers.shift() ?? { decision: 'confirm', reason: 'crosshair inside Blender' } : { name: 'computer_use', arguments: { action: 'mouse_move', coordinate: [300, 400] } }
    if (verification && h.drift) h.point = { x: 800, y: 600 }
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }) }
  }))
})
afterEach(() => { vi.unstubAllGlobals(); setLocalEndpoint(''); setStopCheck(() => false) })
it.each(['left', 'double', 'right'] as const)('moves, observes, confirms, then sends exactly one guarded %s action', async mode => {
  await executor().click(node(mode), 1)
  expect(h.moves).toEqual([{ x: 300, y: 280 }]); expect(h.requests).toHaveLength(2)
  expect(h.scans.find(s => s.cursorMarker)).toMatchObject({ fresh: true, cursorMarker: true, readOnly: true, uia: false, ocr: false })
  expect(h.clicks).toEqual([{ current: [300, 280, 42, undefined, mode] }])
  expect(JSON.stringify(h.requests[1])).toContain(Buffer.from('AFTER_MOVE_1').toString('base64'))
  expect(JSON.stringify(h.requests[1])).not.toContain(Buffer.from('INITIAL').toString('base64'))
})
it('adjusts without clicking and confirms from another new image', async () => {
  h.answers = [{ decision: 'adjust', x: 600, y: 500, reason: 'move right' }, { decision: 'confirm' }]
  await executor().click(node('double'), 1)
  expect(h.moves).toEqual([{ x: 300, y: 280 }, { x: 600, y: 350 }]); expect(h.clicks).toEqual([{ current: [600, 350, 42, undefined, 'double'] }])
})
it.each(['uncertain', 'drift', 'marker', 'windowChanged'])('does not click on %s', async scenario => {
  h.stopOnRetry = true
  if (scenario === 'uncertain') h.answers = [{ decision: 'uncertain', reason: 'covered' }]
  if (scenario === 'drift') h.drift = true
  if (scenario === 'marker') h.marker = false
  if (scenario === 'windowChanged') h.windowChanged = true
  await expect(executor().click(node(), 1)).rejects.toThrow()
  expect(h.clicks).toHaveLength(0)
})
it('move-only node sends no confirmation call and never clicks', async () => {
  await executor().click(node('move'), 1); expect(h.requests).toHaveLength(1); expect(h.moves).toHaveLength(1); expect(h.clicks).toHaveLength(0)
})

it('backup B that locates the target also handles each pointer adjustment; never returns to A or the Yap list', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); h.requests.push(body)
    const pointer = JSON.stringify(body.messages).includes('confirm|adjust|uncertain')
    const reply = body.model === 'A' ? { intent: 'target', x: 300, y: 400, strconv: 210 }
      : pointer ? (h.moves.length === 1 ? { decision: 'adjust', x: 600, y: 500 } : { decision: 'confirm' })
      : { name: 'computer_use', arguments: { action: 'mouse_move', coordinate: [300, 400] } }
    return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }) }
  }))
  const agent = executor({ visionModel: 'A', visionBackups: ['B', 'C'], agentModel: 'Yap-only', agentBackups: ['Other-Yap'] })
  await agent.click(node(), 1)
  expect(h.requests.map(r => r.model)).toEqual(['A', 'A', 'B', 'B', 'B'])
  expect(h.clicks).toHaveLength(1)
  expect(h.clicks[0].current.slice(0, 2)).toEqual([600, 350])
  // A different node starts from the user's current visual priority, not the previous backup.
  await agent.click(node(), 2)
  expect(h.requests.slice(5, 8).map(r => r.model)).toEqual(['A', 'A', 'B'])
})
it('if B fails pointer output twice, C continues all subsequent adjustments without returning to A or B', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); h.requests.push(body)
    const pointer = JSON.stringify(body.messages).includes('confirm|adjust|uncertain')
    const reply = body.model === 'A' ? { intent: 'target', x: 300, y: 400, strconv: 210 }
      : pointer && body.model === 'B' ? { decision: 'confirm', x: 900 }
      : pointer ? (h.moves.length === 1 ? { decision: 'adjust', x: 600, y: 500 } : { decision: 'confirm' })
      : { name: 'computer_use', arguments: { action: 'mouse_move', coordinate: [300, 400] } }
    return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }) }
  }))
  await executor({ visionModel: 'A', visionBackups: ['B', 'C'], agentModel: 'Yap-only' }).click(node(), 1)
  expect(h.requests.map(r => r.model)).toEqual(['A', 'A', 'B', 'B', 'B', 'C', 'C'])
  expect(h.moves).toHaveLength(2); expect(h.clicks).toHaveLength(1)
})
