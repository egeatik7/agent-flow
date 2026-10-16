import type { BaglamKarti } from '../../electron/hud-context'
import type { BellekKarti } from '../../electron/memory-meter'

const record = (v: unknown): Record<string, unknown> | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined
const string = (v: unknown, fallback = '') => typeof v === 'string' ? v : fallback
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []
const number = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
export const hudText = (v: unknown): string => string(record(v)?.text).trim()

// Only presentation fields cross this boundary. Missing numbers remain unknown, never zero.
export type HudContext = Pick<BaglamKarti, 'yukluMetin' | 'rozet' | 'eski' | 'bilinmiyor' | 'azamiToken' | 'yapilandirilmisToken' | 'istekNumCtx' | 'girisToken' | 'tahminiToken'>
export function hudContext(value: unknown): HudContext | undefined {
  const v = record(value)
  if (!v || typeof v.yukluMetin !== 'string') return
  return {
    yukluMetin: v.yukluMetin, rozet: string(v.rozet, 'ölçüm zamanı bilinmiyor'),
    eski: v.eski === true, bilinmiyor: v.bilinmiyor === true,
    azamiToken: number(v.azamiToken), yapilandirilmisToken: number(v.yapilandirilmisToken),
    istekNumCtx: number(v.istekNumCtx), girisToken: number(v.girisToken), tahminiToken: number(v.tahminiToken),
  }
}
export type HudMemory = Omit<BellekKarti, 'satirlar'>
export function hudMemory(value: unknown): HudMemory | undefined {
  const v = record(value)
  if (!v || typeof v.ramVram !== 'string') return
  return {
    ramVram: v.ramVram, butce: string(v.butce, 'Bellek bütçesi bilinmiyor'),
    gpuSatirlari: strings(v.gpuSatirlari), surecSatirlari: strings(v.surecSatirlari), aciklamalar: strings(v.aciklamalar),
    daraliyor: v.daraliyor === true, uyari: string(v.uyari), olcumVar: v.olcumVar === true,
    eski: v.eski === true, yas: string(v.yas, 'ölçüm zamanı bilinmiyor'), hata: string(v.hata),
  }
}
