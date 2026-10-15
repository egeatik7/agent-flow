import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ScreenItem } from '../electron/matcher'
const h = vi.hoisted(() => ({ items: [] as ScreenItem[], scans: [] as any[], point: { x: 0, y: 0 }, calls: [] as string[], logs: [] as string[], pointer: [] as any[], visual: [] as any[], failScan: 0, failChrome: false, failLocate: false, stopped: false, stopOnRetry: false, drift: false, failInputState: false, stopDuringPointer: false, nativeError: undefined as Error | undefined, listChoice: null as number | null, plan: null as any }))
vi.mock('electron', () => ({ screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1000, height: 700 }, scaleFactor: 1 }) } }))
vi.mock('../electron/a11y-bridge', () => ({
  isLocked: async () => false,
  scan: async (opts: any) => {
    h.scans.push(opts)
    if (!opts.cursorMarker && opts.image !== 'plain' && h.failScan-- > 0) throw new Error('reader unavailable')
    return { area: { x: 0, y: 0, w: 1000, h: 700 }, image: { data: 'fixture', w: 1000, h: 700 }, cursor: opts.cursorMarker ? { ...h.point } : null, items: opts.cursorMarker ? [] : h.items, window: 'Fixture', ocr: true, uiaCount: h.items.filter(i => i.src === 'uia').length, ocrCount: h.items.filter(i => i.src === 'ocr').length }
  },
  moveMouse: async (x: number, y: number) => { h.point = { x, y }; h.calls.push('move'); return { hwnd: 42 } },
  cursorPos: async () => ({ ...h.point }), discardShot: () => {},
  foreground: async () => ({ title: 'Fixture', pid: 10, hwnd: '42', proc: 'fixture' }),
  locate: async () => { h.calls.push('locate'); if (h.failLocate) throw Error('UIA unavailable'); return null },
  windowRect: async () => ({ x: 0, y: 0, w: 1000, h: 700 }),
  clickAt: async (x: number, y: number, mode: string) => { h.calls.push(`direct:${x},${y}:${mode ?? 'left'}`); if (h.nativeError) throw h.nativeError },
  clickCurrentAt: async (x: number, y: number, _hwnd: number, _target: unknown, mode: string) => { h.calls.push(`current:${x},${y}:${mode}`); if (h.nativeError) throw h.nativeError },
  inputState: async () => { if (h.failInputState) throw Error('focus observation failed'); return null },
  typeText: async () => { h.calls.push('write'); return { writeSent: true } },
  sendKeys: async () => { h.calls.push('keys') },
}))
vi.mock('../electron/browser', () => ({ userChromeItems: async () => { h.calls.push('chrome'); if (h.failChrome) throw Error('Chrome unavailable'); return null } }))
vi.mock('../electron/shots', () => ({ rememberShot: () => {} }))
vi.mock('../electron/runner', async original => ({ ...await original<any>(), interruptibleSleep: async (ms: number) => { if (ms >= 3000 && h.stopOnRetry) h.stopped = true } }))
vi.mock('../electron/openrouter', async original => ({
  ...await original<any>(), localConfigured: () => false,
  chooseVisualTarget: async () => { h.calls.push('visual'); const value = h.visual.shift(); if (value instanceof Error) throw value; return value ?? { name: 'computer_use', arguments: { action: 'mouse_move', coordinate: [300, 400] }, reason: 'target', model: 'vision' } },
  verifyVisualPointer: async () => { h.calls.push('pointer'); if (h.stopDuringPointer) h.stopped = true; const value = h.pointer.shift() ?? { decision: 'uncertain', reason: 'button state unclear' }; if (value instanceof Error) throw value; if (h.drift) h.point = { x: 900, y: 600 }; return value },
  chooseScreenTarget: async () => { h.calls.push('list'); return { id: h.listChoice, reason: 'fixture' } },
  planStall: async () => { h.calls.push('plan'); return h.plan },
}))
import { createAgent } from '../electron/agent'
import { createNode, DEFAULT_SETTINGS, type AppSettings, type AgentGraph } from '../electron/graph-types'
import { runGraph } from '../electron/runner'
import { FatalApiError, ModelOutputRejected } from '../electron/openrouter'
import { VisualPointerError } from '../electron/visual-hover'
const uia: ScreenItem = { id: 1, src: 'uia', type: 'Button', text: 'İzlemeyi başlat', x: 400, y: 100, w: 80, h: 20 }
const ocr: ScreenItem = { id: 2, src: 'ocr', type: 'Text', text: 'İzlemeyi başlat', x: 700, y: 200, w: 120, h: 20 }
const click = (mode: 'left' | 'double' | 'right' | 'move' = 'left') => ({ ...createNode('click', 0, 0), prompt: '“İzlemeyi başlat” düğmesine tıkla', clickMode: mode })
const make = (extra: Partial<AppSettings> = {}) => createAgent({ settings: () => ({ ...DEFAULT_SETTINGS, model: 'vision', visionModel: 'vision', apiKey: 'fixture', findOrder: ['tars', 'uia', 'windows', 'list'], findOff: [], screenCheck: 'off', ...extra }), shouldStop: () => h.stopped, log: (_level, line) => h.logs.push(line), send: () => {} })
beforeEach(() => Object.assign(h, { items: [], scans: [], point: { x: 0, y: 0 }, calls: [], logs: [], pointer: [], visual: [], failScan: 0, failChrome: false, failLocate: false, stopped: false, drift: false, failInputState: false, stopDuringPointer: false, nativeError: undefined, stopOnRetry: false, listChoice: null, plan: null }))
afterEach(() => vi.restoreAllMocks())

it.each(['left', 'double', 'right'] as const)('uncertain continues to UIA and sends exactly one %s input, without restarting visual', async mode => {
  h.items = [uia, ocr]
  await make().executor.click(click(mode), 1)
  expect(h.calls.filter(c => c === 'visual')).toHaveLength(1)
  expect(h.calls.filter(c => c === 'pointer')).toHaveLength(1)
  expect(h.calls.filter(c => c.startsWith('current:'))).toEqual([])
  expect(h.calls.filter(c => c.startsWith('direct:'))).toEqual([`direct:440,110:${mode}`])
  expect(h.scans.find(o => o.ocrEngine === 'combined')).toMatchObject({ fresh: true })
})
it('continues to OCR when UIA has no matching target', async () => {
  h.items = [ocr]
  await make().executor.click(click(), 1)
  expect(h.calls.filter(c => c.startsWith('direct:'))).toEqual(['direct:760,210:left'])
})
it('preserves priority: if the model list precedes direct OCR, it gets the fallback first', async () => {
  h.items = [ocr]; h.listChoice = 2
  await make({ findOrder: ['tars', 'list', 'windows'] }).executor.click(click(), 1)
  expect(h.calls.filter(c => c === 'list')).toEqual(['list'])
  expect(h.calls.filter(c => c === 'visual')).toEqual(['visual'])
})
it('disabled UIA and OCR stages stay disabled while a fresh cycle waits for Stop', async () => {
  h.stopOnRetry = true
  h.items = [uia, ocr]
  await expect(make({ findOff: ['uia', 'windows', 'list'] }).executor.click(click(), 1)).rejects.toThrow('Kullanıcı tarafından durduruldu')
  expect(h.calls.filter(c => c.startsWith('direct:'))).toHaveLength(0)
  expect(h.calls.filter(c => c === 'visual')).toHaveLength(1)
})
it('bounded adjustment rejection also continues to the next method', async () => {
  h.items = [uia]; h.pointer = Array.from({ length: 3 }, () => ({ decision: 'adjust', x: .5, y: .5, reason: 'adjust' }))
  await make().executor.click(click(), 1)
  expect(h.calls.filter(c => c === 'pointer')).toHaveLength(3)
  expect(h.calls.filter(c => c.startsWith('direct:'))).toEqual(['direct:440,110:left'])
})
it('invalid pointer model output allows an independent later method', async () => {
  h.items = [uia]; h.pointer = [new ModelOutputRejected('bad pointer output')]
  await make().executor.click(click(), 1)
  expect(h.calls.filter(c => c.startsWith('direct:'))).toHaveLength(1)
})
it('visual missing and invalid visual output both continue without pointer input', async () => {
  for (const answer of [{ name: 'computer_use', arguments: { action: 'terminate', status: 'failure' }, reason: 'missing' }, new ModelOutputRejected('bad target output')]) {
    h.calls = []; h.items = [uia]; h.visual = [answer]
    await make().executor.click(click(), 1)
    expect(h.calls).not.toContain('pointer')
    expect(h.calls.filter(c => c.startsWith('direct:'))).toHaveLength(1)
  }
})
it('ordinary Chrome and saved UIA read errors do not prevent the later OCR method', async () => {
  h.failChrome = true; h.failLocate = true; h.items = [ocr]
  const n = { ...click(), locator: { name: 'İzlemeyi başlat', controlType: 'Button', windowTitle: 'Fixture', path: '0/1' } }
  await make({ findOrder: ['chrome', 'uia', 'windows'] }).executor.click(n, 1)
  expect(h.calls.slice(0, 2)).toEqual(['chrome', 'locate'])
  expect(h.calls.filter(c => c.startsWith('direct:'))).toEqual(['direct:760,210:left'])
})
it('a shared reader failing once at UIA can be retried by the next OCR stage', async () => {
  h.failScan = 1; h.items = [ocr]
  await make({ findOrder: ['uia', 'windows'] }).executor.click(click(), 1)
  expect(h.scans).toHaveLength(2)
  expect(h.calls.filter(c => c.startsWith('direct:'))).toHaveLength(1)
})
it('Type visual targets use the same pointer gate, then write only after successful fallback', async () => {
  h.items = [{ ...uia, type: 'Edit' }]
  const n = { ...createNode('type', 0, 0), prompt: '“İzlemeyi başlat”', text: 'hello' }
  await make().executor.type(n, 1)
  expect(h.calls.filter(c => c.startsWith('direct:'))).toHaveLength(1)
  expect(h.calls.indexOf('write')).toBeGreaterThan(h.calls.findIndex(c => c.startsWith('direct:')))
})
it('Type keeps retrying without text when every allowed method fails', async () => {
  h.stopOnRetry = true
  const n = { ...createNode('type', 0, 0), prompt: '“İzlemeyi başlat”', text: 'hello' }
  await expect(make().executor.type(n, 1)).rejects.toThrow('Kullanıcı tarafından durduruldu')
  expect(h.calls).not.toContain('write')
})
it('a native click error cannot be caught as a safe unsent visual rejection', async () => {
  h.items = [uia]; h.pointer = [{ decision: 'confirm' }]; h.nativeError = new VisualPointerError('native may have dispatched', true)
  await expect(make().executor.click(click(), 1)).rejects.toThrow('native may have dispatched')
  expect(h.calls.filter(c => c.startsWith('current:'))).toHaveLength(1)
  expect(h.calls.filter(c => c.startsWith('direct:'))).toHaveLength(0)
})
it('cursor drift and model API failures proceed to a later independent method without using the rejected visual point', async () => {
  h.items=[uia];h.drift=true;h.pointer=[{decision:'confirm'}]
  await make().executor.click(click(),1)
  expect(h.calls.filter(c=>c.startsWith('current:'))).toHaveLength(0)
  h.calls=[];h.drift=false;h.pointer=[new FatalApiError('OpenRouter bakiye hatası')]
  await make().executor.click(click(),2)
  expect(h.calls.filter(c=>c.startsWith('direct:'))).toHaveLength(1)
})
it('move-only and read-only preview keep their existing no-click behavior', async () => {
  await make().executor.click(click('move'), 1)
  expect(h.calls).not.toContain('pointer')
  expect(h.calls.filter(c => c.startsWith('direct:') || c.startsWith('current:'))).toHaveLength(0)
  h.calls = []
  await make().previewTarget(click())
  expect(h.calls).toEqual(['visual'])
})
it('method exhaustion starts a fresh pass on the same item, rather than skipping the item', async () => {
  h.stopOnRetry = true
  const start = createNode('start',0,0),loop=createNode('loop',0,0),n=click()
  loop.items=['02','03'];loop.members=[n.id]
  await expect(runGraph({nodes:[start,loop,n],edges:[{id:'a',from:start.id,fromPort:'next',to:loop.id}]},make().executor,{maxSteps:100,stepDelayMs:0})).rejects.toThrow('Kullanıcı tarafından durduruldu')
  expect(loop.startIndex).toBe(0);expect(h.logs.some(l=>l.includes('2/2: 03'))).toBe(false)
})
it('legacy stall lookFor does not replace the original command or its constraints', async () => {
  h.stopOnRetry = true
  h.plan = { action: 'continue', waitMs: 0, lookFor: 'Other target', reason: 'try other' }
  h.items = [{ ...ocr, text: 'Other target' }]
  await expect(make({ findOrder: ['windows'] }).executor.click(click(), 1)).rejects.toThrow('Kullanıcı tarafından durduruldu')
  expect(h.calls.filter(c => c.startsWith('direct:'))).toHaveLength(0)
})

it('Stop received during pointer checking prevents fallback and all button input', async () => {
  h.items = [uia]; h.stopDuringPointer = true
  await expect(make().executor.click(click(), 1)).rejects.toThrow()
  expect(h.calls.filter(c => c.startsWith('direct:') || c.startsWith('current:'))).toHaveLength(0)
})
it('post-click observation errors retain the dispatched-input flag for Recovery', async () => {
  h.items = [uia]; h.failInputState = true
  await expect(make({ findOrder: ['uia'], screenCheck: 'log' }).executor.click(click(), 1, { next: createNode('type', 0, 0) })).rejects.toMatchObject({ inputMayHaveBeenSent: true, haltLoop: true })
  expect(h.calls.filter(c => c.startsWith('direct:'))).toHaveLength(1)
})
