import { describe, expect, it } from 'vitest'
import { resumeItemMismatch } from '../electron/tools'

describe('hatadan devam: kayıtlı öğe denetimi', () => {
  it('aynı öğe: engel yok', () => {
    expect(resumeItemMismatch({ title: 'Grup', index: 2, item: 'b.png' }, 'b.png')).toBeUndefined()
  })

  it('liste değişmiş: açık ret, indeks 1 tabanlı ve öğe adları görünür', () => {
    const message = resumeItemMismatch({ title: 'Grup', index: 2, item: 'b.png' }, 'c.png')
    expect(message).toContain('Liste değişmiş')
    expect(message).toContain('3. öğesi')
    expect(message).toContain('c.png')
    expect(message).toContain('b.png')
  })

  it('klasör kutusunda öğe koşu anında doluyorsa (bilinmiyor) engellemez — ana senaryo', () => {
    expect(resumeItemMismatch({ title: 'Grup', index: 0, item: 'a.png' }, undefined)).toBeUndefined()
    expect(resumeItemMismatch({ title: 'Grup', index: 0, item: 'a.png' }, '')).toBeUndefined()
    expect(resumeItemMismatch({ title: 'Grup', index: 0, item: 'a.png' }, '   ')).toBeUndefined()
  })

  it('kayıtlı öğe yoksa karşılaştırma yapılmaz', () => {
    expect(resumeItemMismatch({ title: 'Grup', index: 0 }, 'a.png')).toBeUndefined()
  })
})
