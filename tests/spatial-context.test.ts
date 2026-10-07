import { describe, it, expect } from 'vitest'
import { asksDesktopShortcut, spatialItems, taskbarItem } from '../electron/spatial-context'
import type { ScanResult } from '../electron/matcher'
const scan: ScanResult = { area: { x: 0, y: 0, w: 1920, h: 1080 }, items: [
  { id: 7, text: 'Google', src: 'ocr', type: 'Text', x: 90, y: 880, w: 60, h: 15 },
  { id: 19, text: 'Chrome', src: 'ocr', type: 'Text', x: 90, y: 899, w: 60, h: 15 },
  { id: 177, text: 'Chrome', src: 'uia', type: 'Button', x: 800, y: 1040, w: 80, h: 30 },
], regions: [{ kind: 'taskbar', x: 0, y: 1030, w: 1920, h: 50 }], ocr: true, uiaCount: 1, ocrCount: 2, image: null, window: '' }
describe('spatial context', () => {
 it('retains IDs and relates vertically split labels without mutation', () => {
   const old = JSON.stringify(scan); const text = spatialItems(scan)
   expect(text).toContain('#19(below)'); expect(text).toContain('#7(above)')
   expect(text).toContain('center='); expect(text).toContain('region=taskbar')
   expect(JSON.stringify(scan)).toBe(old)
 })
 it('does not infer taskbar from a low desktop coordinate', () => {
   expect(taskbarItem(scan, scan.items[1])).toBe(false)
   expect(taskbarItem(scan, scan.items[2])).toBe(true)
   expect(taskbarItem({ ...scan, regions: undefined }, scan.items[2])).toBe(false)
 })
 it('handles a side taskbar with negative coordinates', () => {
   expect(taskbarItem({ ...scan, regions: [{ kind: 'taskbar', x: -80, y: 0, w: 80, h: 1080 }] }, { x: -60, y: 300, w: 20, h: 20 })).toBe(true)
 })
 it('narrows the guard to explicit desktop shortcuts', () => {
   expect(asksDesktopShortcut('Masaüstündeki Chrome simgesine tıkla')).toBe(true)
   expect(asksDesktopShortcut('desktop Chrome shortcut')).toBe(true)
   expect(asksDesktopShortcut('masaüstü uygulamasını aç')).toBe(false)
 })
 it('does not relate text across taskbar boundaries', () => {
   const result = spatialItems({ ...scan, items: [ { ...scan.items[0], y: 1010 }, { ...scan.items[1], y: 1032 } ] })
   expect(result).not.toContain('nearby=')
 })
})
