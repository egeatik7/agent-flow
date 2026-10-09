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
  let reviewClose: (() => Promise<boolean>) | null = null
  const props = () => ({ library: book.library!, tabs: book.tabs, disabled: false,
    onCloseReview: (review: (() => Promise<boolean>) | null) => { reviewClose = review },
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
    reviewClose: () => reviewClose!(),
    set saveOverride(value: ((draft: AutomationDraft) => Promise<CanvasAutomation | null>) | undefined) { saveOverride = value },
    mutate(fn: (b: CanvasBook) => CanvasBook) { act(() => { book = fn(book); renderer.update(createElement(CanvasLibrary, props())) }) } }
}

describe('automation containers persist edits immediately', () => {
  it('adds a saved canvas immediately without another Save button', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('Genişlet'); await h.add('B')
    expect(automationCanvases(h.book, h.book.library!.automations[0].id).map(c => c.name)).toEqual(['A', 'B'])
    expect(h.saves).toBe(1); expect(h.book.library!.canvases).toHaveLength(3)
    expect(text(h.renderer.root)).toContain('Liste otomatik kaydedildi.')
    expect(h.button('Kaydet')).toBeUndefined()
  })
  it('retains the stored list when switching panels or collapsing it', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('Genişlet'); await h.add('B')
    await h.click('Tuval Deposu'); await h.click('Otomasyonlar'); await h.click('Daralt'); await h.click('Genişlet')
    expect(text(h.renderer.root)).toContain('2. B')
    expect(h.book.library!.automations[0].entries).toHaveLength(2)
  })
  it('creates a named persistent empty container immediately', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('+ Yeni')
    expect(h.book.library!.automations.map(a => a.name)).toEqual(['Models', 'Otomasyon 1'])
    await h.add('B'); expect(h.book.library!.automations[1].entries[0].canvasId).toBe('B')
  })
  it('removes membership immediately while keeping the canvas in the depot', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('Genişlet')
    await act(async () => { h.renderer.root.findByProps({ title: 'Tuvali otomasyon listesinden çıkar' }).props.onClick() })
    expect(h.book.library!.automations[0].entries).toEqual([])
    expect(h.book.library!.canvases.map(c => c.name)).toEqual(['A', 'B', 'C'])
  })
  it('a failed write retains the attempted list and provides a retry', async () => {
    const h = setup(true); await h.click('Otomasyonlar'); await h.click('Genişlet'); await h.add('B')
    expect(text(h.renderer.root)).toContain('Değişiklik kaydedilemedi.')
    expect(text(h.renderer.root)).toContain('2. B')
    expect(h.book.library!.automations[0].entries).toHaveLength(1)
    expect(h.button('Tekrar Dene').props.disabled).toBe(false)
    await h.click('Tekrar Dene'); expect(h.saves).toBe(2)
  })
  it('blocks a stale failed edit from overwriting a newer container', async () => {
    const h = setup(true); await h.click('Otomasyonlar'); await h.click('Genişlet'); await h.add('B')
    h.mutate(b => deleteSavedCanvas(b, 'A'))
    expect(text(h.renderer.root)).toContain('Kayıt değişti veya silindi.')
    expect(h.button('Tekrar Dene').props.disabled).toBe(true)
    await h.click('Yeniden Yükle'); expect(text(h.renderer.root)).not.toContain('2. B')
    expect(h.saves).toBe(1)
  })
  it('excludes already-added members and prevents duplicate adds', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('Genişlet'); await h.add('B')
    const select = h.renderer.root.findByProps({ 'aria-label': 'Depodan tuval seç' })
    expect(select.findAllByType('option').map(o => o.props.value)).toEqual(['', 'C'])
    expect(h.button('Ekle').props.disabled).toBe(true)
  })
  it('locks changes until an asynchronous automatic write is acknowledged', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('Genişlet')
    let release!: (value: null) => void
    h.saveOverride = () => new Promise(resolve => { release = resolve })
    await act(async () => { h.renderer.root.findByProps({ 'aria-label': 'Depodan tuval seç' }).props.onChange({ target: { value: 'B' } }) })
    await act(async () => { h.button('Ekle').props.onClick() })
    expect(h.button('Daralt').props.disabled).toBe(true)
    expect(h.button('Ekle').props.disabled).toBe(true)
    await act(async () => release(null))
    expect(h.button('Tekrar Dene').props.disabled).toBe(false)
  })
  it('automatically persists name edits on blur and order edits immediately', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('Genişlet'); await h.add('B')
    await act(async () => { h.renderer.root.findByProps({ id: 'automation-name' }).props.onChange({ target: { value: 'Renamed' } }) })
    await act(async () => { h.renderer.root.findByProps({ id: 'automation-name' }).props.onBlur() })
    expect(h.book.library!.automations[0].name).toBe('Renamed')
    await act(async () => { h.renderer.root.findAllByProps({ title: 'Yukarı taşı' })[1].props.onClick() })
    expect(automationCanvases(h.book, h.book.library!.automations[0].id).map(c => c.name)).toEqual(['B', 'A'])
  })
  it('flushes an unfinished name on close and blocks closure when the write fails', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('Genişlet')
    await act(async () => { h.renderer.root.findByProps({ id: 'automation-name' }).props.onChange({ target: { value: 'Pending name' } }) })
    await act(async () => { expect(await h.reviewClose()).toBe(true) })
    expect(h.book.library!.automations[0].name).toBe('Pending name')
    h.saveOverride = async () => null
    await act(async () => { h.renderer.root.findByProps({ id: 'automation-name' }).props.onChange({ target: { value: 'Failed name' } }) })
    await act(async () => { expect(await h.reviewClose()).toBe(false) })
    expect(h.book.library!.automations[0].name).toBe('Pending name')
  })
})
