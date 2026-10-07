import { afterEach, describe, expect, it, vi } from 'vitest'
import { chooseScreenTarget, setStopCheck } from '../electron/openrouter'
import { wordCandidates, describeWordCandidates, refineWordTarget } from '../electron/word-targets'
import type { ScanResult, ScreenItem } from '../electron/matcher'
const row: ScreenItem = { id: 7, text: 'Run Remesh', type: 'Text', src: 'ocr', x: 100, y: 80, w: 280, h: 20, words: [
 { t: 'Run', x: 100, y: 80, w: 40, h: 20 }, { t: 'Remesh', x: 300, y: 80, w: 80, h: 20 }
] }
const scan: ScanResult = { area: { x: 0, y: 0, w: 1920, h: 1080 }, items: [row, { id: 20, text: 'Save', src: 'uia', type: 'Button', x: 400, y: 300, w: 80, h: 25 }], ocr: true, uiaCount: 1, ocrCount: 1, image: null, window: 'Fixture' }
afterEach(() => { vi.unstubAllGlobals(); setStopCheck(() => false) })
async function ask(reply: unknown, system?: string) {
 let body = ''
 vi.stubGlobal('fetch', vi.fn(async (_url, init) => { body = init.body; return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }) } }))
 const result = await chooseScreenTarget({ apiKey: 'fixture-key', model: 'fixture/model', prompt: 'Run remesh düğmesine tıkla', kind: 'click', scan, stepTitle: 'Click', sendImage: false, system })
 return { result, request: JSON.parse(body) }
}
describe('OCR words to model and exact selected word', () => {
 it('splits only real measured words and retains UIA IDs without mutating scanner data', () => {
  const old = JSON.stringify(scan), candidates = wordCandidates(scan)
  expect(candidates.map(c => c.item.text)).toEqual(['Run', 'Remesh', 'Save'])
  expect(new Set(candidates.map(c => c.item.id)).size).toBe(3)
  expect(candidates.find(c => c.item.text === 'Save')?.item.id).toBe(20)
  expect(candidates[1].wordIndex).toBe(1); expect(JSON.stringify(scan)).toBe(old)
 })
 it('maps a selected word back to its exact box regardless of generated text/coordinates', async () => {
  const id = wordCandidates(scan)[1].item.id
  const { result } = await ask({ id, text: 'Run Remesh other invented text', x: 240, y: 90 })
  expect(result.id).toBe(7); expect(result.wordIndex).toBe(1); expect(result.text).toBe('Remesh')
  expect(refineWordTarget(row, result.wordIndex!)).toMatchObject({ x: 300, y: 80, w: 80, h: 20, clickPoint: { x: 340, y: 90 } })
 })
 it('sends every observed word, coordinates, and one-word rule even with a saved custom prompt', async () => {
  const { request } = await ask({ id: null }, 'saved custom system')
  expect(request.messages[0].content).toBe('saved custom system')
  const text = request.messages[1].content
  expect(text).toContain('"Run" @100,80 40x20'); expect(text).toContain('"Remesh" @300,80 80x20')
  expect(text).not.toContain('"Run Remesh" @100,80 280x20')
  expect(text).toContain('choose exactly ONE word'); expect(text).toContain('center=')
 })
 it('rejects unlisted OCR parent IDs, hallucinated IDs, arrays, multiple-ID strings and null replies', async () => {
  for (const reply of [{ id: 7 }, { id: 9999 }, { id: [21] }, { id: [21, 22] }, { id: '21,22' }, null]) {
   expect((await ask(reply)).result.id).toBeNull()
  }
 })
 it('preserves UIA selection and explicit no-match', async () => {
  expect((await ask({ id: 20, text: 'Save' })).result.id).toBe(20)
  expect((await ask({ id: null })).result.id).toBeNull()
 })
 it('keeps legacy OCR without word geometry honest instead of estimating split positions', () => {
  const legacy = { ...scan, items: [{ ...row, words: undefined }] }
  const candidates = wordCandidates(legacy)
  expect(candidates).toHaveLength(1)
  expect(describeWordCandidates(legacy, candidates)).toContain('word geometry unavailable')
  expect(candidates[0].contextOnly).toBe(true)
 })
 it('does not impose the old 400-row truncation on the word cloud', () => {
  const many = { ...scan, items: Array.from({ length: 450 }, (_, id) => ({ ...row, id })) }
  const candidates = wordCandidates(many)
  expect(candidates).toHaveLength(900)
  expect(describeWordCandidates(many, candidates)).toContain(`#${candidates.at(-1)!.item.id} `)
 })
 it('rejects invalid word boxes/indices and clicks inside a one-pixel or negative-origin word', () => {
  expect(refineWordTarget(row, 99)).toBeNull(); expect(refineWordTarget(row, -1)).toBeNull()
  const tiny = { ...row, words: [{ t: 'X', x: -10, y: 5, w: 1, h: 1 }] }
  expect(refineWordTarget(tiny, 0)?.clickPoint).toEqual({ x: -10, y: 5 })
  expect(refineWordTarget({ ...row, words: [{ t: 'X', x: 0, y: 0, w: 0, h: 10 }] }, 0)).toBeNull()
 })
})
