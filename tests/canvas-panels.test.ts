import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CanvasTabs from '../src/components/CanvasTabs'
import CanvasLibrary from '../src/components/CanvasLibrary'
import { normalizeCanvasBook } from '../electron/graph-types'
import { saveAutomation } from '../electron/canvas-library'
const noop = () => {}
const book = saveAutomation(normalizeCanvasBook({ tabs: [{ id: 'left', name: 'First Canvas', graph: { nodes: [], edges: [] } }, { id: 'right', name: 'Second Canvas', graph: { nodes: [], edges: [] } }] }), 'Model Batch')
const libraryProps = { library: book.library!, disabled: false, onSaveCanvas: noop, onOpenCanvas: noop, onDeleteCanvas: noop, onCreateAutomation: noop, onOpenAutomation: noop, onSaveAutomation: noop, onRenameAutomation: noop, onDeleteAutomation: noop, onExportAutomation: noop, onEditAutomationCanvas: noop }
const tabProps = { tabs: book.tabs, activeId: 'left', disabled: false, running: false, onSelect: noop, onAdd: noop, onClose: noop, onRename: noop, onMove: noop, onRunAll: noop, onStop: noop }
describe('canvas panels render the persisted order and explicit controls', () => {
  it('puts sequence Play and Stop before the leftmost tab', () => {
    const html = renderToStaticMarkup(createElement(CanvasTabs, tabProps))
    expect(html.indexOf('Tuvalleri sırayla oynat')).toBeLessThan(html.indexOf('Tuval sırasını durdur'))
    expect(html.indexOf('Tuval sırasını durdur')).toBeLessThan(html.indexOf('First Canvas'))
    expect(html.indexOf('First Canvas')).toBeLessThan(html.indexOf('Second Canvas'))
  })
  it('shows group children top-to-bottom with save, export and red deletion controls', () => {
    const html = renderToStaticMarkup(createElement(CanvasLibrary, libraryProps))
    expect(html).toContain('Tuvaller'); expect(html).toContain('Otomasyonlar'); expect(html).toContain('Kayıtlı Tuvaller')
    expect(html.indexOf('1. First Canvas')).toBeLessThan(html.indexOf('2. Second Canvas'))
    expect(html).toContain('>Kaydet</button>'); expect(html).toContain('>Export</button>')
    expect(html).toContain('library-mini library-delete')
    expect((html.match(/tuvalini yeni sekmede aç/g) ?? []).length).toBe(4)
  })
  it('disables all library mutations during a run or pending disk write', () => {
    const html = renderToStaticMarkup(createElement(CanvasLibrary, { ...libraryProps, disabled: true }))
    const buttons = html.match(/<button\b[^>]*>/g) ?? []
    expect(buttons.length).toBeGreaterThan(10)
    expect(buttons.every(button => button.includes('disabled=""'))).toBe(true)
  })
  it('keeps Stop enabled while a sequence runs and displays its current canvas', () => {
    const html = renderToStaticMarkup(createElement(CanvasTabs, { ...tabProps, disabled: true, running: true, sequenceLabel: '2/2 · Second Canvas' }))
    expect(html.match(/<button[^>]+aria-label="Tuvalleri sırayla oynat"[^>]*>/)?.[0]).toContain('disabled=""')
    expect(html.match(/<button[^>]+aria-label="Tuval sırasını durdur"[^>]*>/)?.[0]).not.toContain('disabled')
    expect(html).toContain('2/2 · Second Canvas')
  })
})
