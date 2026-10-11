// @vitest-environment jsdom
import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('react-dom',()=>({createPortal:(children:unknown)=>children}))
import LibraryTree from '../src/components/LibraryTree'
import WorkspaceNameDialog from '../src/components/WorkspaceNameDialog'
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
  const event=()=>({preventDefault:()=>{},stopPropagation:()=>{},clientX:10,clientY:10})
  const context=async(entry?:number)=>{await act(async()=>{if(entry!==undefined)renderer.root.findAllByProps({className:'automation-entry'})[entry].props.onContextMenu(event());else renderer.root.findByType(LibraryTree).props.onContext(event())})}
  const click = async (name: string) => {
    if(name==='Genişlet'||name==='Daralt'){await act(async()=>renderer.root.findByType(LibraryTree).props.onOpen({kind:'automation',id:book.library!.automations[0].id}));return}
    if(name==='+ Yeni'){await context();name='Yeni Otomasyon'}
    if(name==='Tuval Deposu')name='Tuvaller'
    if(name==='Yeniden Yükle')await context()
    const b=button(name);expect(b,name).toBeDefined();expect(b.props.disabled,name).not.toBe(true);await act(async()=>{await b.props.onClick()})
  }
  const add=async(id:string)=>{await click('Tuval Ekle…');await act(async()=>renderer.root.findAllByType(LibraryTree).at(-1)!.props.onSelect([{kind:'canvas',id}]));await click('Ekle')}
  const rename=async(name:string)=>{await context();await click('Yeniden Adlandır…');await act(async()=>renderer.root.findByType(WorkspaceNameDialog).props.onAnswer(name))}
  const entryAction=async(i:number,label:string)=>{await context(i);await click(label)}
  return { renderer, click, add, button, rename, entryAction, get book() { return book }, get saves() { return saves }, set confirm(value: boolean) { confirm = value },
    reviewClose: () => reviewClose!(),
    set saveOverride(value: ((draft: AutomationDraft) => Promise<CanvasAutomation | null>) | undefined) { saveOverride = value },
    mutate(fn: (b: CanvasBook) => CanvasBook) { act(() => { book = fn(book); renderer.update(createElement(CanvasLibrary, props())) }) } }

}

describe('automation containers use explicit Save and recoverable drafts', () => {
  it('holds a membership edit until explicit Save', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('Genişlet'); await h.add('B')
    expect(h.saves).toBe(0); expect(h.book.library!.automations[0].entries).toHaveLength(1)
    await h.click('Kaydet')
    expect(automationCanvases(h.book, h.book.library!.automations[0].id).map(c => c.name)).toEqual(['A', 'B'])
    expect(h.saves).toBe(1); expect(h.book.library!.canvases).toHaveLength(3)
    expect(text(h.renderer.root)).toContain('Kayıt güncel.')
    expect(h.button('Kaydet').props.disabled).toBe(true)
  })
  it('retains the stored list when switching panels or collapsing it', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('Genişlet'); await h.add('B')
    await h.click('Tuval Deposu'); await h.click('Otomasyonlar'); await h.click('Daralt'); await h.click('Genişlet')
    expect(h.saves).toBe(0)
    await h.click('Kaydet')
    expect(text(h.renderer.root).replace(/\s+/g,'')).toContain('2.B')
    expect(h.book.library!.automations[0].entries).toHaveLength(2)
  })
  it('creates a draft and saves an empty container only when requested', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('+ Yeni')
    expect(h.book.library!.automations).toHaveLength(1)
    await h.click('Kaydet')
    expect(h.book.library!.automations.map(a => a.name)).toEqual(['Models', 'Otomasyon 1'])
    await h.add('B'); await h.click('Kaydet'); expect(h.book.library!.automations[1].entries[0].canvasId).toBe('B')
  })
  it('saves membership removal without deleting the shared canvas', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('Genişlet')
    await h.entryAction(0,'Listeden Çıkar')
    expect(h.book.library!.automations[0].entries).toHaveLength(1)
    await h.click('Kaydet')
    expect(h.book.library!.automations[0].entries).toEqual([])
    expect(h.book.library!.canvases.map(c => c.name)).toEqual(['A', 'B', 'C'])
  })
  it('a failed write retains the attempted list and provides a retry', async () => {
    const h = setup(true); await h.click('Otomasyonlar'); await h.click('Genişlet'); await h.add('B'); await h.click('Kaydet')
    expect(text(h.renderer.root)).toContain('Değişiklik kaydedilemedi.')
    expect(text(h.renderer.root).replace(/\s+/g,'')).toContain('2.B')
    expect(h.book.library!.automations[0].entries).toHaveLength(1)
    expect(h.button('Tekrar Dene').props.disabled).toBe(false)
    await h.click('Tekrar Dene'); expect(h.saves).toBe(2)
  })
  it('blocks a stale failed edit from overwriting a newer container', async () => {
    const h = setup(true); await h.click('Otomasyonlar'); await h.click('Genişlet'); await h.add('B'); await h.click('Kaydet')
    h.mutate(b => deleteSavedCanvas(b, 'A'))
    expect(text(h.renderer.root)).toContain('Kayıt değişti veya silindi.')
    expect(h.button('Tekrar Dene').props.disabled).toBe(true)
    await h.click('Yeniden Yükle'); expect(text(h.renderer.root).replace(/\s+/g,'')).not.toContain('2.B')
    expect(h.saves).toBe(1)
  })
  it('excludes already-added members and prevents duplicate adds', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('Genişlet'); await h.add('B')
    await h.click('Tuval Ekle…')
    expect(h.renderer.root.findAllByType(LibraryTree).at(-1)!.props.library.canvases.map((c:{id:string})=>c.id)).toEqual(['C'])
    expect(h.button('Ekle').props.disabled).toBe(true)
  })
  it('locks changes until an asynchronous explicit Save is acknowledged', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('Genişlet')
    let release!: (value: null) => void
    h.saveOverride = () => new Promise(resolve => { release = resolve })
    await h.add('B')
    await act(async () => { h.button('Kaydet').props.onClick() })
    expect(h.renderer.root.findByType(LibraryTree).props.disabled).toBe(true)
    expect(h.button('Tuval Ekle…').props.disabled).toBe(true)
    await act(async () => release(null))
    expect(h.button('Tekrar Dene').props.disabled).toBe(false)
  })
  it('keeps name and order edits in the same draft until Save', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('Genişlet'); await h.add('B')
    await h.rename('Renamed')
    expect(h.book.library!.automations[0].name).toBe('Models')
    await h.entryAction(1,'Yukarı Taşı')
    expect(h.saves).toBe(0)
    await h.click('Kaydet')
    expect(h.book.library!.automations[0].name).toBe('Renamed')
    expect(automationCanvases(h.book, h.book.library!.automations[0].id).map(c => c.name)).toEqual(['B', 'A'])
  })
  it('flushes an unfinished name on close and blocks closure when the write fails', async () => {
    const h = setup(); await h.click('Otomasyonlar'); await h.click('Genişlet')
    await h.rename('Pending name')
    await act(async () => { expect(await h.reviewClose()).toBe(true) })
    expect(h.book.library!.automations[0].name).toBe('Pending name')
    h.saveOverride = async () => null
    await h.rename('Failed name')
    await act(async () => { expect(await h.reviewClose()).toBe(false) })
    expect(h.book.library!.automations[0].name).toBe('Pending name')
  })
})
