import { describe, expect, it } from 'vitest'
import { observedInput, matchesObservedInput } from '../electron/custom-input'
import type { ScanResult } from '../electron/matcher'
const win = { hwnd: '100', pid: 10, title: 'Renamer', rect: { x: 205, y: 0, w: 1025, h: 1080 } }
const row = { id: 1, text: 'C:YUser$/ASUS TUF/Ccwnlcad5/Medievel', src: 'ocr' as const, type: 'Text', x: 232, y: 456, w: 280, h: 13 }
const scan = { items: [row], area: win.rect } as ScanResult
describe('custom input observation and full-value copy matching', () => {
  it('finds the logged path row even when the field is clicked to the right of its text', () => {
    expect(observedInput(scan, win, { x: 662, y: 462 })?.text).toBe(row.text)
  })
  it('does not adopt labels on another line, background text or ambiguous adjacent fields', () => {
    expect(observedInput(scan, win, { x: 662, y: 424 })).toBeUndefined()
    expect(observedInput({ ...scan, items: [{ ...row, x: 0 }] }, win, { x: 662, y: 462 })).toBeUndefined()
    expect(observedInput({ ...scan, items: [row, { ...row, id: 2, x: 600 }] }, win, { x: 662, y: 462 })).toBeUndefined()
  })
  it('tolerates the logged OCR path errors without accepting arbitrary copied text', () => {
    expect(matchesObservedInput(row.text, 'C:\\Users\\ASUS TUF\\Downloads\\Medieval')).toBe(true)
    expect(matchesObservedInput(row.text, 'openrouter/secret-key-other-field')).toBe(false)
    expect(matchesObservedInput(row.text, 'C:\\Users\\ASUS TUF\\Downloads\\Metal')).toBe(false)
    expect(matchesObservedInput('C:\\Users\\ASUS TUF', 'C:\\Users\\ASUS TUF\\Downloads\\Medieval')).toBe(false)
  })
  it('rejects empty, short, multiline and oversized clipboard values', () => {
    for (const value of ['', 'C:\\Users', row.text + '\nother field', 'x'.repeat(2049)]) expect(matchesObservedInput(row.text, value)).toBe(false)
  })
})
