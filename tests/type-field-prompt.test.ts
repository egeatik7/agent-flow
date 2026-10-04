import { describe, expect, it } from 'vitest'
import { describeTypeChoice, type TypeChoiceInfo } from '../electron/openrouter'

// FolderBatcher: a classic Win32 form. UIA reports every control as a Pane; the edit boxes keep their
// text in the UIA name ("20", "0", "*") and offer no ValuePattern. Values below are what the worker reads.
const kaynak: TypeChoiceInfo = { id: 1, window: 'Dosya Klasörleyici', type: 'Pane', native: 'Edit', name: '', value: '', valueKnown: true, label: 'Kaynak klasör', clicked: false, related: true }
const grup: TypeChoiceInfo = { id: 3, window: 'Dosya Klasörleyici', type: 'Pane', native: 'Edit', name: '20', value: '20', valueKnown: true, label: 'Grup boyutu', clicked: false, related: false }

describe('modele giden alan tanımı', () => {
  it('klasik Win32 kutusunu "Pane" değil gerçek sınıfıyla anlatır ve yazılabilir olduğunu söyler', () => {
    const line = describeTypeChoice(kaynak)
    expect(line).toContain('Edit box (UIA says Pane)')
    expect(line).toContain('writable')
  })

  it('satırdaki başlığı (etiketi) gösterir', () => {
    expect(describeTypeChoice(kaynak)).toContain('caption "Kaynak klasör"')
    expect(describeTypeChoice(grup)).toContain('caption "Grup boyutu"')
  })

  it('tıklanan etiketin kutusunu işaretler, diğerini işaretlemez', () => {
    expect(describeTypeChoice(kaynak)).toContain('The caption that was clicked belongs to this field.')
    expect(describeTypeChoice(grup)).not.toContain('clicked belongs')
  })

  it('içeriği olan kutuya "currently empty" demez ve içeriği ad (name) diye de tekrarlamaz', () => {
    const line = describeTypeChoice(grup)
    expect(line).toContain('text "20"')
    expect(line).not.toContain('empty')
    expect(line).not.toContain('name "20"')
  })

  it('gerçekten boş kutuya "empty" der', () => {
    expect(describeTypeChoice(kaynak)).toContain(' empty')
  })

  it('okunamayan içeriğe "boş" değil "unknown" der', () => {
    const line = describeTypeChoice({ ...kaynak, value: '', valueKnown: false })
    expect(line).toContain('text unknown')
    expect(line).not.toContain(' empty')
  })

  it('doğrudan tıklanan alanı işaretler', () => {
    expect(describeTypeChoice({ ...grup, clicked: true })).toContain('The click landed in this field.')
  })

  it('eski worker alanları (native, label, valueKnown) göndermese de çalışır', () => {
    const line = describeTypeChoice({ id: 2, window: 'Çalıştır', type: 'Edit', name: 'Aç:', value: '', clicked: false })
    expect(line).toContain('2. Window "Çalıştır" — Edit, writable,')
    expect(line).toContain('name "Aç:"')
    expect(line).toContain(' empty')
  })
})
