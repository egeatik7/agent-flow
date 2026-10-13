import type { ViewerHud } from './viewer-types'
import type { BaglamKarti } from './hud-context'
import type { BellekKarti } from './memory-meter'

export function emptyViewerHud(): ViewerHud {
  return { level: 'info', text: 'Ne yaptığı burada yazacak.', loop: '', method: '', countdown: '', recovering: false, stages: '' }
}

/** The same reducer drives live events and reconnect snapshots. */
export function updateViewerHud(current: ViewerHud | undefined, channel: string, payload: unknown): ViewerHud | undefined {
  const value = payload as { text?: unknown; level?: unknown; active?: unknown; nodeTitle?: unknown; message?: unknown; kart?: unknown } | null
  if (!value || typeof value !== 'object') return
  const next = { ...(current ?? emptyViewerHud()) }
  if (channel === 'hud:status') {
    if (typeof value.text !== 'string' || !value.text.trim()) return
    next.text = value.text.trim()
    next.level = value.level === 'warn' || value.level === 'error' || value.level === 'success' ? value.level : 'info'
  } else if (channel === 'hud:loop' || channel === 'hud:method' || channel === 'hud:countdown' || channel === 'hud:stages') {
    if (typeof value.text !== 'string') return
    next[channel.slice(4) as 'loop' | 'method' | 'countdown' | 'stages'] = value.text.trim()
  } else if (channel === 'hud:context') {
    // Bağlam ölçümü NESNE olarak taşınır (masaüstü kartının aynısı); `null` = ölçüm temizlendi.
    const kart = value.kart
    if (kart === null || kart === undefined) delete next.baglam
    else if (typeof kart === 'object') next.baglam = kart as BaglamKarti
    else return
  } else if (channel === 'hud:memory') {
    // Canlı bellek göstergesi de NESNE olarak taşınır: günlük metni AYRIŞTIRILMAZ (1.9.130).
    const kart = value.kart
    if (kart === null || kart === undefined) delete next.bellek
    else if (typeof kart === 'object') next.bellek = kart as BellekKarti
    else return
  } else if (channel === 'recovery:status') {
    next.recovering = value.active === true
    next.level = next.recovering ? 'warn' : 'info'
    next.text = `${typeof value.nodeTitle === 'string' ? value.nodeTitle : ''}: ${typeof value.message === 'string' ? value.message : ''}`
  } else return
  return next
}
