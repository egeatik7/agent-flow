import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import CanvasLibrary from '../src/components/CanvasLibrary'
import { createNode, normalizeCanvasBook, type CanvasBook, type CanvasAutomation } from '../electron/graph-types'
import { automationCanvases, deleteSavedCanvas, saveAutomation, type AutomationDraft } from '../electron/canvas-library'
const mounted: ReactTestRenderer[] = []
afterEach(() => { for (const r of mounted.splice(0)) act(() => r.unmount()) })
const text = (node: ReactTestInstance): string => node.children.map(c => typeof c === 'string' ? c : text(c)).join('')
function setup(failSave = false) {
  let book = normalizeCanvasBook({ tabs: ['A', 'B', 'C'].map(id => ({ id, name: id, graph: { nodes: [createNode('start', 0, 0)], edges: [] } })) })
  book = saveAutomation(book, { name: 'Models', entries: [{ id: 'entry-A', canvasId: 'A' }] })
  let renderer!: ReactTestRenderer, confirm = true, saves = 0
  let saveOverride: ((draft: AutomationDraft) => Promise<CanvasAutomation | null>) | undefined
  const props = () => ({ library: book.library!, tabs: book.tabs, disabled: false,
    onConfirm: async () => confirm, onSaveCanvas: () => {}, onOpenCanvas: () => {}, onCloseCanvas: () => {}, onRenameCanvas: async () => true, onDeleteCanvas: () => {}, onOpenAutomation: () => {}, onDeleteAutomation: () => {}, onExportAutomation: () => {},
    onSaveAutomation: async (draft: AutomationDraft) => {
      saves++
      if (saveOverride) return saveOverride(draft)
      if (failSave) return null
      book = saveAutomation(book, draft)
      renderer.update(createElement(CanvasLibrary, props()))
      return book.library!.automations.find(a => a.id === draft.id) ?? book.library!.automations[book.library!.automations.length - 1]
    } })
  act(() => { renderer = create(createElement(CanvasLibrary, props())) }); mounted.push(renderer)
  const button = (name: string) => renderer.root.findAllByType('button').find(n => text(n) === name)!
  const click = async (name: string) => { const b = button(name); expect(b, name).toBeDefined(); expect(b.props.disabled, name).not.toBe(true); await act(async () => { await b.props.onClick() }) }
  const add = async (id: string) => {
    await act(async () => { renderer.root.findByProps({ 'aria-label': 'Depodan tuval seç' }).props.onChange({ target: { value: id } }) })
    await click('Ekle')
  }
  return { renderer, click, add, button, get book() { return book }, get saves() { return saves }, set confirm(value: boolean) { confirm = value },
    set saveOverride(value: ((draft: AutomationDraft) => Promise<CanvasAutomation | null>) | undefined) { saveOverride = value },
    mutate(fn: (b: CanvasBook) => CanvasBook) { act(() => { book = fn(book); renderer.update(createElement(CanvasLibrary, props())) }) } }
}

describe('automation editor interaction through real React state and callbacks', () => {
  it('adds a previously absent saved canvas and persists only after Save', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('Düzenle'); await h.add('B')
    expect(automationCanvases(h.book, h.book.library!.automations[0].id).map(c => c.name)).toEqual(['A'])
    expect(text(h.renderer.root)).toContain('2. B')
    await h.click('Kaydet')
    expect(automationCanvases(h.book, h.book.library!.automations[0].id).map(c => c.name)).toEqual(['A', 'B'])
    expect(h.saves).toBe(1); expect(h.book.library!.canvases).toHaveLength(3)
    expect(text(h.renderer.root)).toContain('Kayıtlı liste.')
  })
  it('keeps an unsaved list when switching between depot and automations', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('Düzenle'); await h.add('B')
    await h.click('Tuval Deposu'); await h.click('Otomasyonlar')
    expect(text(h.renderer.root)).toContain('2. B')
    expect(text(h.renderer.root)).toContain('Kaydedilmeyen değişiklikler var.')
    expect(h.book.library!.automations[0].entries).toHaveLength(1)
  })
  it('cancels discarding a draft, then discards it only after confirmation', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('Düzenle'); await h.add('B')
    h.confirm = false; await h.click('Vazgeç'); expect(text(h.renderer.root)).toContain('2. B')
    h.confirm = true; await h.click('Vazgeç'); expect(text(h.renderer.root)).not.toContain('2. B')
    expect(h.saves).toBe(0)
  })
  it('stages membership removal with confirmation without deleting the depot entry', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('Düzenle')
    const remove = () => h.renderer.root.findByProps({ title: 'Tuvali otomasyon listesinden çıkar' })
    h.confirm = false; await act(async () => { remove().props.onClick() }); expect(text(h.renderer.root)).toContain('1. A')
    h.confirm = true; await act(async () => { remove().props.onClick() }); expect(text(h.renderer.root)).not.toContain('1. A')
    expect(h.book.library!.automations[0].entries).toHaveLength(1)
    await h.click('Kaydet'); expect(h.book.library!.automations[0].entries).toEqual([])
    expect(h.book.library!.canvases.map(c => c.name)).toEqual(['A', 'B', 'C'])
  })
  it('a failed persistence call cannot clear the dirty draft or claim it was saved', async () => {
    const h = setup(true); await h.click('Otomasyonlar'); await h.click('Düzenle'); await h.add('B'); await h.click('Kaydet')
    expect(text(h.renderer.root)).toContain('Kaydedilmeyen değişiklikler var.')
    expect(text(h.renderer.root)).toContain('2. B')
    expect(h.book.library!.automations[0].entries).toHaveLength(1)
    expect(h.button('Kaydet').props.disabled).toBe(false)
  })
  it('blocks overwriting a group that changed while its dirty draft was open', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('Düzenle'); await h.add('B')
    h.mutate(b => deleteSavedCanvas(b, 'A'))
    expect(text(h.renderer.root)).toContain('Kayıt değişti veya silindi.')
    expect(h.button('Kaydet').props.disabled).toBe(true)
    expect(text(h.renderer.root)).toContain('2. B')
    expect(h.saves).toBe(0)
  })
  it('excludes members already selected and prevents a duplicate add', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('Düzenle'); await h.add('B')
    const select = h.renderer.root.findByProps({ 'aria-label': 'Depodan tuval seç' })
    expect(select.findAllByType('option').map(o => o.props.value)).toEqual(['', 'C'])
    expect(h.button('Ekle').props.disabled).toBe(true)
  })
  it('retains the lock for the duration of an asynchronous save', async () => {
    const h = setup(); let release!: (value: null) => void
    h.saveOverride = () => new Promise(resolve => { release = resolve })
    await h.click('Otomasyonlar'); await h.click('Düzenle'); await h.add('B')
    await act(async () => { h.button('Kaydet').props.onClick() })
    expect(h.button('Kaydet').props.disabled).toBe(true)
    expect(h.button('Düzenle').props.disabled).toBe(true)
    await act(async () => release(null))
    expect(h.button('Kaydet').props.disabled).toBe(false)
    expect(text(h.renderer.root)).toContain('Kaydedilmeyen değişiklikler var.')
  })
})
