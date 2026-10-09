import { afterEach, describe, expect, it, vi } from 'vitest'
import { chooseScreenTarget, chooseVisualTarget, guiStep, setStopCheck } from '../electron/openrouter'
import type { ScanResult } from '../electron/matcher'

afterEach(() => { vi.unstubAllGlobals(); setStopCheck(() => false) })

const image = { data: 'fixture-image', w: 1000, h: 700 }
const scan: ScanResult = { area: { x: 0, y: 0, w: 1000, h: 700 }, items: [
  { id: 1, text: 'Chrome', type: 'Button', src: 'uia', x: 20, y: 30, w: 100, h: 20 },
], ocr: true, uiaCount: 1, ocrCount: 0, window: 'Fixture', image }

function mockReply(content: string) {
  const requests: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    requests.push(JSON.parse(init.body))
    return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }) }
  }))
  return requests
}

function noAppLimit(requests: Record<string, unknown>[]) {
  expect(requests).toHaveLength(1)
  expect(requests[0]).not.toHaveProperty('max_tokens')
  expect(requests[0]).not.toHaveProperty('max_completion_tokens')
  expect(requests[0]).not.toHaveProperty('reasoning')
  expect(requests[0].temperature).toBe(0)
}

describe('Provider uses its own output token defaults', () => {
  it.each([
    ['click', false], ['click', true], ['condition', false], ['condition', true],
  ] as const)('does not limit %s target selection (image=%s)', async (kind, sendImage) => {
    const requests = mockReply('{"id":1}')
    expect((await chooseScreenTarget({ apiKey: 'fixture-key', model: 'fixture/model', prompt: 'Chrome', kind, stepTitle: kind, scan, sendImage })).id).toBe(1)
    noAppLimit(requests)
  })

  it.each(['fixture/model', 'bytedance/ui-tars-1.5-7b'])('does not limit GUI initiative for %s', async model => {
    const requests = mockReply(model.includes('ui-tars') ? 'Action: finished()' : '{"action":"finished"}')
    expect((await guiStep({ apiKey: 'fixture-key', model, goal: 'Open Chrome', history: [], screen: image, initiative: true })).kind).toBe('finished')
    noAppLimit(requests)
  })

  it.each(['fixture/model', 'bytedance/ui-tars-1.5-7b'])('does not limit visual target selection for %s', async model => {
    const requests = mockReply(model.includes('ui-tars') ? 'Intent: missing\nAction: call_user()' : '{"intent":"missing"}')
    expect((await chooseVisualTarget({ apiKey: 'fixture-key', model, goal: 'Chrome', screen: image, allowDismiss: false })).intent).toBe('missing')
    noAppLimit(requests)
  })
})
