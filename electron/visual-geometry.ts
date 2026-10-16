/** A captured area in physical screen pixels. `x` and `y` may be negative on a monitor left of or above the primary one. */
export type GridArea = { x: number; y: number; w: number; h: number }

/** Model grid side: visual models answer in a 0–1000 square over the captured area. */
export const GRID = 1000

function onGrid(origin: number, size: number, value: number): number {
  const exact = origin + (value / GRID) * size
  // The grid's far edge (1000) would land one pixel past the area; keep the point inside it.
  const last = origin + Math.max(1, size) - 1
  return Math.min(Math.max(exact, origin), last)
}

/**
 * Maps a model point on the 0–1000 grid to a screen point inside the captured area.
 * Values inside the grid map exactly as before; only the far edge (1000) is pulled back one pixel.
 */
export function gridPointToScreen(coordinate: readonly [number, number], area: GridArea): { x: number; y: number } {
  return { x: onGrid(area.x, area.w, coordinate[0]), y: onGrid(area.y, area.h, coordinate[1]) }
}
