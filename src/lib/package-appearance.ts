import type { AgentGraph } from '../../electron/graph-types'

// UI-only: legacy packages need no saved fields or migration. IDs survive rename,
// movement, save/reload and moving a package into a loop on the same canvas.
const COLORS = ['#24406e', '#6e354b', '#3c6550', '#70532c', '#514477', '#28636b', '#705342', '#5c6032']
const AERO_COLORS = ['#4e86cf', '#bc6387', '#4d9d83', '#d09a43', '#9270bf', '#3b9ead', '#bf805e', '#8da453']
const SYMBOLS = [
  'M3 3H13V13H3Z',
  'M8 2L14 8L8 14L2 8Z',
  'M8 2L14 13H2Z',
  'M8 2A6 6 0 1 0 8 14A6 6 0 1 0 8 2Z',
  'M5 2H11L14 8L11 14H5L2 8Z',
  'M8 2V14M2 8H14',
  'M3 3L13 13M13 3L3 13',
  'M3 4H13M3 8H13M3 12H13',
]

export type PackageAppearance = { color: string; aeroColor: string; symbol: string; badge: string }

function hashId(id: string): number {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619)
  return hash >>> 0
}

/** Distinct sibling color/symbol pairs for up to 64 packages; numbered badges
 * remain distinct beyond that. Order/position/name never participate. */
export function packageAppearances(graph: AgentGraph): Map<string, PackageAppearance> {
  const packages = graph.nodes.filter(n => n.kind === 'package').map(n => n.id).sort()
  const used = new Set<number>()
  const combinations = COLORS.length * SYMBOLS.length
  const result = new Map<string, PackageAppearance>()
  packages.forEach((id, index) => {
    let slot = hashId(id) % combinations
    if (used.size < combinations) {
      while (used.has(slot)) slot = (slot + 1) % combinations
      used.add(slot)
    }
    result.set(id, { color: COLORS[slot % COLORS.length], aeroColor: AERO_COLORS[slot % COLORS.length], symbol: SYMBOLS[Math.floor(slot / COLORS.length)], badge: `P${String(index + 1).padStart(2, '0')}` })
  })
  return result
}
