/**
 * Her LLM aşamasının hangi kayıtlı listeden sırayı aldığını tek yerde söyler.
 * Aşama, Metin Modeli listesini okumuyorsa `separate` doğrudur: arayüz bunu gizlemez.
 * Çağıran, isteği başlatmadan hemen önce `resolveStage` okur. Süren istek bu diziyi kopyalar.
 */
import { modelChain, type AppSettings } from './graph-types'
import { recoverySettings } from './recovery-settings'

export type ChainStage = 'list' | 'word' | 'visual' | 'pointer' | 'stall' | 'condition' | 'yap' | 'recovery'

export type ResolvedChain = {
  stage: ChainStage
  label: string
  /** Kaydın hangi listesinden geldiği. Günlükteki `kaynak` budur. */
  source: string
  chain: string[]
  /** Metin Modeli alanlarını okumuyorsa doğru. Aynı adlar yazılmış olsa da liste ayrıdır. */
  separate: boolean
}

export function textChain(s: AppSettings): string[] {
  return modelChain(s.model, s.modelBackups)
}

function visionResolved(s: AppSettings): { chain: string[]; source: string; separate: boolean } {
  const vision = modelChain(s.visionModel, s.visionBackups)
  if (String(s.visionModel ?? '').trim() || vision.length) return { chain: vision, source: 'Görsel LLM', separate: true }
  return { chain: textChain(s), source: 'Metin Modeli', separate: false }
}

function agentResolved(s: AppSettings): { chain: string[]; source: string; separate: boolean } {
  if (String(s.agentModel ?? '').trim() || modelChain(s.agentModel, s.agentBackups).length) {
    return { chain: modelChain(s.agentModel, s.agentBackups), source: 'Yap modeli', separate: true }
  }
  return visionResolved(s)
}

/** Yap araç döngüsü: UI-TARS adları çıkar. Ana ad UI-TARS ise Metin Modeli'nin ilk adı kullanılır; yedekler Yap listesinden kalır. */
export function yapChain(s: AppSettings): string[] {
  const primary = s.agentModel && !/ui-?tars/i.test(s.agentModel) ? s.agentModel : s.model
  return modelChain(primary, s.agentBackups).filter((name) => !/ui-?tars/i.test(name))
}

export function resolveStage(s: AppSettings, stage: ChainStage): ResolvedChain {
  if (stage === 'list') {
    return { stage, label: 'Genel hedef seçimi', source: 'Metin Modeli', chain: textChain(s), separate: false }
  }
  if (stage === 'word') {
    const dedicated = modelChain(s.wordChoiceModel, s.wordChoiceBackups)
    if (String(s.wordChoiceModel ?? '').trim() || dedicated.length) {
      return { stage, label: 'OCR kelime seçimi', source: 'OCR kelime seçimi', chain: dedicated, separate: true }
    }
    return { stage, label: 'OCR kelime seçimi', source: 'Metin Modeli', chain: textChain(s), separate: false }
  }
  if (stage === 'visual' || stage === 'pointer') {
    const agent = agentResolved(s)
    const label = stage === 'visual' ? 'Görsel hedefleme' : 'İmleç doğrulama'
    return { stage, label, source: agent.source, chain: agent.chain, separate: agent.separate }
  }
  if (stage === 'stall') {
    const vision = visionResolved(s)
    return { stage, label: 'Takılma planı', source: vision.source, chain: vision.chain, separate: vision.separate }
  }
  if (stage === 'condition') {
    const dedicated = modelChain(s.conditionModel, s.conditionBackups)
    if (String(s.conditionModel ?? '').trim() || dedicated.length) {
      return { stage, label: 'Koşul', source: 'Koşul modeli', chain: dedicated, separate: true }
    }
    return { stage, label: 'Koşul', source: 'Metin Modeli', chain: textChain(s), separate: false }
  }
  if (stage === 'yap') {
    return { stage, label: 'Yap araç döngüsü', source: 'Yap modeli (UI-TARS araçta yok)', chain: yapChain(s), separate: true }
  }
  const recovery = recoverySettings(s.recovery)
  return { stage, label: 'Kurtarma', source: 'Kurtarma ajanı', chain: modelChain(recovery.model, recovery.backups), separate: true }
}

/** Kayıtlı sıra değişmediyse revizyon durur. Değiştiyse bir artar. */
export function nextModelRevision(prev: AppSettings, next: AppSettings): number {
  const same = modelOrderFingerprint(prev) === modelOrderFingerprint(next)
  return same ? (prev.modelRevision ?? 0) : (prev.modelRevision ?? 0) + 1
}

/** Kayıtlı sıra değişti mi diye settings:save karşılaştırır. Boşluk temizliği aynı sırayı değiştirmez. */
export function modelOrderFingerprint(s: AppSettings): string {
  const recovery = recoverySettings(s.recovery)
  return JSON.stringify({
    model: modelChain(s.model, s.modelBackups),
    word: modelChain(s.wordChoiceModel, s.wordChoiceBackups),
    vision: modelChain(s.visionModel, s.visionBackups),
    agent: modelChain(s.agentModel, s.agentBackups),
    condition: modelChain(s.conditionModel, s.conditionBackups),
    recovery: modelChain(recovery.model, recovery.backups),
  })
}

export function chainOrderText(chain: string[]): string {
  return chain.length ? chain.join(' > ') : '(model yok)'
}

/** Ayarlar ve Yöntemler sekmelerinde aynı cümle. */
export function stageHint(s: AppSettings, stage: ChainStage): string {
  const resolved = resolveStage(s, stage)
  const order = chainOrderText(resolved.chain)
  if (stage === 'list') return `Genel hedef seçimi bu sırayı kullanır: ${order}.`
  if (stage === 'word') {
    return resolved.separate
      ? `OCR kelime seçimi ayrı zincirdir; Metin Modeli sırası burada uygulanmaz: ${order}.`
      : `OCR kelime seçimi boş: Metin Modeli sırası kullanılır: ${order}.`
  }
  if (stage === 'visual') return `Görsel hedefleme bu sırayı kullanır (${resolved.source}): ${order}.`
  if (stage === 'pointer') return `İmleç doğrulama, görsel hedefleme ile aynı sırayı kullanır (${resolved.source}): ${order}.`
  if (stage === 'stall') return `Takılma planı bu sırayı kullanır (${resolved.source}): ${order}. Görsel hedefleme, Yap modeli doluysa bu listeyi kullanmaz.`
  if (stage === 'yap') return `Yap araç döngüsü bu sırayı kullanır: ${order}. UI-TARS adları bu döngüye girmez.`
  if (stage === 'condition') {
    return resolved.separate
      ? `Koşul ayrı zincirdir: ${order}.`
      : `Koşul modeli boş: Metin Modeli sırası kullanılır: ${order}.`
  }
  return `Kurtarma çağrıları bu sırayı kullanır: ${order}. Genel model listesinden ayrıdır.`
}
