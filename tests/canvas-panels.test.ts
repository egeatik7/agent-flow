import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
// The mascot requires a browser document; it is unrelated to panel placement.
vi.mock('../src/components/NubboMascot', () => ({ default: () => null }))
import CanvasTabs from '../src/components/CanvasTabs'
import CanvasLibrary from '../src/components/CanvasLibrary'
import SidePanel from '../src/components/SidePanel'
import { DEFAULT_SETTINGS, normalizeCanvasBook } from '../electron/graph-types'
const noop = () => {}
const book = normalizeCanvasBook({ tabs: [{ id: 'left', name: 'First Canvas', graph: { nodes: [], edges: [] } }, { id: 'right', name: 'Second Canvas', graph: { nodes: [], edges: [] } }] })
const libraryProps = { library: book.library!, tabs: book.tabs, disabled: false, onConfirm: async () => true, onSaveCanvas: noop, onOpenCanvas: noop, onCloseCanvas: noop, onRenameCanvas: async () => true, onDeleteCanvas: noop, onOpenAutomation: noop, onSaveAutomation: async () => null, onDeleteAutomation: noop, onExportAutomation: noop }
const tabProps = { tabs: book.tabs, activeId: 'left', disabled: false, running: false, onSelect: noop, onAdd: noop, onClose: noop, onRename: noop, onMove: noop, onRunAll: noop, onStop: noop }
const sideProps: ComponentProps<typeof SidePanel> = { tab: 'canvases', onTab: noop, canvasPanel: createElement(CanvasLibrary, libraryProps), settings: DEFAULT_SETTINGS, setSettings: noop, onSaveSettings: noop, windows: [], onRefreshWindows: noop, models: [], onLoadModels: noop, onTestApi: noop, onTestVision: noop, graph: book.tabs[0].graph, selected: null, selectedEdge: null, onUpdateNode: noop, onDeleteNode: noop, onDeleteEdge: noop, onCaptureForNode: noop, onOpenScanner: noop, onFillFromFolder: noop, onLoopFolder: noop, onEnterPackage: noop, onUnpackPackage: noop, onUpdatePackaged: noop, onPickDir: async () => null, capturing: 0 }
describe('canvas library is a peer side-panel tab, not a separate fixed panel', () => {
  it('renders Tuvaller alongside Node, LLM, Ayarlar and Ajan', () => {
    const html = renderToStaticMarkup(createElement(SidePanel, sideProps))
    expect(html).toContain('tab active">Tuvaller</button>')
    for (const label of ['Node', 'LLM', 'Ayarlar', 'Ajan']) expect(html).toContain(`>${label}</button>`)
    expect(html).toContain('Tuval klasörleri')
    expect(html).toContain('aria-label="Tuval yönetimi"')
    expect(html).toContain('>Otomasyonlar</button>')
  })
  it('retains the mounted library under other tabs so an unsaved draft is not discarded', () => {
    const html = renderToStaticMarkup(createElement(SidePanel, { ...sideProps, tab: 'node' }))
    expect(html).toContain('canvas-tab-content" style="display:none"')
    expect(html).toContain('Tuval klasörleri')
  })
  it('shows a clean tree without per-row settings columns', () => {
    const html=renderToStaticMarkup(createElement(CanvasLibrary,libraryProps))
    expect(html).toContain('First Canvas');expect(html).toContain('role="treeitem"')
    expect(html).not.toContain('library-mini');expect(html).not.toContain('>Kapat</button>')
  })
  it('disables drag while busy and keeps read-only navigation available',()=>{
    const html=renderToStaticMarkup(createElement(CanvasLibrary,{...libraryProps,disabled:true}))
    expect(html).not.toContain('draggable="true"');expect(html).toContain('role="tab"')
  })
  it('sequence Play and Stop stay before the tabs with Stop enabled during a run', () => {
    const html = renderToStaticMarkup(createElement(CanvasTabs, { ...tabProps, disabled: true, running: true, sequenceLabel: '2/2 · Second Canvas' }))
    expect(html.indexOf('Tuvalleri sırayla oynat')).toBeLessThan(html.indexOf('First Canvas'))
    expect(html.match(/<button[^>]+aria-label="Tuvalleri sırayla oynat"[^>]*>/)?.[0]).toContain('disabled=""')
    expect(html.match(/<button[^>]+aria-label="Tuval sırasını durdur"[^>]*>/)?.[0]).not.toContain('disabled')
    expect(html).toContain('2/2 · Second Canvas')
  })
})
