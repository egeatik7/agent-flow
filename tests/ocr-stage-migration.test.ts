import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { activeFindOrder, FIND_STAGES, normalizeFind } from '../electron/llm-flow'
import { DEFAULT_SETTINGS } from '../electron/graph-types'
import LlmPanel from '../src/components/LlmPanel'
describe('one combined OCR target matching stage', () => {
  it('exposes one stage and keeps ONNX-off / Windows-on legacy settings enabled', () => {
    const migrated = normalizeFind(['chrome', 'windows', 'onnx', 'list'], ['onnx'])
    expect(migrated.order.filter(id => id === 'windows')).toHaveLength(1)
    expect(migrated.order).not.toContain('onnx'); expect(migrated.off).not.toContain('windows')
    expect(FIND_STAGES.filter(s => s.title.includes('OCR')).map(s => s.title)).toEqual(['Windows + ONNX OCR'])
  })
  it('keeps the earliest enabled legacy reader position, preserving model-before-OCR preference', () => {
    const migrated = normalizeFind(['windows', 'list', 'onnx', 'tars'], ['windows'])
    expect(migrated.order.slice(0, 3)).toEqual(['list', 'windows', 'tars'])
    expect(migrated.off).not.toContain('windows')
    expect(activeFindOrder(['windows', 'list', 'onnx'], ['windows'])).toEqual(['list', 'windows'])
  })
  it('keeps both-off legacy settings off and respects the new merged checkbox', () => {
    expect(normalizeFind(['windows', 'onnx'], ['windows', 'onnx']).off).toContain('windows')
    expect(normalizeFind(['windows', 'list'], ['windows']).off).toContain('windows')
    expect(activeFindOrder(['windows', 'list'], ['windows'])).toEqual(['list'])
    expect(activeFindOrder(['onnx'], ['onnx'])).toEqual([])
    expect(activeFindOrder(['onnx'], [])).toEqual(['windows'])
  })
  it('renders old persisted settings as one checkbox, without a duplicate ONNX row', () => {
    const html = renderToStaticMarkup(createElement(LlmPanel, { settings: { ...DEFAULT_SETTINGS, findOrder: ['windows', 'onnx', 'list'], findOff: ['onnx'] }, onSave: vi.fn() }))
    expect(html).toContain('Windows + ONNX OCR')
    expect(html).not.toMatch(/\d+\. ONNX OCR/)
    expect((html.match(/Windows \+ ONNX OCR/g) ?? []).length).toBe(1)
  })
})
