import { describeItems, type ScanResult, type ScreenItem } from './matcher'

export const SPATIAL_RULES = `Use physical coordinates and normalized positions to interpret the instruction. Nearby OCR boxes may be parts of one label, e.g. Google above Chrome; proximity is a hint, not proof. Select original item IDs, never invented combined IDs. Do not combine labels across a measured taskbar boundary. A desktop shortcut is not a taskbar button. Respect the requested surface; return id:null if only conflicting targets exist. Taskbars may be on any edge. A low y position alone does not prove taskbar membership. Percentages refer to the capture area, not necessarily one monitor.`

export function taskbarItem(scan: ScanResult, item: { x: number; y: number; w: number; h: number }): boolean {
  const x = item.x + item.w / 2, y = item.y + item.h / 2
  return (scan.regions ?? []).some(r => r.kind === 'taskbar' && r.w > 0 && r.h > 0 && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
}

export function asksDesktopShortcut(prompt: string): boolean {
  return /masaüst[üu]|desktop/i.test(prompt) && /simge|ikon|k[ıi]sayol|icon|shortcut/i.test(prompt)
}

export function spatialItems(scan: ScanResult, limit = 400): string {
  const items = scan.items.slice(0, limit)
  const center = (i: ScreenItem) => ({ x: i.x + i.w / 2, y: i.y + i.h / 2 })
  return items.map(i => {
    const c = center(i)
    const nearby = items.filter(j => {
      if (j.id === i.id || taskbarItem(scan, i) !== taskbarItem(scan, j)) return false
      const row = Math.min(i.y + i.h, j.y + j.h) - Math.max(i.y, j.y)
      const col = Math.min(i.x + i.w, j.x + j.w) - Math.max(i.x, j.x)
      const dx = Math.max(0, Math.max(i.x, j.x) - Math.min(i.x + i.w, j.x + j.w))
      const dy = Math.max(0, Math.max(i.y, j.y) - Math.min(i.y + i.h, j.y + j.h))
      return (row >= Math.min(i.h, j.h) / 2 && dx <= Math.max(24, Math.min(i.h, j.h) * 3)) || (col > 0 && dy <= Math.max(12, Math.min(i.h, j.h) * 1.5))
    }).sort((a, b) => Math.hypot(center(a).x - c.x, center(a).y - c.y) - Math.hypot(center(b).x - c.x, center(b).y - c.y)).slice(0, 3)
    const links = nearby.map(j => {
      const d = center(j), dx = d.x - c.x, dy = d.y - c.y
      const direction = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'above' : 'below')
      return `#${j.id}(${direction})`
    })
    return `${describeItems([i])} center=${((c.x - scan.area.x) / Math.max(1, scan.area.w) * 100).toFixed(1)}%,${((c.y - scan.area.y) / Math.max(1, scan.area.h) * 100).toFixed(1)}%${taskbarItem(scan, i) ? ' region=taskbar' : ''}${links.length ? ` nearby=${links.join(',')}` : ''}`
  }).join('\n')
}

export function spatialContext(scan: ScanResult): string {
  return `${SPATIAL_RULES}\nMeasured taskbar regions: ${scan.regions?.length ? scan.regions.map(r => `@${r.x},${r.y} ${r.w}x${r.h}`).join('; ') : 'unavailable; do not infer taskbar from bottom position alone'}`
}
