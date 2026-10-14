import { expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../electron/graph-types'
import { nextModelRevision, resolveStage, stageHint } from '../electron/model-chain'

const base = { ...DEFAULT_SETTINGS, model: 'A', modelBackups: ['B', 'C'], agentModel: 'Yap', agentBackups: ['Yedek'], visionModel: 'Gorsel', visionBackups: ['G2'] }

it('boş kelime seçimi Metin sırasını kullanır; doluysa ayrı zincirdir', () => {
  expect(resolveStage(base, 'list')).toMatchObject({ source: 'Metin Modeli', chain: ['A', 'B', 'C'], separate: false })
  expect(resolveStage(base, 'word').separate).toBe(false)
  expect(resolveStage(base, 'word').chain).toEqual(['A', 'B', 'C'])
  const ayri = resolveStage({ ...base, wordChoiceModel: 'Kelime', wordChoiceBackups: ['K2'] }, 'word')
  expect(ayri).toMatchObject({ source: 'OCR kelime seçimi', chain: ['Kelime', 'K2'], separate: true })
  expect(stageHint({ ...base, wordChoiceModel: 'Kelime', wordChoiceBackups: [] }, 'word')).toContain('ayrı zincir')
})

it('görsel hedef ve imleç Görsel listesini kullanır; Yap listesi yalnız araç döngüsüne aittir', () => {
  expect(resolveStage(base, 'visual').chain).toEqual(['Gorsel', 'G2'])
  expect(resolveStage(base, 'pointer').chain).toEqual(['Gorsel', 'G2'])
  expect(resolveStage(base, 'pointer').source).toBe('Görsel LLM')
  expect(resolveStage(base, 'stall').chain).toEqual(['Gorsel', 'G2'])
  expect(resolveStage(base, 'stall').separate).toBe(true)
  const metin = resolveStage({ ...base, agentModel: '', agentBackups: [], visionModel: '', visionBackups: [] }, 'visual')
  expect(metin).toMatchObject({ source: 'Metin Modeli', chain: ['A', 'B', 'C'], separate: false })
})

it('Yap araç döngüsü UI-TARS adını çıkarır; kurtarma genel listeden ayrıdır', () => {
  const yap = resolveStage({ ...base, agentModel: 'bytedance/ui-tars-1.5', agentBackups: ['A', 'ui-tars-7b'] }, 'yap')
  expect(yap.chain).toEqual(['A'])
  expect(yap.separate).toBe(true)
  const kurtarma = resolveStage({ ...base, recovery: { ...DEFAULT_SETTINGS.recovery, enabled: true, model: 'Kurtarma', backups: ['K2'], apiKey: 'x', task: '', instructions: '', allowDesktop: true, allowNodes: true, allowedNodeIds: [], maxCalls: 1, timeoutMs: 1000, maxRecoveries: 1 } }, 'recovery')
  expect(kurtarma.chain).toEqual(['Kurtarma', 'K2'])
  expect(kurtarma.source).toBe('Kurtarma ajanı')
})

it('sıra kaydı revizyonu artırır; başka ayar artırmaz', () => {
  const prev = { ...base, modelRevision: 4 }
  expect(nextModelRevision(prev, { ...prev, apiKey: 'yeni' })).toBe(4)
  expect(nextModelRevision(prev, { ...prev, model: 'B', modelBackups: ['A', 'C'] })).toBe(5)
  expect(nextModelRevision(prev, { ...prev, model: '  A  ' })).toBe(4)
})
