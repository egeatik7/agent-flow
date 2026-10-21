import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScreenItem } from '../electron/matcher'

const state = vi.hoisted(() => ({
  stopped: false, scans: [] as { uia?: boolean; ocr?: boolean }[], inputs: [] as string[],
  requests: [] as { model: string; source: 'uia' | 'ocr'; body: string }[], logs: [] as string[],
  uia: [] as ScreenItem[], ocr: [] as ScreenItem[],
}))
vi.mock('electron', () => ({ screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }) } }))
vi.mock('../electron/a11y-bridge', () => ({
  isLocked: async () => false, discardShot: () => {},
  scan: async (opts: { uia?: boolean; ocr?: boolean }) => {
    state.scans.push(opts)
    return { area: { x: 0, y: 0, w: 1920, h: 1080 }, window: 'Hunyuan - Google Chrome',
      image: null, items: opts.uia ? state.uia : state.ocr, ocr: !!opts.ocr,
      uiaCount: opts.uia ? state.uia.length : 0, ocrCount: opts.ocr ? state.ocr.length : 0 }
  },
  clickAt: async () => state.inputs.push('click'), moveMouse: async () => state.inputs.push('move'),
  sendKeys: async () => state.inputs.push('keys'), typeText: async () => state.inputs.push('type'),
}))
vi.mock('../electron/browser', () => ({ userChromeItems: async () => null }))
vi.mock('../electron/shots', () => ({ rememberShot: () => {} }))
import { createAgent } from '../electron/agent'
import { createNode, DEFAULT_SETTINGS } from '../electron/graph-types'
import { setStopCheck, validateConditionReply } from '../electron/openrouter'
import { ConditionHaltError, ConditionUndecidedError, runGraph, StoppedError } from '../electron/runner'
import { ObservationTimeoutError } from '../electron/observation-budget'

const row = (id: number, src: 'uia' | 'ocr', text = '0'): ScreenItem =>
  ({ id, src, text, type: 'Text', x: 1793, y: 134, w: 25, h: 19 })
const unknown = { satisfied: false, id: null, basis: 'unknown', reason: 'The counter cannot be read.' }
const observed = (source: 'uia' | 'ocr', satisfied = false, text = '0') =>
  ({ satisfied, id: source === 'uia' ? 27 : 91, basis: 'observed', text, reason: satisfied ? 'The observed value meets the condition.' : 'The observed value does not meet the condition.' })
function agent(backups = ['backup/model']) {
  return createAgent({ log: (_level, text) => state.logs.push(text), send: () => {}, shouldStop: () => state.stopped,
    settings: () => ({ ...DEFAULT_SETTINGS, apiKey: 'fixture', model: 'primary/model', modelBackups: [],
      conditionModel: 'primary/model', conditionBackups: backups }) }).executor
}
function respond(fn: (request: typeof state.requests[number]) => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(String(init.body))
    const request = { model: body.model as string, source: /Source: current UI Automation/.test(body.messages[0].content) ? 'uia' as const : 'ocr' as const, body: String(init.body) }
    state.requests.push(request)
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(fn(request)) } }] }) }
  }))
}
const condition = () => ({ ...createNode('condition', 0, 0), text: 'Is the current top-right available credit exactly 20?' })
beforeEach(() => {
  state.stopped = false; state.scans = []; state.inputs = []; state.requests = []; state.logs = []
  state.uia = [row(27, 'uia')]; state.ocr = [row(91, 'ocr')]
  setStopCheck(() => false)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setStopCheck(() => false); expect(state.inputs).toEqual([]) })

describe('Condition: bounded independent confidence review', () => {
  const scored = (source: 'uia' | 'ocr', satisfied: boolean, confidence: unknown) => ({ ...observed(source, satisfied), confidence })
  it.each([true, false])('accepts a strong %s answer without a mandatory second voter', async satisfied => {
    respond(() => scored('uia', satisfied, 0.85))
    expect(await agent().exists('', condition())).toBe(satisfied)
    expect(state.requests).toHaveLength(1); expect(state.scans).toHaveLength(1)
  })
  it.each([0.75, 1, 75, 100])('accepts the strong boundary/compatible numeric score %s', async confidence => {
    respond(() => scored('uia', false, confidence))
    expect(await agent().exists('', condition())).toBe(false)
    expect(state.requests).toHaveLength(1)
  })
  it.each([true, false])('uses an independent strong backup to confirm a moderate %s answer', async satisfied => {
    respond(request => scored('uia', satisfied, request.model === 'primary/model' ? 0.6 : 0.8))
    expect(await agent().exists('', condition())).toBe(satisfied)
    expect(state.requests.map(r => r.model)).toEqual(['primary/model', 'backup/model'])
    const [primary, backup] = state.requests.map(r => JSON.parse(r.body))
    expect(primary.messages).toEqual(backup.messages)
    expect(backup.messages).toHaveLength(2)
    expect(backup.messages.every((m: { role: string }) => m.role !== 'assistant')).toBe(true)
    expect(backup.messages[1].content).toContain('confidence rates your chosen answer')
    expect(state.scans).toHaveLength(1)
  })
  it.each([0.5, 0.749999, 50, 74.9])('consults the backup at moderate score %s without a same-model repair', async confidence => {
    respond(request => scored('uia', false, request.model === 'primary/model' ? confidence : 0.75))
    expect(await agent().exists('', condition())).toBe(false)
    expect(state.requests.map(r => r.model)).toEqual(['primary/model', 'backup/model'])
  })
  it('advances a below-50 answer directly to OCR, which can decide independently', async () => {
    respond(request => scored(request.source, request.source === 'ocr', request.source === 'uia' ? 0.49 : 0.9))
    expect(await agent().exists('', condition())).toBe(true)
    expect(state.requests.map(r => [r.source, r.model])).toEqual([['uia', 'primary/model'], ['ocr', 'primary/model']])
  })
  it('advances to OCR when no backup is configured, without rerunning the leaning model', async () => {
    respond(request => scored(request.source, false, request.source === 'uia' ? 0.6 : 0.9))
    expect(await agent([]).exists('', condition())).toBe(false)
    expect(state.requests.map(r => r.source)).toEqual(['uia', 'ocr'])
  })
  it.each(['low', 'opposite', 'missing', 'unknown'] as const)('an inconclusive backup (%s) advances readers, never searches for a third juror', async kind => {
    respond(request => {
      if (request.source === 'ocr') return scored('ocr', true, 0.9)
      if (request.model === 'primary/model') return scored('uia', false, 0.6)
      if (kind === 'unknown') return unknown
      if (kind === 'missing') return observed('uia', false)
      return scored('uia', kind === 'opposite', kind === 'low' ? 0.74 : 0.95)
    })
    expect(await agent(['backup/model', 'third/model']).exists('', condition())).toBe(true)
    expect(state.requests.map(r => [r.source, r.model])).toEqual([
      ['uia', 'primary/model'], ['uia', 'backup/model'], ['ocr', 'primary/model'],
    ])
  })
  it('keeps technical fallback when the first backup is unavailable; only valid opinions count', async () => {
    const models: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const model = JSON.parse(String(init.body)).model; models.push(model)
      if (model === 'backup/model') return { ok: false, status: 503, text: async () => 'temporary outage' }
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(scored('uia', false, model === 'primary/model' ? 0.6 : 0.8)) } }] }) }
    }))
    expect(await agent(['backup/model', 'third/model']).exists('', condition())).toBe(false)
    expect(models).toEqual(['primary/model', 'backup/model', 'third/model'])
    expect(state.scans).toHaveLength(1)
  })
  it('a failed primary does not count as an opinion before two working backups', async () => {
    const models: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const model = JSON.parse(String(init.body)).model; models.push(model)
      if (model === 'primary/model') return { ok: false, status: 503, text: async () => 'temporary outage' }
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(scored('uia', false, model === 'backup/model' ? 0.6 : 0.8)) } }] }) }
    }))
    expect(await agent(['backup/model', 'third/model']).exists('', condition())).toBe(false)
    expect(models).toEqual(['primary/model', 'backup/model', 'third/model'])
  })
  it('does not multiply confidence votes by four fresh rounds when both readers are weak', async () => {
    respond(request => scored(request.source, false, 0.4))
    await expect(agent().exists('', condition())).rejects.toBeInstanceOf(ConditionUndecidedError)
    expect(state.scans).toHaveLength(2); expect(state.requests).toHaveLength(2)
    expect(state.logs.some(s => s.includes('YONTEM-TUR'))).toBe(false)
  })
  it('caps semantic review at two opinions per reader when every model remains skeptical', async () => {
    respond(request => scored(request.source, false, 0.6))
    await expect(agent(['backup/model', 'third/model']).exists('', condition())).rejects.toBeInstanceOf(ConditionUndecidedError)
    expect(state.scans).toHaveLength(2); expect(state.requests).toHaveLength(4)
    expect(state.requests.some(r => r.model === 'third/model')).toBe(false)
  })
  it('hands weak decisions off after one reader pass even when the backup fails technically', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init.body))
      const request = { model: body.model, source: /Source: current UI Automation/.test(body.messages[0].content) ? 'uia' as const : 'ocr' as const, body: String(init.body) }
      state.requests.push(request)
      if (body.model === 'backup/model') throw Error('network unavailable')
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(scored(request.source, false, 0.6)) } }] }) }
    }))
    await expect(agent().exists('', condition())).rejects.toBeInstanceOf(ConditionUndecidedError)
    expect(state.scans).toHaveLength(2); expect(state.requests).toHaveLength(4)
  })
  it.each([null, '0.9', -1, 101])('repairs malformed confidence %s once, then uses the corrected evidence', async confidence => {
    respond(() => scored('uia', false, state.requests.length === 1 ? confidence : 0.9))
    expect(await agent().exists('', condition())).toBe(false)
    expect(state.requests.map(r => r.model)).toEqual(['primary/model', 'primary/model'])
  })
  it('strong confidence cannot validate contradictory evidence text', async () => {
    respond(() => ({ ...scored('uia', false, 1), text: state.requests.length === 1 ? '20' : '0' }))
    expect(await agent().exists('', condition())).toBe(false)
    expect(state.requests).toHaveLength(2)
  })
  it.each([true, false])('confidence review also applies to justified absence with satisfied=%s', async satisfied => {
    respond(request => ({ satisfied, id: null, basis: 'absence', reason: 'The relevant surface is covered and the requested state is absent.',
      confidence: request.model === 'primary/model' ? 0.6 : 0.9 }))
    expect(await agent().exists('', condition())).toBe(satisfied)
    expect(state.requests.map(r => r.model)).toEqual(['primary/model', 'backup/model'])
  })
  it('honors Stop after the backup response without accepting its verdict or asking OCR', async () => {
    respond(request => { if (request.model === 'backup/model') state.stopped = true; return scored('uia', false, request.model === 'primary/model' ? 0.6 : 0.9) })
    await expect(agent().exists('', condition())).rejects.toBeInstanceOf(StoppedError)
    expect(state.scans).toHaveLength(1); expect(state.requests).toHaveLength(2)
  })
  it('preserves observation cancellation during a second opinion', async () => {
    const controller = new AbortController()
    respond(request => { if (request.model === 'backup/model') controller.abort(new ObservationTimeoutError()); return scored('uia', false, request.model === 'primary/model' ? 0.6 : 0.9) })
    await expect(agent().exists('', condition(), { signal: controller.signal })).rejects.toBeInstanceOf(ObservationTimeoutError)
    expect(state.scans).toHaveLength(1); expect(state.requests).toHaveLength(2)
  })
  it.each(['var', 'yok'] as const)('actually reaches runner Recovery once, then follows its %s branch', async decision => {
    respond(request => scored(request.source, false, 0.6))
    const cond = condition(), yes = createNode('key', 0, 0), no = createNode('key', 0, 0)
    const ex = agent(); const recovered: unknown[] = [], visited: string[] = []
    ex.recover = async request => { recovered.push(request); return decision }
    ex.key = async node => { visited.push(node.id) }
    await runGraph({ nodes: [cond, yes, no], edges: [
      { id: 'yes-edge', from: cond.id, fromPort: 'true', to: yes.id },
      { id: 'no-edge', from: cond.id, fromPort: 'false', to: no.id },
    ] }, ex, { maxSteps: 10, stepDelayMs: 0 })
    expect(recovered).toHaveLength(1)
    expect(visited).toEqual([decision === 'var' ? yes.id : no.id])
    expect(state.requests).toHaveLength(4)
  })
  it('reports the existing Recovery-disabled handoff instead of guessing either branch', async () => {
    respond(request => scored(request.source, false, 0.4))
    await expect(runGraph({ nodes: [condition()], edges: [] }, agent(), { maxSteps: 10, stepDelayMs: 0 })).rejects.toBeInstanceOf(ConditionHaltError)
    expect(state.requests).toHaveLength(2)
  })
})

describe('Condition: evidence-backed decisions finish the method pass', () => {
  it('routes credit 0 to false after one UIA/model call; OCR cannot overrule it with unknown', async () => {
    vi.useFakeTimers()
    respond(request => request.source === 'uia' ? observed('uia') : unknown)
    const pending = agent().exists('', condition()).then(value => ({ value }), error => ({ error }))
    await vi.runAllTimersAsync()
    expect(await pending).toEqual({ value: false })
    expect(state.scans).toHaveLength(1)
    expect(state.requests.map(r => [r.source, r.model])).toEqual([['uia', 'primary/model']])
    expect(state.logs.some(s => s.includes('koşul sağlanmıyor'))).toBe(true)
  })
  it('accepts a valid OCR negative even when UIA was unknown', async () => {
    respond(request => request.source === 'uia' ? unknown : observed('ocr'))
    expect(await agent().exists('', condition())).toBe(false)
    expect(state.requests.map(r => [r.source, r.model])).toEqual([['uia', 'primary/model'], ['ocr', 'primary/model']])
  })
  it('advances unknown UIA directly to OCR without an identical retry or a model backup', async () => {
    state.ocr = [row(91, 'ocr', '20')]
    respond(request => request.source === 'uia' ? unknown : observed('ocr', true, '20'))
    expect(await agent().exists('', condition())).toBe(true)
    expect(state.requests.map(r => [r.source, r.model])).toEqual([['uia', 'primary/model'], ['ocr', 'primary/model']])
    expect(state.logs.some(s => s.includes('CIKTI-TEKRAR'))).toBe(false)
  })
  it('a positive remains an immediate one-reader decision', async () => {
    state.uia = [row(27, 'uia', '20')]; respond(() => observed('uia', true, '20'))
    expect(await agent().exists('', condition())).toBe(true)
    expect(state.scans).toHaveLength(1); expect(state.requests).toHaveLength(1)
  })
  it.each([true, false])('a justified absence decision can finish with satisfied=%s and no ID', async satisfied => {
    respond(() => ({ satisfied, id: null, basis: 'absence', reason: 'The requested surface was observed; the specified state is absent.' }))
    expect(await agent().exists('', { ...condition(), text: satisfied ? 'Is the error absent?' : 'Is an error present?' })).toBe(satisfied)
    expect(state.scans).toHaveLength(1); expect(state.requests).toHaveLength(1)
  })
  it('legacy false with a valid evidence ID remains supported and immediate', async () => {
    respond(() => ({ satisfied: false, id: 27, text: '0' }))
    expect(await agent().exists('', condition())).toBe(false)
    expect(state.requests).toHaveLength(1)
  })
  it('missing negative evidence is unknown, not a guessed false', async () => {
    state.ocr = [row(91, 'ocr', '20')]
    respond(request => request.source === 'uia' ? { satisfied: false, id: null } : observed('ocr', true, '20'))
    expect(await agent().exists('', condition())).toBe(true)
    expect(state.requests).toHaveLength(2)
    expect(() => validateConditionReply('{"satisfied":false,"id":null}')).toThrow('UNDECIDED')
  })
  it('all-unknown observations remain undecided after the existing four fresh rounds', async () => {
    vi.useFakeTimers(); respond(() => unknown)
    const result = expect(agent().exists('', condition())).rejects.toBeInstanceOf(ConditionUndecidedError)
    await vi.runAllTimersAsync(); await result
    expect(state.scans).toHaveLength(8); expect(state.requests).toHaveLength(8)
    expect(state.requests.every(r => r.model === 'primary/model')).toBe(true)
  })
  it('a technical error still tries the configured backup on the same observation', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const model = JSON.parse(String(init.body)).model; requests.push(model)
      return model === 'primary/model' ? { ok: false, status: 503, text: async () => 'temporary outage' }
        : { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(observed('uia')) } }] }) }
    }))
    expect(await agent().exists('', condition())).toBe(false)
    expect(requests).toEqual(['primary/model', 'backup/model']); expect(state.scans).toHaveLength(1)
  })
  it.each([['0', '20'], ['2', '20'], ['6', '60']])('a numeric ID/text contradiction (%s vs %s) is rejected before a corrected answer is used', async (actual, claimed) => {
    state.uia = [row(27, 'uia', actual)]
    respond(() => observed('uia', false, state.requests.length === 1 ? claimed : actual))
    expect(await agent().exists('', condition())).toBe(false)
    expect(state.requests).toHaveLength(2); expect(state.scans).toHaveLength(1)
  })
  it('an invented negative evidence ID cannot finish the method pass', async () => {
    state.ocr = [row(91, 'ocr', '20')]
    respond(request => request.source === 'uia' ? { ...observed('uia'), id: 999 } : observed('ocr', true, '20'))
    expect(await agent([]).exists('', condition())).toBe(true)
    expect(state.requests.map(r => r.source)).toEqual(['uia', 'uia', 'ocr'])
  })
  it('user Stop after a model response prevents either branch from completing', async () => {
    respond(() => { state.stopped = true; return observed('uia') })
    await expect(agent().exists('', condition())).rejects.toBeInstanceOf(StoppedError)
    expect(state.scans).toHaveLength(1); expect(state.requests).toHaveLength(1)
  })
})
