import { describe, expect, it } from 'vitest'
import { gridPointToScreen, type GridArea } from '../electron/visual-geometry'

/** The formula the agent used before this change. Kept here to prove inside-grid results did not move. */
const legacy = (c: [number, number], a: GridArea) => ({ x: a.x + (c[0] / 1000) * a.w, y: a.y + (c[1] / 1000) * a.h })

describe('gridPointToScreen', () => {
  it('maps the grid centre to the centre of a monitor left of the primary one (negative x)', () => {
    const left: GridArea = { x: -1920, y: 0, w: 1920, h: 1080 }
    expect(gridPointToScreen([500, 500], left)).toEqual({ x: -960, y: 540 })
  })

  it('maps correctly on a 125% DPI display, where the captured area is in physical pixels', () => {
    const scaled: GridArea = { x: 0, y: 0, w: 2400, h: 1350 }
    expect(gridPointToScreen([250, 750], scaled)).toEqual({ x: 600, y: 1012.5 })
  })

  it('maps the top-left grid corner exactly to the area origin', () => {
    expect(gridPointToScreen([0, 0], { x: -1920, y: -200, w: 1920, h: 1080 })).toEqual({ x: -1920, y: -200 })
  })

  it('keeps the far grid corner (1000,1000) one pixel inside the area, not one pixel outside', () => {
    const a: GridArea = { x: -1920, y: 100, w: 1920, h: 1080 }
    const p = gridPointToScreen([1000, 1000], a)
    expect(p).toEqual({ x: -1, y: 1179 })
    expect(p.x).toBeLessThan(a.x + a.w)
    expect(p.y).toBeLessThan(a.y + a.h)
  })

  it('pulls only the far edge in: a point on the far edge of one axis does not move the other axis', () => {
    const a: GridArea = { x: 0, y: 0, w: 1000, h: 500 }
    expect(gridPointToScreen([1000, 250], a)).toEqual({ x: 999, y: 125 })
  })

  it('gives exactly the legacy result for every point strictly inside the grid (behaviour unchanged)', () => {
    const areas: GridArea[] = [
      { x: 0, y: 0, w: 1920, h: 1080 },
      { x: -1920, y: 0, w: 1920, h: 1080 },
      { x: 10, y: 20, w: 1000, h: 500 },
      { x: 0, y: 0, w: 2400, h: 1350 },
    ]
    for (const a of areas) {
      for (let i = 0; i < 1000; i += 37) {
        for (let j = 0; j < 1000; j += 41) {
          expect(gridPointToScreen([i, j], a)).toEqual(legacy([i, j], a))
        }
      }
    }
  })

  it('never returns a point outside the area for any valid grid value', () => {
    const a: GridArea = { x: -1920, y: -50, w: 1920, h: 1080 }
    for (const v of [0, 1, 499, 999, 1000]) {
      const p = gridPointToScreen([v, v], a)
      expect(p.x).toBeGreaterThanOrEqual(a.x)
      expect(p.x).toBeLessThanOrEqual(a.x + a.w - 1)
      expect(p.y).toBeGreaterThanOrEqual(a.y)
      expect(p.y).toBeLessThanOrEqual(a.y + a.h - 1)
    }
  })
})
