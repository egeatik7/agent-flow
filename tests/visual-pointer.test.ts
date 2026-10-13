import { afterEach, describe, expect, it, vi } from 'vitest'
import { alignVisualPointer } from '../electron/visual-hover'
import { validateVisualPointerReply, verifyVisualPointer, ModelRejected, setLocalEndpoint, setStopCheck } from '../electron/openrouter'
import { normalizePrompts } from '../electron/llm-flow'
import type { ScanResult } from '../electron/matcher'

const image = { data: Buffer.from('NEW_FRAME').toString('base64'), w: 1000, h: 700 }
function setup(answers = [{ decision: 'confirm' as const, reason: 'visible' }]) {
  let cursor = { x: -400, y: 120 }, frames = 0, next = 0
  const moves: any[] = [], observations: any[] = []
  const deps = {
    move: vi.fn(async (p: any) => { moves.push(p); cursor = { ...p }; return { hwnd: 42 } }),
    capture: vi.fn(async (): Promise<ScanResult> => ({ area: { x: -1000, y: -100, w: 1000, h: 700 }, cursor: { ...cursor }, image: { ...image, data: Buffer.from(`FRAME_${++frames}`).toString('base64') }, items: [], window: 'fixture', ocr: false, uiaCount: 0, ocrCount: 0 })),
    position: vi.fn(async () => ({ ...cursor })),
    decide: vi.fn(async (scan: ScanResult, p: any) => { observations.push([scan.image!.data, p]); return answers[next++] ?? answers[answers.length - 1]! }),
    checkStopped: vi.fn(), settle: vi.fn(async () => {}), stage: vi.fn(),
  }
  return { deps, moves, observations, moveCursor: (p: any) => { cursor = p } }
}
afterEach(() => { vi.unstubAllGlobals(); setLocalEndpoint(''); setStopCheck(() => false) })

describe('bounded visual pointer alignment', () => {
  it('confirms the marked ACTUAL point on a new frame, including negative desktop origin', async () => {
    const h = setup(); expect(await alignVisualPointer({ x: -400, y: 120 }, h.deps)).toMatchObject({ x: -400, y: 120, hwnd: 42 })
    expect(h.moves).toHaveLength(1); expect(h.observations).toHaveLength(1)
  })
  it('each adjustment gets a different fresh image and uses that image area for coordinates', async () => {
    const h = setup([{ decision: 'adjust', x: .8, y: .5, reason: 'right' } as any, { decision: 'confirm', reason: 'now inside' }])
    expect(await alignVisualPointer({ x: -400, y: 120 }, h.deps)).toMatchObject({ x: -200, y: 250 })
    expect(h.moves).toEqual([{ x: -400, y: 120 }, { x: -200, y: 250 }]); expect(h.observations[0][0]).not.toBe(h.observations[1][0])
  })
  it('uncertain never authorizes input', async () => {
    const h = setup([{ decision: 'uncertain', reason: 'covered' } as any])
    await expect(alignVisualPointer({ x: -400, y: 120 }, h.deps)).rejects.toThrow('onaylamadı')
  })
  it('three proposals at most; no endless move loop', async () => {
    const h = setup([{ decision: 'adjust', x: .5, y: .5, reason: 'adjust' } as any])
    await expect(alignVisualPointer({ x: -400, y: 120 }, h.deps)).rejects.toThrow('İki görsel')
    expect(h.moves).toHaveLength(3); expect(h.deps.decide).toHaveBeenCalledTimes(3)
  })
  it.each(['marker', 'image', 'window', 'position'])('rejects missing %s evidence before approval', async key => {
    const h = setup()
    if (key === 'window') h.deps.move.mockResolvedValue({ hwnd: undefined } as any)
    else if (key === 'position') h.deps.position.mockResolvedValue(undefined as any)
    else { const original = h.deps.capture; h.deps.capture = vi.fn(async () => ({ ...await original(), ...(key === 'marker' ? { cursor: null } : { image: null }) })) }
    await expect(alignVisualPointer({ x: -400, y: 120 }, h.deps)).rejects.toThrow()
    expect(h.deps.decide).not.toHaveBeenCalled()
  })
  it('cursor drift during the model call invalidates its confirmation', async () => {
    const h = setup(); h.deps.decide = vi.fn(async () => { h.moveCursor({ x: -100, y: 300 }); return { decision: 'confirm', reason: 'old' } })
    await expect(alignVisualPointer({ x: -400, y: 120 }, h.deps)).rejects.toThrow('Model beklenirken')
  })
  it('stop after a delayed answer invalidates the confirmation', async () => {
    const h = setup(); let stopped = false
    h.deps.decide = vi.fn(async () => { stopped = true; return { decision: 'confirm', reason: 'late' } })
    h.deps.checkStopped = vi.fn(() => { if (stopped) throw Error('STOP') })
    await expect(alignVisualPointer({ x: -400, y: 120 }, h.deps)).rejects.toThrow('STOP')
  })
})

describe('independent pointer decision contract', () => {
  it.each(['confirm', 'uncertain'])('accepts %s without a new point', decision => {
    expect(validateVisualPointerReply(JSON.stringify({ decision }), 'vision', image).decision).toBe(decision)
  })
  it('JSON adjustment uses the declared 0-1000 grid', () => {
    expect(validateVisualPointerReply('{"decision":"adjust","x":1,"y":500}', 'vision', image)).toMatchObject({ x: .001, y: .5 })
  })
  it.each([
    '{"decision":"confirm","x":500,"y":500}', '{"decision":"confirm","mode":"double"}',
    '{"decision":"confirm","action":null}', '{"decision":"adjust","x":"500","y":500}',
    '{"decision":"adjust","x":1000,"y":500}', '{"decision":"click"}', '{"decision":"adjust"}',
  ])('rejects unsafe reply %s', raw => { expect(() => validateVisualPointerReply(raw, 'vision', image)).toThrow(ModelRejected) })
  it('native TARS confirm is coordinate-free, and 1.5 corrections use image pixels', () => {
    expect(validateVisualPointerReply('Thought: inside\nDecision: confirm\nAction: click_current()', 'ui-tars-1.5', image).decision).toBe('confirm')
    expect(validateVisualPointerReply("Decision: adjust\nAction: move(start_box='(500,350)')", 'ui-tars-1.5', image)).toMatchObject({ x: .5, y: .5 })
    expect(() => validateVisualPointerReply("Decision: confirm\nAction: click(start_box='(5,5)')", 'ui-tars-1.5', image)).toThrow()
    expect(() => validateVisualPointerReply('Decision: confirm\nDecision: adjust\nAction: click_current()', 'ui-tars-1.5', image)).toThrow()
  })
  it('custom prompt is preserved and the real verification request contains the fresh image', async () => {
    const requests: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => { requests.push(JSON.parse(init.body)); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{"decision":"confirm"}' } }] }) } }))
    const prompts = normalizePrompts({ visualPointer: 'MY_POINTER_RULE' })
    await verifyVisualPointer({ apiKey: 'fixture', model: 'vision', goal: 'Blender', screen: image, area: { x: 0, y: 0, w: 1000, h: 700 }, pointer: { x: 300, y: 200 }, system: prompts.visualPointer })
    expect(requests).toHaveLength(1); expect(requests[0].messages[0].content).toContain('MY_POINTER_RULE')
    expect(requests[0].messages[1].content[1].image_url.url).toContain(image.data)
  })
  it('vision disabled cannot authorize via a text-only fallback', async () => {
    setLocalEndpoint('http://127.0.0.1:11434/v1', 1000, false)
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    await expect(verifyVisualPointer({ apiKey: '', model: 'local:vision', goal: 'Blender', screen: image, area: { x: 0, y: 0, w: 1000, h: 700 }, pointer: { x: 300, y: 200 } })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})
