// @vitest-environment jsdom
// 1.9.96 arayüz düzeltmeleri (tur 3): katalog yazımı başarısızken sahte başarı yok, Başlangıç
// silinmez, gezginde Enter tek açma, sekme klavye erişimi ve kapsam değişiminde yeniden tarama.
import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNode, DEFAULT_SETTINGS, normalizeCanvasBook, type AgentGraph, type CanvasBook } from '../electron/graph-types'
import type { ScanResult } from '../electron/matcher'
import CanvasLibrary from '../src/components/ZipCanvasLibrary'
import { withZipFixture } from './helpers/zip-fixture'
import { zipDocumentFor } from '../electron/zip-workspace'
import type { ZipLibraryAction } from '../electron/zip-library-api'
import CanvasTabs, { type CanvasTabItem } from '../src/components/CanvasTabs'
import NodeCanvas from '../src/components/NodeCanvas'
import NodeNavigator from '../src/components/NodeNavigator'
import ScreenScanner from '../src/components/ScreenScanner'

// Uygulama kabuğunun parçaları testte yalnız yer tutar; düzeltilen bileşenler GERÇEK render edilir.
vi.mock('../src/components/TitleBar', () => ({ default: () => null }))
vi.mock('../src/components/Toolbar', () => ({ default: () => null }))

/** react-test-renderer host ref'leri için ölçüm/olay yüzeyi. */
const nodeMock = () => ({
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, x: 0, y: 0, toJSON: () => ({}) }),
  addEventListener: () => {}, removeEventListener: () => {}, focus: () => {}, blur: () => {}, select: () => {},
  scrollIntoView: () => {},
  contains: () => false, clientWidth: 900, clientHeight: 600, scrollLeft: 0, scrollTop: 0,
  setPointerCapture: () => {}, releasePointerCapture: () => {}, style: {},
})
const options = { createNodeMock: nodeMock }

const text = (node: ReactTestInstance): string =>
  node.children.map((c) => (typeof c === 'string' ? c : text(c))).join('')

const key = (k: string) => ({ key: k, preventDefault: () => {}, stopPropagation: () => {} })

describe('1) katalog yazılamadıysa sahte başarı ve ilerleyen taban yok', () => {
  let App: typeof import('../src/App').default
  let renderer: ReactTestRenderer | undefined
  let seed: CanvasBook
  let conflict = false
  let libraryError: string | undefined
  const writes: CanvasBook[] = []
  const api = {
    getSettings: async () => DEFAULT_SETTINGS,
    getCanvases: async () => structuredClone(seed),
    saveCanvases: async (book: CanvasBook) => {
      writes.push(structuredClone(book))
      if (libraryError) return { conflict: false, libraryError }
      if (conflict) return { conflict: true }
      return true
    },
    zipLibraryAction: async (action: ZipLibraryAction) => {
      if (libraryError) throw Error('Kütüphane yazılamadı: '+libraryError)
      if (conflict) throw Error('ZIP grubu değişti; yeniden yükle ve tekrar dene.')
      if (action.action !== 'saveCanvas') throw Error('Unexpected action')
      const canvas = zipDocumentFor(action.tab)
      const library = structuredClone(seed.zipLibrary!)
      library.groups[0].canvases = [canvas]
      return {library,canvas}
    },
    listWindows: async () => [], bootReady: () => {}, manageLibrary: vi.fn(),
    onCloseRequested: () => () => {}, finishClose: async () => {},
    onAgentLog: () => () => {}, onAgentStep: () => () => {}, onAgentEdge: () => () => {}, onAgentPatch: () => () => {},
  }

  beforeAll(async () => {
    Object.defineProperty(window, 'xpAgent', { configurable: true, value: api })
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 0 })
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: () => {} })
    App = (await import('../src/App')).default
  })
  beforeEach(() => {
    vi.useFakeTimers()
    conflict = false; libraryError = undefined; writes.length = 0
    seed = withZipFixture(normalizeCanvasBook({activeId:'',tabs:[{id:'saved',name:'Shared',graph:{nodes:[createNode('start',0,0)],edges:[]}}]}))

  })
  afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; vi.useRealTimers() })
  afterAll(() => { delete (window as unknown as { xpAgent?: unknown }).xpAgent; vi.unstubAllGlobals() })

  const menuClick = async (label: string) => {
    const target = renderer!.root.findAllByType('button').find((b) => text(b).startsWith(label))
    expect(target, label).toBeDefined()
    await act(async () => { await target!.props.onClick() })
  }
  const openCanvasAndEdit = async () => {
    await act(async () => { renderer = create(createElement(App), options) })
    const lib = renderer!.root.findByType(CanvasLibrary)
    await act(async () => { lib.props.onOpenCanvas(seed.zipLibrary!.groups[0].canvases[0].canvasId) })
    const graph = renderer!.root.findByType(NodeCanvas).props.graph as AgentGraph
    await act(async () => { renderer!.root.findByType(NodeCanvas).props.onMoveNodes({ [graph.nodes[0].id]: { x: 77, y: 0 } }) })
    expect(renderer!.root.findByType(CanvasTabs).props.tabs[0].dirty).toBe(true)
  }
  const saveOpenCanvas = async () => { await menuClick('Dosya'); await menuClick('Tuvali Kaydet') }

  it('automatic session payload never copies the complete ZIP library into IPC/profile writes', async () => {
    await openCanvasAndEdit()
    await act(async()=>{await vi.advanceTimersByTimeAsync(500)})
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.every(w=>!Object.prototype.hasOwnProperty.call(w,'zipLibrary'))).toBe(true)
    expect(writes.at(-1)!.tabs).toHaveLength(1)
    expect(seed.zipLibrary!.groups[0].canvases).toHaveLength(1)
  })

  it('çakışma yanıtında başarı mesajı çıkmaz, sekme kirli kalır', async () => {
    await openCanvasAndEdit()
    conflict = true
    await saveOpenCanvas()
    const shown = text(renderer!.root)
    expect(shown).not.toContain("Tuvaller'e kaydedildi")
    expect(shown).toContain('ZIP grubu değişti')
    expect(shown).toContain('yeniden yükle')
    expect(renderer!.root.findByType(CanvasTabs).props.tabs[0].dirty).toBe(true)
  })

  it('libraryError yanıtında açık uyarı yazılır, başarı mesajı çıkmaz ve sekme kirli kalır', async () => {
    await openCanvasAndEdit()
    libraryError = 'disk dolu'
    await saveOpenCanvas()
    const shown = text(renderer!.root)
    expect(shown).not.toContain("Tuvaller'e kaydedildi")
    expect(shown).toContain('Kütüphane yazılamadı: disk dolu')
    expect(renderer!.root.findByType(CanvasTabs).props.tabs[0].dirty).toBe(true)
  })

  it('başarılı yazımda eski davranış korunur: başarı mesajı ve temiz sekme', async () => {
    await openCanvasAndEdit()
    await saveOpenCanvas()
    const shown = text(renderer!.root)
    expect(shown).toContain("“Shared” ZIP’e kaydedildi")
    expect(renderer!.root.findByType(CanvasTabs).props.tabs[0].dirty).toBe(false)
  })

  it('Başlangıç node silme isteği uygulanmaz ve kullanıcıya uyarı düşer', async () => {
    await openCanvasAndEdit()
    const graph = renderer!.root.findByType(NodeCanvas).props.graph as AgentGraph
    const startId = graph.nodes[0].id
    await act(async () => { renderer!.root.findByType(NodeCanvas).props.onDeleteNode(startId) })
    const after = renderer!.root.findByType(NodeCanvas).props.graph as AgentGraph
    expect(after.nodes.map((n) => n.id)).toContain(startId)
    expect(text(renderer!.root)).toContain('Başlangıç node’u silinemez')
  })
})

describe('2) Başlangıç node’u için “Sil” yok', () => {
  let renderer: ReactTestRenderer | undefined
  const canvasProps = (graph: AgentGraph, over: Record<string, unknown> = {}) => ({
    graph,
    selectedNodeId: null as string | null, selectedIds: [] as string[], selectedEdgeId: null,
    stepStatus: {}, running: false,
    onSelectNode: () => {}, onSelectMany: () => {}, onSelectEdge: () => {}, onMoveNodes: () => {},
    onSetMembership: () => {}, onWrap: () => {}, onConnect: () => {}, onAddAfter: () => {}, onAddAt: () => {},
    onDeleteNode: () => {}, onDeleteEdge: () => {}, onDuplicate: () => {}, onRunFrom: () => {},
    onEnterPackage: () => {}, onUnpackPackage: () => {},
    ...over,
  }) as React.ComponentProps<typeof NodeCanvas>

  const mount = (graph: AgentGraph, over: Record<string, unknown> = {}) => {
    act(() => { renderer = create(createElement(NodeCanvas, canvasProps(graph, over)), options) })
  }
  const nodeEl = (kind: string) => renderer!.root.findAll((n) =>
    typeof n.type === 'string' && String(n.props.className ?? '').includes(`kind-${kind}`))[0]
  const openMenu = (el: ReactTestInstance) => act(() => {
    el.props.onContextMenu({ preventDefault: () => {}, stopPropagation: () => {}, clientX: 120, clientY: 90 })
  })
  const menu = () => renderer!.root.findAll((n) => String(n.props.className ?? '') === 'ctx-menu')[0]
  const menuLabels = () => menu().findAllByType('button').map(text)

  afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined })

  it('start node’un bağlam menüsünde Sil yok; normal node’da Sil var', () => {
    const g: AgentGraph = { nodes: [createNode('start', 0, 0), createNode('click', 300, 0)], edges: [] }
    const deleted: string[] = []
    mount(g, { onDeleteNode: (id: string) => deleted.push(id) })
    openMenu(nodeEl('start'))
    expect(menuLabels()).not.toContain('Sil')
    expect(menuLabels()).toContain('▶ Buradan çalıştır')
    openMenu(nodeEl('click'))
    expect(menuLabels()).toContain('Sil')
    act(() => { menu().findAllByType('button').find((b) => text(b) === 'Sil')!.props.onClick() })
    expect(deleted).toEqual([g.nodes[1].id])
  })

  it('çoklu seçimde Sil, Başlangıç’ı atlar', () => {
    const g: AgentGraph = { nodes: [createNode('start', 0, 0), createNode('click', 300, 0)], edges: [] }
    const deleted: string[] = []
    mount(g, { selectedIds: g.nodes.map((n) => n.id), onDeleteNode: (id: string) => deleted.push(id) })
    openMenu(nodeEl('click'))
    act(() => { menu().findAllByType('button').find((b) => text(b) === 'Sil')!.props.onClick() })
    expect(deleted).toEqual([g.nodes[1].id])
  })

  it('loop etiketi korunur', () => {
    const g: AgentGraph = { nodes: [createNode('start', 0, 0), createNode('loop', 300, 0)], edges: [] }
    mount(g)
    const head = renderer!.root.findAll((n) => String(n.props.className ?? '') === 'loop-frame-head')[0]
    openMenu(head)
    expect(menuLabels()).toContain('Kutuyu sil (içindekiler kalır)')
  })
})

describe('3) gezginde Enter tek açma üretir', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined })

  const mount = (graph: AgentGraph, seen: [string, boolean][]) => {
    act(() => {
      renderer = create(createElement(NodeNavigator, { graph, onNavigate: (id, inspect) => seen.push([id, inspect]) }), options)
    })
    return renderer!.root.findAll((n) => n.type === 'button' && String(n.props.className ?? '').startsWith('navigator-node'))
  }

  it('Enter’dan sonra gelen native click yok sayılır; sonraki fare tıklaması çalışır', () => {
    const g: AgentGraph = { nodes: [createNode('start', 0, 0), createNode('click', 300, 0)], edges: [] }
    const seen: [string, boolean][] = []
    const rows = mount(g, seen)
    const clickId = g.nodes[1].id
    act(() => { rows[1].props.onKeyDown({ ...key('Enter'), ctrlKey: false, metaKey: false }) })
    expect(seen).toEqual([[clickId, false]])
    act(() => { rows[1].props.onClick({ detail: 1 }) })
    expect(seen).toHaveLength(1)
    act(() => { rows[1].props.onClick({ detail: 1 }) })
    expect(seen).toEqual([[clickId, false], [clickId, false]])
  })

  it('başka satıra yapılan fare tıklaması bastırılmaz', () => {
    const g: AgentGraph = { nodes: [createNode('start', 0, 0), createNode('click', 300, 0)], edges: [] }
    const seen: [string, boolean][] = []
    const rows = mount(g, seen)
    act(() => { rows[0].props.onKeyDown({ ...key('Enter'), ctrlKey: false, metaKey: false }) })
    act(() => { rows[1].props.onClick({ detail: 1 }) })
    expect(seen).toEqual([[g.nodes[0].id, false], [g.nodes[1].id, false]])
  })

  it('tek tık tek açma, çift tık ayarları açar', () => {
    const g: AgentGraph = { nodes: [createNode('click', 0, 0)], edges: [] }
    const seen: [string, boolean][] = []
    const rows = mount(g, seen)
    act(() => { rows[0].props.onClick({ detail: 1 }) })
    expect(seen).toEqual([[g.nodes[0].id, false]])
    act(() => { rows[0].props.onDoubleClick() })
    expect(seen).toEqual([[g.nodes[0].id, false], [g.nodes[0].id, true]])
  })
})

describe('4) tuval sekmeleri klavye ile erişilebilir', () => {
  let renderer: ReactTestRenderer | undefined
  const tabs: CanvasTabItem[] = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]
  let seen: string[] = []

  const element = (activeId: string, disabled = false) => createElement(CanvasTabs, {
    tabs, activeId, disabled, onSelect: (id: string) => seen.push(id), onAdd: () => {}, onClose: () => {},
    onRename: () => {}, onRunAll: () => {}, onStop: () => {}, running: false,
  })
  const tabEls = () => renderer!.root.findAll((n) =>
    typeof n.type === 'string' && String(n.props.className ?? '').split(' ')[0] === 'canvas-tab')
  const mount = (activeId: string, disabled = false) => {
    seen = []
    act(() => { renderer = create(element(activeId, disabled), options) })
    return tabEls()
  }
  const setActive = (activeId: string) => {
    act(() => { renderer!.update(element(activeId)) })
    return tabEls()
  }
  afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined })

  it('aktif sekme tabIndex=0, diğerleri -1', () => {
    const els = mount('b')
    expect(els.map((e) => e.props.tabIndex)).toEqual([-1, 0, -1])
    expect(els.map((e) => e.props.role)).toEqual(['tab', 'tab', 'tab'])
    expect(els.map((e) => e.props['aria-selected'])).toEqual([false, true, false])
  })

  it('ok tuşları komşu sekmeye geçer, Home/End uçlara gider', () => {
    let els = mount('a')
    act(() => { els[0].props.onKeyDown(key('ArrowRight')) })
    expect(seen).toEqual(['b'])
    // Zaten aktif olan komşu yeniden seçilmez, odak oraya taşınır.
    els = setActive('b')
    act(() => { els[2].props.onKeyDown(key('ArrowLeft')) })
    expect(seen).toEqual(['b'])
    act(() => { els[1].props.onKeyDown(key('Home')) })
    expect(seen).toEqual(['b', 'a'])
    els = setActive('a')
    act(() => { els[0].props.onKeyDown(key('End')) })
    expect(seen).toEqual(['b', 'a', 'c'])
    // Uçlarda taşma yok.
    els = setActive('c')
    act(() => { els[2].props.onKeyDown(key('ArrowRight')) })
    els = setActive('a')
    act(() => { els[0].props.onKeyDown(key('ArrowLeft')) })
    expect(seen).toEqual(['b', 'a', 'c'])
  })

  it('Enter ve Space seçer', () => {
    const els = mount('a')
    act(() => { els[1].props.onKeyDown(key('Enter')) })
    act(() => { els[2].props.onKeyDown(key(' ')) })
    expect(seen).toEqual(['b', 'c'])
  })

  it('devre dışıyken odaklanabilir sekme ve klavye gezinmesi yok', () => {
    const els = mount('a', true)
    expect(els.map((e) => e.props.tabIndex)).toEqual([-1, -1, -1])
    act(() => { els[0].props.onKeyDown(key('ArrowRight')) })
    expect(seen).toEqual([])
  })
})

describe('5) kapsam değişince ekran yeniden taranır', () => {
  let renderer: ReactTestRenderer | undefined
  const sonuc = (window: string): ScanResult => ({
    area: { x: 0, y: 0, w: 10, h: 10 }, items: [], ocr: false, uiaCount: 0, ocrCount: 0, image: null, window,
  })
  const mount = (onScan: (w: string) => Promise<ScanResult>) => {
    act(() => {
      renderer = create(createElement(ScreenScanner, {
        targetLabel: 'test', windows: [{ title: 'Notepad', handle: '1' }], defaultWindow: '',
        valueLo: 0, valueHi: 1, onSave: () => {}, onScan, onPick: () => {}, onClose: () => {},
      }), options)
    })
  }
  const scopeSelect = () => renderer!.root.findAll((n) => n.type === 'select' && String(n.props.className ?? '').includes('scope'))[0]
  const changeScope = async (value: string) => {
    await act(async () => { scopeSelect().props.onChange({ target: { value } }) })
  }
  afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined })

  it('açılışta bir kez, kapsam değişince yeni kapsamla bir kez daha tarar', async () => {
    const calls: string[] = []
    mount(async (w) => { calls.push(w); return sonuc(w) })
    await act(async () => {})
    expect(calls).toEqual([''])
    await changeScope('Notepad')
    expect(calls).toEqual(['', 'Notepad'])
  })

  it('tarama sürerken gelen kapsam istekleri tek taramaya indirgenir', async () => {
    const calls: string[] = []
    let release!: (r: ScanResult) => void
    mount((w) => { calls.push(w); return w === '' ? new Promise<ScanResult>((res) => { release = res }) : Promise.resolve(sonuc(w)) })
    await act(async () => {})
    expect(calls).toEqual([''])
    await changeScope('Notepad')
    await changeScope('Paint')
    expect(calls).toEqual([''])
    await act(async () => { release(sonuc('')) })
    expect(calls).toEqual(['', 'Paint'])
  })
})
