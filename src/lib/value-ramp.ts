/** Same value squeeze as XpTurn.CompressValue. Input 0 lands on lo, input 1 lands on hi. */

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
  if (m === 0) {
    const lifted = chan(lo * 255)
    return [lifted, lifted, lifted]
  }
  const v = m / 255
  const v2 = lo + v * (hi - lo)
  const scale = (v2 * 255) / m
  return [chan(r * scale), chan(g * scale), chan(b * scale)]
}
