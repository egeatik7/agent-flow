import { describe, expect, it } from 'vitest'
import { mergeOnnxLines, placeSideways, type OnnxLine } from '../electron/ocr-onnx'
import { wordCandidates, describeWordCandidates } from '../electron/word-targets'
import type { ScreenItem, ScanResult } from '../electron/matcher'
const row = (text: string, id = 1, x = 20): ScreenItem => ({ id, text, type: 'Text', src: 'ocr', x, y: 30, w: 100, h: 20 })
const line = (text: string, extra: Partial<OnnxLine> = {}): OnnxLine => ({ text, conf: .99, x: 20, y: 30, w: 100, h: 20, ...extra })
const merged = (items: ScreenItem[], lines: OnnxLine[]) => mergeOnnxLines(items, lines, 'combined')
describe('same-frame Windows + ONNX OCR evidence', () => {
  it('preserves conflicting Latin readings at the same location', () => {
    const r = merged([row('Finlshed')], [line('Finished')])
    expect(r.items.map(i => i.text)).toEqual(['Finlshed', 'Finished'])
    expect(r.items.map(i => i.ocrSources)).toEqual([['windows'], ['onnx']])
    expect(new Set(r.items.map(i => i.id)).size).toBe(2)
  })
  it('never replaces a Windows line with a conflicting Chinese reading', () => {
    expect(merged([row('Local')], [line('完成')]).items.map(i => i.text)).toEqual(['Local', '完成'])
  })
  it('deduplicates an exact same-place reading, keeping measured Windows words', () => {
    const r = row('Job finished')
    r.words = [{ t: 'Job', x: 20, y: 30, w: 25, h: 20 }, { t: 'finished', x: 65, y: 30, w: 55, h: 20 }]
    const before = JSON.stringify(r)
    const out = merged([r], [line('JOB  finished')])
    expect(out.items).toHaveLength(1)
    expect(out.usedOnnx).toBe(true); expect(out.added).toBe(0)
    expect(out.items[0].ocrSources).toEqual(['windows', 'onnx'])
    expect(out.items[0].words?.[1]).toMatchObject({ x: 65, w: 55, ocrSources: ['windows', 'onnx'] })
    expect(JSON.stringify(r)).toBe(before)
  })
  it('deduplicates a whole ONNX token against an actual measured Windows word', () => {
    const r = row('Google Chrome')
    r.words = [{ t: 'Google', x: 20, y: 30, w: 30, h: 20 }, { t: 'Chrome', x: 65, y: 30, w: 55, h: 20 }]
    const out = merged([r], [line('Chrome', { x: 65, w: 55 })])
    expect(out.items).toHaveLength(1)
    expect(out.items[0].words?.[1].ocrSources).toEqual(['windows', 'onnx'])
    expect(r.words[1].ocrSources).toBeUndefined()
  })
  it('retains same-name buttons at different locations and overlapping substrings/counters', () => {
    expect(merged([row('Save')], [line('Save', { x: 500 })]).items).toHaveLength(2)
    expect(merged([row('Save')], [line('Save As')]).items).toHaveLength(2)
    expect(merged([row('6/60')], [line('60/60')]).items.map(i => i.text)).toEqual(['6/60', '60/60'])
  })
  it('preserves UIA independently and does not label its controls as OCR evidence', () => {
    const uia: ScreenItem = { ...row('Save'), src: 'uia', type: 'Button' }
    const out = merged([uia], [line('Save')])
    expect(out.items).toHaveLength(2); expect(out.items[0].ocrSources).toBeUndefined()
  })
  it('does not invent separate word coordinates for an ONNX multiword line', () => {
    const out = merged([], [line('Job finished 60/60')])
    expect(out.items[0].words).toBeUndefined()
    const scan = { area: { x: 0, y: 0, w: 1000, h: 500 }, items: out.items } as ScanResult
    const candidates = wordCandidates(scan)
    expect(candidates[0].contextOnly).toBe(true)
    expect(describeWordCandidates(scan, candidates)).toContain('OCR-reader=onnx ONNX-confidence=0.990')
  })
  it('keeps existing confidence thresholds and rejects unusable geometry', () => {
    expect(merged([row('Done')], [line('Finished', { conf: .5 }), line('60/60', { conf: .8 }), line('Save', { w: 0 })]).items.map(i => i.text)).toEqual(['Done'])
  })
  it('keeps differing rotated readings at their real mapped positions', () => {
    const existing = [row('Wrong', 1, 40)]
    // CCW x=30,y=10,w=20,h=100 -> original x=40,y=30,w=100,h=20.
    const side = placeSideways([line('Right', { x: 30, y: 10, w: 20, h: 100 })], existing, 150, 100, 0, 0, 'combined')
    expect(side[0]).toMatchObject({ text: 'Right', x: 40, y: 30, w: 100, h: 20 })
    expect(placeSideways([line('Wrong', { x: 30, y: 10, w: 20, h: 100 })], existing, 150, 100, 0, 0, 'combined')).toEqual([])
  })
})
