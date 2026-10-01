/** Same levels clip as XpTurn.CompressValue. Values at or below lo become 0. Values at or above hi become 1. */

export function rampIsFlat(lo: number, hi: number): boolean {
  return lo <= 0.0001 && hi >= 0.9999
}

function chan(v: number): number {
  if (v <= 0) return 0
  if (v >= 255) return 255
  return Math.round(v)
}

export function remapPixel(r: number, g: number, b: number, lo: number, hi: number): [number, number, number] {
  const max = r > g ? r : g
  const m = b > max ? b : max
  if (m === 0) return [0, 0, 0]
  const v = m / 255
  let v2: number
  if (v <= lo) v2 = 0
  else if (v >= hi) v2 = 1
  else v2 = (v - lo) / (hi - lo)
  if (v2 <= 0) return [0, 0, 0]
  const scale = (v2 * 255) / m
  return [chan(r * scale), chan(g * scale), chan(b * scale)]
}
