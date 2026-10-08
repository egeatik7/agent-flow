import { afterEach, describe, expect, it, vi } from 'vitest'
import { chooseVisualTarget, validateVisualTargetReply, guiStep, ModelRejected, setStopCheck } from '../electron/openrouter'

const image = { data: 'NEW_SCREEN', w: 1288, h: 728 }
const native = 'bytedance/ui-tars-1.5-7b'
const reply = (intent: string, action = "click(start_box='(808,292)')") => `Thought: One control.\nIntent: ${intent}\nAction: ${action}`
afterEach(() => { vi.unstubAllGlobals(); setStopCheck(() => false) })

function capture(answer: (model: string) => string) {
  const requests: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const request = JSON.parse(init.body); requests.push(request)
    return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: answer(request.model) }, finish_reason: 'stop' }] }) }
  }))
  return requests
}

describe('visual target reply contract', () => {
  it('distinguishes a popup point from a target with native screenshot pixel scaling', () => {
    const result = validateVisualTargetReply(reply('dismiss'), native, image, true)
    expect(result.intent).toBe('dismiss'); expect(result.x).toBeCloseTo(808 / 1288); expect(result.y).toBeCloseTo(292 / 728)
    expect(validateVisualTargetReply(reply('target'), native, image, false).intent).toBe('target')
  })
  it('keeps the older TARS 0-1000 coordinate system separate from native pixels', () => {
    expect(validateVisualTargetReply(reply('target', "click(start_box='(500,250)')"), 'ui-tars-old', image, false)).toMatchObject({ x: .5, y: .25 })
  })
  it('JSON always uses its declared 0-1000 grid, including a coordinate of 1', () => {
    expect(validateVisualTargetReply('{"intent":"target","x":1,"y":500}', 'vision', image, false)).toMatchObject({ x: .001, y: .5 })
  })
  it('rejects a bare click and does not guess intent from the thought', () => {
    expect(() => validateVisualTargetReply("Thought: Close popup first.\nAction: click(start_box='(808,292)')", native, image, true)).toThrow(ModelRejected)
    expect(() => validateVisualTargetReply('{"action":"click","x":500,"y":500}', 'vision', image, true)).toThrow(ModelRejected)
  })
  it.each(['move', 'left_double', 'right_single', 'hotkey', 'type', 'finished', 'click_current'])('does not execute %s from a target-finding response', action => {
    expect(() => validateVisualTargetReply(reply('target', `${action}()`), native, image, true)).toThrow(ModelRejected)
  })
  it('rejects contradictory intent/action pairs, duplicate fields and concatenated actions', () => {
    for (const text of [reply('missing'), reply('target', 'call_user()'), reply('target') + '\nIntent: dismiss', reply('target') + '\nAction: call_user()', reply('target', "click(start_box='(5,5)') hotkey(key='enter')")]) {
      expect(() => validateVisualTargetReply(text, native, image, true)).toThrow(ModelRejected)
    }
  })
  it.each([[-1, 30], [1288, 30], [30, 728]])('rejects native points outside the screenshot (%s,%s)', (x, y) => {
    expect(() => validateVisualTargetReply(reply('target', `click(start_box='(${x},${y})')`), native, image, true)).toThrow(ModelRejected)
  })
  it('rejects malformed JSON coordinates instead of replacing them with a guessed center', () => {
    for (const text of ['{"intent":"target","x":"500","y":500}', '{"intent":"target","x":1000,"y":500}', '{"intent":"missing","x":10,"y":20}', '{"intent":"new-task"}', '{"intent":"target","action":"hotkey","x":500,"y":500}']) {
      expect(() => validateVisualTargetReply(text, 'vision', image, true)).toThrow(ModelRejected)
    }
  })
  it('rejects unknown image dimensions rather than returning invalid physical coordinates', () => {
    expect(() => validateVisualTargetReply(reply('target'), native, { ...image, w: NaN }, true)).toThrow(ModelRejected)
  })
  it('returns missing without a clickable point and refuses dismissal when disabled', () => {
    expect(validateVisualTargetReply(reply('missing', 'call_user()'), native, image, false)).toEqual({ intent: 'missing', reason: 'One control.' })
    expect(validateVisualTargetReply('{"intent":"missing","reason":"Blocked"}', 'vision', image, false)).toEqual({ intent: 'missing', reason: 'Blocked' })
    expect(() => validateVisualTargetReply(reply('dismiss'), native, image, false)).toThrow(ModelRejected)
  })
})

describe('target requests leave the initiative API alone', () => {
  it('requests the explicit native intent without a broad future-task plan', async () => {
    const requests = capture(() => reply('target'))
    await chooseVisualTarget({ apiKey: 'fake', model: native, goal: 'Image folder input', screen: image, allowDismiss: true })
    expect(requests).toHaveLength(1)
    expect(requests[0].messages[0].content).toContain('Intent: target OR dismiss OR missing')
    expect(requests[0].messages[0].content).not.toContain('Write a small plan')
    expect(requests[0].messages[0].content).toContain('Do not approve confirmations')
  })
  it('passes the original target and factual dismissal record beside the new image', async () => {
    const requests = capture(() => '{"intent":"target","x":500,"y":300}')
    await chooseVisualTarget({ apiKey: 'fake', model: 'vision', goal: 'Output folder input', screen: image, allowDismiss: false, dismissalRecord: 'One left click sent; application result unknown', jsonPrompt: 'SAVED CUSTOM' })
    expect(requests[0].messages[0].content).toContain('SAVED CUSTOM')
    expect(requests[0].messages[0].content).toContain('Dismissals enabled: NO')
    expect(requests[0].messages[0].content).toContain('Output folder input')
    expect(requests[0].messages[0].content).toContain('One left click sent; application result unknown')
    expect(requests[0].messages[1].content[0].image_url.url).toContain('NEW_SCREEN')
  })
  it('tries the configured backup when TARS omits intent rather than dispatching its ambiguous click', async () => {
    const requests = capture(model => model === native ? "Thought: Close it first.\nAction: click(start_box='(808,292)')" : '{"intent":"target","x":500,"y":200}')
    const result = await chooseVisualTarget({ apiKey: 'fake', model: [native, 'vision'], goal: 'Input', screen: image, allowDismiss: true })
    expect(result).toMatchObject({ intent: 'target', x: .5, y: .2 })
    expect(requests.map(r => r.model)).toEqual([native, 'vision'])
  })
  it('still accepts ordinary initiative move/click responses without an intent field', async () => {
    capture(() => '{"action":"move","x":400,"y":500}')
    expect(await guiStep({ apiKey: 'fake', model: 'vision', goal: 'Open existing item', initiative: true, history: [], screen: image })).toMatchObject({ kind: 'move', x: .4, y: .5 })
  })
})
