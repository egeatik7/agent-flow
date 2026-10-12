import { describe, expect, it, vi } from 'vitest'
import type { AgentGraph } from '../electron/graph-types'
import { createNode } from '../electron/graph-types'

/**
 * Ölçülen kusur (1.9.109 günlüğü): yerel yazı modeli "User Perspective" için 179/143/141 gibi numaralar
 * döndürdü ve program yalnız "LLM uygun öğe bulamadı" yazdı — REDDİN SEBEBİ görünmüyordu. 1.9.110'da
 * karar nesnesi sebebi (`rejected`) ve modelin ham numarasını (`rawId`) taşır; ajan da bunu günlüğe yazar
 * ve modelin verdiği METİNLE kurtarmayı dener.
 */
function scanWith(items: { id: number; text: string; src?: 'uia' | 'ocr'; words?: { t: string; x: number; y: number; w: number; h: number }[] }[]) {
  return {
    area: { x: 0, y: 0, w: 1000, h: 700 },
    items: items.map((i) => ({ id: i.id, text: i.text, type: i.src === 'ocr' ? 'Text' : 'Button', src: i.src ?? 'uia', x: 10, y: 10, w: 120, h: 20, ...(i.words ? { words: i.words } : {}) })),
    image: null, window: 'Blender', ocr: true, ocrCount: items.length, uiaCount: items.filter((i) => (i.src ?? 'uia') === 'uia').length, ocrEngine: 'combined',
  } as never
}

async function sec(scan: unknown, modelReply: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelReply) } }] }) })))
  const { chooseScreenTarget } = await import('../electron/openrouter')
  return chooseScreenTarget({ apiKey: 'fake', model: 'valid', prompt: 'User Perspective', kind: 'click' as never, stepTitle: 'Tıkla', scan: scan as never, sendImage: false })
}

describe('reddedilen model numarası artık sebebiyle raporlanır', () => {
  it('listede olmayan numara: rejected=absent ve rawId korunur', async () => {
    const scan = scanWith([{ id: 10, text: 'Anvil.glb' }, { id: 11, text: 'Kaydet' }])
    const choice = await sec(scan, { id: 179, text: 'User Perspective', reason: 'sol üst' })
    expect(choice.id).toBeNull()
    expect(choice.rejected).toBe('absent')
    expect(choice.rawId).toBe(179)
    expect(choice.text).toBe('User Perspective')
  })

  it('tıklanabilir olmayan aday (context-only) ayrı sebeple bildirilir', async () => {
    // Çok kelimeli ve KELİME GEOMETRİSİ OLMAYAN OCR öğesi aday listesinde "context-only" olur.
    const scan = scanWith([{ id: 20, text: 'User Perspective', src: 'ocr' }])
    const choice = await sec(scan, { id: 20, text: 'User Perspective', reason: 'başlık' })
    expect(choice.id).toBeNull()
    expect(choice.rejected).toBe('not-selectable')
    expect(choice.rawId).toBe(20)
  })

  it('geçerli OCR kelime numarası eskisi gibi çözülür (regresyon yok)', async () => {
    const scan = scanWith([{ id: 30, text: 'Anvil.glb', src: 'ocr', words: [{ t: 'Anvil.glb', x: 10, y: 10, w: 60, h: 20 }] }])
    const { wordCandidates } = await import('../electron/word-targets')
    const aday = wordCandidates(scan as never).find((c) => c.item.text === 'Anvil.glb' && c.wordIndex !== undefined)!
    const { chooseScreenTarget } = await import('../electron/openrouter')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ id: aday.item.id, text: 'Anvil.glb', reason: 'ilk satır' }) } }] }) })))
    const choice = await chooseScreenTarget({ apiKey: 'fake', model: 'valid', prompt: 'Anvil.glb', kind: 'click' as never, stepTitle: 'Tıkla', scan: scan as never, sendImage: false })
    expect(choice.rejected).toBeUndefined()
    expect(choice.id).toBe(30)
    expect(choice.wordIndex).toBe(0)
  })
})

describe('hedef listesi tek numara dünyası taşır', () => {
  it('referanslar numara değil metin/yüzde olarak yazılır', async () => {
    const { describeWordCandidates, wordCandidates } = await import('../electron/word-targets')
    const scan = scanWith([{ id: 7, text: 'Run Remesh', src: 'ocr', words: [{ t: 'Run', x: 10, y: 10, w: 20, h: 20 }, { t: 'Remesh', x: 34, y: 10, w: 40, h: 20 }] }])
    const metin = describeWordCandidates(scan as never, wordCandidates(scan as never), () => {})
    expect(metin).toContain('OCR-word parent-line="Run Remesh"')
    expect(metin).not.toContain('parent=#')
    expect(metin).not.toContain('overlapping-OCR=#')
  })
})
