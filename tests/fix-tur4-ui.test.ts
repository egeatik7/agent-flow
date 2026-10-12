// @vitest-environment jsdom
// 1.9.98 koşul sözleşmesi (tur 4 arayüz tarafı): koşul node'u artık hedef seçmez. Kutuya yazılan
// düz cümleyi her turda önce UIA, olmazsa birleşik Windows + ONNX OCR okuması üzerinden metin
// modeli değerlendirir. Bu dosya paneli, eski kayıt temizliğini ve App'teki iki seçim yolunu sınar.
import { createElement, type ComponentProps } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createNode,
  DEFAULT_SETTINGS,
  normalizeCanvasBook,
  type AgentGraph,
  type AgentNode,
  type CanvasBook,
  type Locator,
} from '../electron/graph-types'
import type { ScanResult } from '../electron/matcher'
import CanvasLibrary from '../src/components/ZipCanvasLibrary'
import { withZipFixture } from './helpers/zip-fixture'
import NodeCanvas from '../src/components/NodeCanvas'
import ScreenScanner from '../src/components/ScreenScanner'
import SidePanel from '../src/components/SidePanel'

// Uygulama kabuğunun parçaları testte yalnız yer tutar; düzeltilen parçalar GERÇEK render edilir.
vi.mock('../src/components/TitleBar', () => ({ default: () => null }))
vi.mock('../src/components/Toolbar', () => ({ default: () => null }))

const text = (node: ReactTestInstance): string =>
  node.children.map((c) => (typeof c === 'string' ? c : text(c))).join('')

const nodeMock = () => ({
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, x: 0, y: 0, toJSON: () => ({}) }),
  addEventListener: () => {}, removeEventListener: () => {}, focus: () => {}, blur: () => {}, select: () => {},
  scrollIntoView: () => {}, contains: () => false, clientWidth: 900, clientHeight: 600, scrollLeft: 0, scrollTop: 0,
  setPointerCapture: () => {}, releasePointerCapture: () => {}, style: {},
  // TemplateInput (contentEditable alan) yerleşim efektinde bu yüzeyi okur.
  ownerDocument: { activeElement: null, createTextNode: () => ({}), getSelection: () => null }, replaceChildren: () => {}, append: () => {},
})
const options = { createNodeMock: nodeMock }

const legacyLocator = (): Locator => ({ name: 'Kaydet', controlType: 'Button', path: '', automationId: 'save', windowTitle: 'Fixture', text: 'Kaydet' })

describe('1) koşul panelinde hedef seçimi yok', () => {
  let mounted: ReactTestRenderer | undefined
  afterEach(() => { if (mounted) act(() => mounted!.unmount()); mounted = undefined })

  const sideProps = (n: AgentNode, over: Record<string, unknown> = {}) => ({
    tab: 'node' as const,
    settings: structuredClone(DEFAULT_SETTINGS),
    setSettings: vi.fn(), onSaveSettings: vi.fn(), onTab: vi.fn(),
    windows: [], onRefreshWindows: vi.fn(), models: [], onLoadModels: vi.fn(), onTestApi: vi.fn(), onTestVision: vi.fn(),
    graph: { nodes: [n], edges: [] } as AgentGraph, selected: n, selectedEdge: null,
    onUpdateNode: vi.fn(), onDeleteNode: vi.fn(), onDeleteEdge: vi.fn(),
    onCaptureForNode: vi.fn(), onOpenScanner: vi.fn(),
    onFillFromFolder: vi.fn(), onLoopFolder: vi.fn(), onEnterPackage: vi.fn(), onUnpackPackage: vi.fn(),
    onUpdatePackaged: vi.fn(), onPickDir: async () => null, capturing: 0,
    ...over,
  }) as unknown as ComponentProps<typeof SidePanel>

  const mount = (p: ComponentProps<typeof SidePanel>) => { act(() => { mounted = create(createElement(SidePanel, p), options) }) }
  const buttons = () => mounted!.root.findAllByType('button').map(text)
  const labels = () => mounted!.root.findAllByType('label').map(text)
  const editor = () => mounted!.root.findAll((x) => x.props['data-template-editor'])[0]
  const field = (start: string) => mounted!.root
    .findAll((x) => typeof x.type === 'string' && String(x.props.className ?? '').split(' ').includes('field'))
    .find((f) => { const l = f.findAllByType('label')[0]; return l ? text(l).startsWith(start) : false })!

  it('(a) “Hedef” kutusu, “Ekrandan Seç”, “İmleçle Yakala” ve “Temizle” gösterilmez', () => {
    mount(sideProps(createNode('condition', 0, 0)))
    expect(labels()).not.toContain('Hedef')
    const shown = buttons()
    expect(shown).not.toContain('Ekrandan Seç')
    expect(shown).not.toContain('Temizle')
    expect(shown.some((b) => b.includes('İmleçle Yakala'))).toBe(false)
  })

  it('(a2) kutu düz cümle örneği taşır; tırnaklı örnek yok', () => {
    mount(sideProps(createNode('condition', 0, 0)))
    expect(editor().props['aria-label']).toBe('Ekranda ne aradığını yaz (değerlendirmeyi model yapar)')
    const placeholder = String(editor().props['data-placeholder'] ?? '')
    expect(placeholder).toContain('kaydet düğmesi ekranda göründü mü')
    expect(placeholder).not.toContain('"')
    // Pencere ve süre alanları korunur.
    expect(field('Pencere / uygulama bağlamı')).toBeDefined()
    expect(labels().some(s => s.includes('Görünene kadar bekle'))).toBe(false)
  })

  it('(b) eski locator’lı ve boş kutulu koşulda bilgi notu çıkar; basınca locator silinir', () => {
    const n: AgentNode = { ...createNode('condition', 0, 0), text: '', locator: legacyLocator() }
    const onUpdateNode = vi.fn()
    mount(sideProps(n, { onUpdateNode }))
    const clear = mounted!.root.findAllByType('button').find((b) => text(b) === 'Eski seçimi temizle')
    expect(clear).toBeDefined()
    expect(text(mounted!.root)).toContain('Uyumsuz eski koşul')
    act(() => clear!.props.onClick())
    expect(onUpdateNode).toHaveBeenCalledWith({ locator: undefined, anchor: undefined })
    // Temizleme dışında hiçbir seçim yazımı yapılmaz.
    expect(onUpdateNode).toHaveBeenCalledTimes(1)
  })

  it('(b2) kutu dolu olsa da eski seçim uyarısı gösterilir', () => {
    const n: AgentNode = { ...createNode('condition', 0, 0), text: 'kaydet düğmesi göründü mü', locator: legacyLocator() }
    mount(sideProps(n))
    expect(mounted!.root.findAllByType('button').find((b) => text(b) === 'Eski seçimi temizle')).toBeDefined()
  })

  it('(d) Tıkla ve Yazı Yaz node’unda seçim düğmeleri hâlâ var', () => {
    for (const kind of ['click', 'type'] as const) {
      mount(sideProps(createNode(kind, 0, 0)))
      const shown = buttons()
      expect(shown, kind).toContain('Ekrandan Seç')
      expect(shown.some((b) => b.includes('İmleçle Yakala')), kind).toBe(true)
      expect(labels(), kind).toContain('Hedef')
    }
  })

  it('(e) metin, pencere ve süre alanları node’a yazılır', () => {
    const onUpdateNode = vi.fn()
    mount(sideProps(createNode('condition', 0, 0), { onUpdateNode }))
    act(() => mounted!.root.findAllByType('button').find((b) => text(b) === '{{sıra}}')!.props.onClick())
    expect(onUpdateNode).toHaveBeenCalledWith({ text: '{{sıra}}' })
    act(() => field('Pencere / uygulama bağlamı').findAllByType('input')[0].props.onChange({ target: { value: 'Blender' } }))
    expect(onUpdateNode).toHaveBeenCalledWith({ conditionWindow: 'Blender' })
    expect(onUpdateNode.mock.calls.some(([patch]) => 'timeoutMs' in patch)).toBe(false)
  })
})

describe('2) App: koşul seçim yollarını reddeder, diğer türler korunur', () => {
  let App: typeof import('../src/App').default
  let renderer: ReactTestRenderer | undefined
  let seed: CanvasBook
  let picked = 0
  let captured = 0
  const api = {
    getSettings: async () => DEFAULT_SETTINGS,
    getCanvases: async () => structuredClone(seed),
    saveCanvases: async () => true,
    listWindows: async () => [],
    bootReady: () => {},
    manageLibrary: vi.fn(),
    onCloseRequested: () => () => {},
    finishClose: async () => {},
    onAgentLog: () => () => {}, onAgentStep: () => () => {}, onAgentEdge: () => () => {}, onAgentPatch: () => () => {},
    scanScreen: async (): Promise<ScanResult> => ({
      area: { x: 0, y: 0, w: 100, h: 100 }, items: [], ocr: false, uiaCount: 0, ocrCount: 0, image: null, window: '',
    }),
    pickScreenBox: async (): Promise<Locator> => { picked += 1; return legacyLocator() },
    captureAfter: async (): Promise<Locator> => { captured += 1; return { ...legacyLocator(), x: 5, y: 5 } },
  }

  beforeAll(async () => {
    Object.defineProperty(window, 'xpAgent', { configurable: true, value: api })
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 0 })
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: () => {} })
    App = (await import('../src/App')).default
  })
  beforeEach(() => {
    vi.useFakeTimers()
    picked = 0; captured = 0
    seed = withZipFixture(normalizeCanvasBook({activeId:'',tabs:[{id:'saved',name:'Shared',graph:{nodes:[createNode('start',0,0),createNode('click',300,0),createNode('condition',0,200)],edges:[]}}]}))

  })
  afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; vi.useRealTimers() })
  afterAll(() => { delete (window as unknown as { xpAgent?: unknown }).xpAgent; vi.unstubAllGlobals() })

  const openCanvas = async () => {
    await act(async () => { renderer = create(createElement(App), options) })
    const lib = renderer!.root.findByType(CanvasLibrary)
    await act(async () => { lib.props.onOpenCanvas(seed.zipLibrary!.groups[0].canvases[0].canvasId) })
  }
  const graph = () => renderer!.root.findByType(NodeCanvas).props.graph as AgentGraph
  const select = async (id: string) => { await act(async () => { renderer!.root.findByType(NodeCanvas).props.onSelectNode(id) }) }
  const openScanner = async () => { await act(async () => { renderer!.root.findByType(SidePanel).props.onOpenScanner() }) }
  const pick = async () => {
    const item = { id: 1, text: 'Kaydet', type: 'Button', src: 'uia' as const, x: 10, y: 10, w: 60, h: 20 }
    await act(async () => { await renderer!.root.findByType(ScreenScanner).props.onPick(item) })
  }
  const node = (id: string) => graph().nodes.find((n) => n.id === id)!

  it('(c1) ekran tarayıcıdan seçim koşulu değiştirmez, uyarı günlüğe düşer ve öğe yakalanmaz', async () => {
    await openCanvas()
    const cond = graph().nodes.find((n) => n.kind === 'condition')!
    await select(cond.id)
    await openScanner()
    await pick()
    const after = node(cond.id)
    expect(after.locator).toBeUndefined()
    expect(after.text ?? '').toBe('')
    expect(text(renderer!.root)).toContain('Koşul artık seçim kullanmıyor; kutuya ne aradığını yaz.')
    expect(picked).toBe(0)
  })

  it('(c2) imleçle yakalama koşulu değiştirmez, kısa uyarı yazılır', async () => {
    await openCanvas()
    const cond = graph().nodes.find((n) => n.kind === 'condition')!
    await select(cond.id)
    await act(async () => { await renderer!.root.findByType(SidePanel).props.onCaptureForNode() })
    const after = node(cond.id)
    expect(after.locator).toBeUndefined()
    expect(after.text ?? '').toBe('')
    expect(text(renderer!.root)).toContain('Koşul artık seçim kullanmıyor; kutuya ne aradığını yaz.')
  })

  it('(d2) Tıkla node’unun seçim davranışı aynen kalır', async () => {
    await openCanvas()
    const click = graph().nodes.find((n) => n.kind === 'click')!
    await select(click.id)
    await openScanner()
    await pick()
    const after = node(click.id)
    expect(after.locator?.controlType).toBe('Button')
    expect(after.prompt).toContain('Kaydet')
    expect(picked).toBe(1)
  })
})
