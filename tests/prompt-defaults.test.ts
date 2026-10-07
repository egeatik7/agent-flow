import { describe, expect, it } from 'vitest'
import { DEFAULT_FIND_OFF, DEFAULT_PROMPTS, FIND_STAGES, LIST_PROMPT, promptOf } from '../electron/llm-flow'

/**
 * OCR listesi → yazı modeli aşamasının varsayılan promptu ve varsayılan AÇIK/KAPALI durumu.
 *
 * Ölçülen durum: aşama `['list']` ile varsayılan KAPALIYDI ve LIST_PROMPT mekânsal/monitör/taskbar
 * kurallarını taşımayan eski bir metindi; yani model bu promptu normalde hiç görmüyordu.
 */
describe('kelime listesi aşamasının varsayılanı', () => {
  it('liste aşaması varsayılan olarak AÇIK (kapalı listesinde değil)', () => {
    expect(DEFAULT_FIND_OFF, 'OCR listesi aşaması yine varsayılan kapalı').not.toContain('list')
    expect(DEFAULT_FIND_OFF).toEqual([])
  })

  it('"kayıtlı konum" (offset) aşaması ayrı kalır ve bu değişiklikten etkilenmez', () => {
    const offset = FIND_STAGES.find((s) => s.id === 'offset')
    expect(offset?.prompt, 'offset aşamasına prompt bağlanmamalı').toBeUndefined()
    expect(DEFAULT_FIND_OFF).not.toContain('offset')
  })

  it('liste aşaması bu promptu kullanır (DEFAULT_PROMPTS.list)', () => {
    expect(DEFAULT_PROMPTS.list).toBe(LIST_PROMPT)
    // Tasarım: promptOf yalnız KAYITLI metni döndürür; yerleşiği çağıran taraf (listPromptFor) koyar.
    expect(promptOf({}, 'list'), 'kayıt yokken promptOf kayıtlı metin uydurmamalı').toBeUndefined()
  })

  it('prompt mekânsal/monitör/taskbar kurallarını taşır', () => {
    const p = LIST_PROMPT
    for (const gerekli of [
      'individual OCR words',
      'current-list ID',
      'normalized screen position',
      'choose exactly ONE listed word',
      'not its OCR parent ID',
      'Never return coordinates or multiple IDs',
      'text field cannot move the click',
      'desktop shortcut is not a taskbar button',
      'bottom position alone is not proof',
      'NOT selectable',
      'Do not invent word positions',
      'Turkish suffixes',
      'Reply with JSON only',
    ]) {
      expect(p, `prompt şu kuralı taşımıyor: ${gerekli}`).toContain(gerekli)
    }
  })

  it('kullanıcının kaydettiği prompt varsayılanı geçersiz kılar (özel prompt korunur)', () => {
    const ozel = 'BENIM OZEL PROMPTUM'
    expect(promptOf({ list: ozel }, 'list')).toBe(ozel)
  })
})
