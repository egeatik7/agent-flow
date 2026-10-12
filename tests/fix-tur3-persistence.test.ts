import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canvasContent, sameCanvasContent } from '../electron/canvas-content'
import { createNode, normalizeCanvasBook, normalizeGraph, type AgentGraph, type CanvasBook } from '../electron/graph-types'
import { isLibraryConflict, LibraryConflictError, librarySession } from '../electron/library-storage'
import { newTally, runGraph, type Executor } from '../electron/runner'
import { toolLayerSave } from '../electron/tool-branch'
import { beginRun, endRun } from '../electron/tool-state'
import { callTool, type ToolContext } from '../electron/tools'
import { readWorkspace, writeWorkspace } from '../electron/workspace-store'
import { CLOSE_REPLY_TIMEOUT_MS, WindowCloseGuard } from '../electron/window-close'

// 3. tur (1.9.95) düzeltmelerinin ölçümü: kütüphane hatasında oturum kaydı, kapanış zaman aşımı,
// koşu sayacının dürüstlüğü ve motorun klasör listesinin belge içeriği sayılmaması.

const mainSource = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')

// --- main.ts'in gerçek kalıcılık fonksiyonları, Electron başlatılmadan (workspace-main.test.ts kalıbı) ---
const sourceFile = ts.createSourceFile('main.ts', mainSource, ts.ScriptTarget.Latest, true)
const functions = new Map<string, string>()
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && ['loadCanvases', 'storeWorkspace'].includes(node.name.text)) functions.set(node.name.text, node.getText(sourceFile))
  ts.forEachChild(node, visit)
}
visit(sourceFile)
if (functions.size !== 2) throw Error('main.ts içinde loadCanvases/storeWorkspace bulunamadı.')
const compiled = ts.transpileModule(`${[...functions.values()].join('\n')}\n({ loadCanvases, storeWorkspace });`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

const graphOf = (): AgentGraph => ({ nodes: [createNode('start', 0, 0)], edges: [] })
const bookOf = (name = 'Tuval'): CanvasBook => normalizeCanvasBook({
  activeId: 'tab',
  tabs: [{ id: 'tab', name, graph: graphOf() }],
  library: { canvases: [{ id: 'saved', name, graph: graphOf(), updatedAt: 1 }], automations: [] },
  branches: [],
})

type StoreWorkspace = (book: CanvasBook, writer?: 'window' | 'tools') => { conflict: boolean; libraryError?: string }
/** Runs the real storeWorkspace against a fake store, catalog and viewer; the library write is the variable. */
function harness(save: (library: unknown) => void, disk = bookOf()) {
  const writes: { canvases: CanvasBook; graph: AgentGraph }[] = []
  const books: CanvasBook[] = []
  const context: Record<string, unknown> = {
    store: {
      get: (key: string) => key === 'canvases' ? structuredClone(librarySession(disk)) : key === 'graph' ? disk.tabs[0]?.graph : key === 'libraryMigrated' ? true : undefined,
      set: (values: { canvases: CanvasBook; graph: AgentGraph }) => { writes.push(structuredClone(values)) },
    },
    structuredClone, normalizeGraph, readWorkspace, writeWorkspace, toolLayerSave, librarySession, isLibraryConflict,
    savedLibrary: structuredClone(disk.library),
    libraryStorage: { save },
    viewerState: { setBook: (book: CanvasBook) => { books.push(book) } },
  }
  const callbacks = runInNewContext(compiled, context) as { storeWorkspace: StoreWorkspace }
  return { callbacks, context, writes, books, disk }
}

describe('1) kütüphane yazılamazsa katalog yazılmaz, oturum HER ZAMAN yazılır', () => {
  it('çakışmada conflict=true döner; sekmeler diske iner, katalog değişmez', () => {
    const h = harness(() => { throw new LibraryConflictError('Kütüphane başka bir programda değişti.') })
    const katalogOnce = structuredClone(h.context.savedLibrary)
    const sonuc = h.callbacks.storeWorkspace(h.disk)
    expect(sonuc).toEqual({ conflict: true })
    expect(h.context.savedLibrary).toEqual(katalogOnce)
    expect(h.writes).toHaveLength(1)
    expect(h.writes[0].canvases.tabs.map(t => t.id)).toEqual(['tab'])
    expect(h.writes[0].canvases.library).toBeUndefined()
    expect(h.writes[0].graph).toEqual(h.disk.tabs[0].graph)
    // viewerState: biri loadCanvases'in, sonuncusu yazılan oturumun.
    expect(h.books.at(-1)!.tabs.map(t => t.id)).toEqual(['tab'])
  })
  it('kilit kaybı/okuma hatası yutulmaz ama oturumu da düşürmez: libraryError döner', () => {
    const h = harness(() => { throw new Error('Kilit kayboldu; kayıt yapılmadı.') })
    const katalogOnce = structuredClone(h.context.savedLibrary)
    let sonuc: { conflict: boolean; libraryError?: string } | undefined
    expect(() => { sonuc = h.callbacks.storeWorkspace(h.disk) }).not.toThrow()
    expect(sonuc).toEqual({ conflict: false, libraryError: 'Kilit kayboldu; kayıt yapılmadı.' })
    expect(h.context.savedLibrary).toEqual(katalogOnce)
    expect(h.writes).toHaveLength(1)
    expect(h.writes[0].canvases.tabs.map(t => t.id)).toEqual(['tab'])
    expect(h.books.at(-1)!.tabs.map(t => t.id)).toEqual(['tab'])
  })
  it('kütüphane yazılabilirse savedLibrary güncellenir ve hata dönmez', () => {
    const yazilan: unknown[] = []
    const h = harness(library => { yazilan.push(library) })
    expect(h.callbacks.storeWorkspace(h.disk)).toEqual({ conflict: false })
    expect(yazilan).toHaveLength(1)
    expect(h.context.savedLibrary).toEqual(yazilan[0])
    expect(h.writes).toHaveLength(1)
  })
})

describe('2) kapanış kapısı: renderer yanıt vermezse kapanış zorlanır', () => {
  afterEach(() => vi.useRealTimers())

  it('zaman aşımı dolunca kapanış zorlanır; before-quit kapısı kilitli kalmaz', () => {
    vi.useFakeTimers()
    const guard = new WindowCloseGuard()
    guard.ready = true
    const send = vi.fn()
    // main.ts'in kapısı: request false ise event.preventDefault (pencere kapanmaz), true ise kapanır.
    const win = { closed: false, close: () => { if (attempt()) win.closed = true } }
    const attempt = () => guard.request(send, { timeoutMs: CLOSE_REPLY_TIMEOUT_MS, onTimeout: () => { guard.force(); win.close() } })
    const beforeQuitBlocks = () => guard.ready && !guard.approved

    expect(attempt()).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
    expect(win.closed).toBe(false)
    expect(beforeQuitBlocks()).toBe(true)
    vi.advanceTimersByTime(CLOSE_REPLY_TIMEOUT_MS)
    expect(win.closed).toBe(true)
    expect(guard.approved).toBe(true)
    // İkinci kapanış isteği artık engellenmez: kilitli kalan bir before-quit yok.
    expect(beforeQuitBlocks()).toBe(false)
    expect(attempt()).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('allow=true normal kapatır; allow=false kapatmaz ve yeniden sorulur', () => {
    vi.useFakeTimers()
    const guard = new WindowCloseGuard()
    guard.ready = true
    const send = vi.fn()
    let closed = false
    const attempt = () => guard.request(send, { timeoutMs: CLOSE_REPLY_TIMEOUT_MS, onTimeout: () => {} })
    expect(attempt()).toBe(false)
    expect(guard.reply(999, true)).toBe(false)
    expect(guard.reply(1, false)).toBe(false)
    expect(closed).toBe(false)
    expect(guard.approved).toBe(false)
    expect(attempt()).toBe(false)
    expect(send).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(1)
    if (guard.reply(2, true)) closed = true
    expect(closed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(60_000)
    expect(guard.approved).toBe(true)
  })

  it('çöken/yanıt vermeyen arayüz (force) sonrası kapanış engellenmez', () => {
    const guard = new WindowCloseGuard()
    guard.ready = true
    expect(guard.request(vi.fn(), { timeoutMs: 10_000, onTimeout: () => {} })).toBe(false)
    guard.force()
    expect(guard.approved).toBe(true)
    expect(guard.request(vi.fn(), { timeoutMs: 10_000 })).toBe(true)
    expect(CLOSE_REPLY_TIMEOUT_MS).toBeGreaterThan(0)
  })
})

const fakeEx = (initiative: () => Promise<boolean> = async () => false): Executor => ({
  log: () => {}, step: () => {}, shouldStop: () => false,
  click: async () => {}, type: async () => {}, key: async () => {}, exists: async () => true, initiative,
})
const edge = (from: string, fromPort: string, to: string) => ({ id: `${from}-${fromPort}`, from, fromPort, to })

describe('3) koşu sayacı: döngü dışı adım hatası "hatalı öğe yok" demez', () => {
  it('döngü dışı adım hatasında failed sayılır, hata yine yukarı çıkar', async () => {
    const start = createNode('start', 0, 0), ai = createNode('ai', 100, 0)
    ai.prompt = 'bir seçenek seç'
    const graph: AgentGraph = { nodes: [start, ai], edges: [edge(start.id, 'next', ai.id)] }
    const tally = newTally()
    await expect(runGraph(graph, fakeEx(), { maxSteps: 10, stepDelayMs: 0, tally })).rejects.toThrow(/bağlı değil/)
    expect(tally.failed).toBe(0)
    expect(tally.stepFailures).toBe(1)
  })

  it('tur içi hata yalnız öğe sayacına yazılır: çift sayım yok', async () => {
    const start = createNode('start', 0, 0), ai = createNode('ai', 100, 0), after = createNode('click', 200, 0)
    ai.prompt = 'karar ver'
    const loop = createNode('loop', 150, 50)
    loop.items = ['bir', 'iki']
    loop.members = [ai.id]
    const graph: AgentGraph = { nodes: [start, loop, ai, after], edges: [edge(start.id, 'next', loop.id), edge(ai.id, 'next', after.id)] }
    const tally = newTally()
    await expect(runGraph(graph, fakeEx(), { maxSteps: 100, stepDelayMs: 0, tally })).rejects.toThrow()
    expect(tally.failed).toBe(2)
    expect(tally.stepFailures).toBe(0)
  })

  const ctx = (): ToolContext => ({
    getGraph: () => ({ nodes: [], edges: [] }), getSettings: () => ({}) as never, log: () => {},
    isRunning: () => false, userStop: () => false, sendStep: () => {}, permission: () => 'auto',
    askApproval: async () => true, requestStop: () => {}, startRun: async () => ({ ok: true }),
    getCanvases: () => ({ activeId: '', tabs: [] }), saveCanvases: () => {}, applyMerge: async () => ({ ok: true }),
  })

  it('hata ile biten koşuyu run.state "hatalı öğe yok" diye anlatmaz', async () => {
    const start = createNode('start', 0, 0), ai = createNode('ai', 100, 0)
    ai.prompt = 'bir şey yap'
    const graph: AgentGraph = { nodes: [start, ai], edges: [edge(start.id, 'next', ai.id)] }
    const tally = newTally()
    beginRun(graph)
    const hata = await runGraph(graph, fakeEx(), { maxSteps: 10, stepDelayMs: 0, tally }).then(() => '', e => (e as Error).message)
    // main.ts'in hata yolunun aynısı: paylaşılan sayaç resmî sonuca yazılır.
    endRun({ ok: false, error: hata, failed: tally.failed + tally.stepFailures })
    const res = await callTool('run.state', {}, ctx())
    expect(res.message).toContain('1 hatalı adım/öğe')
    expect(res.message).not.toContain('hatalı öğe yok')
    expect(res.message).toContain(`hata: ${hata}`)
  })

  it('hiç sayı yoksa da dürüst metin yazılır', async () => {
    beginRun({ nodes: [createNode('start', 0, 0)], edges: [] })
    endRun({ ok: false, error: 'kutu klasörü okunamadı', steps: 2 })
    const res = await callTool('run.state', {}, ctx())
    expect(res.message).toContain('hata ile bitti (öğe sayacı yok)')
    expect(res.message).not.toContain('hatalı öğe yok')
  })

  it('main.ts paylaşılan sayacı koşuya verir ve hata yolunda sonuca yazar', () => {
    expect(mainSource).toContain('const tally = newTally()')
    expect(mainSource).toContain('const hatali = tally.failed + tally.stepFailures')
    expect(mainSource).toMatch(/failed: hatali/)
  })
})

describe('4) motorun yazdığı klasör listesi belge içeriği sayılmaz', () => {
  it('klasörlü/desenli kutunun items alanı temizlenir, elle girilen liste korunur', () => {
    const klasor = createNode('loop', 0, 0)
    klasor.folder = 'C:\\Images'
    klasor.items = ['C:\\Images\\a.png']
    const desen = createNode('loop', 0, 0)
    desen.pattern = '.*\\.png'
    desen.items = ['motorun yazdığı']
    const elle = createNode('loop', 0, 0)
    elle.items = ['elle', 'girilen']
    const sayi = createNode('loop', 0, 0)
    sayi.count = 3
    const clean = canvasContent({ nodes: [klasor, desen, elle, sayi], edges: [] })
    expect(clean.nodes[0].items).toBeUndefined()
    expect(clean.nodes[1].items).toBeUndefined()
    expect(clean.nodes[2].items).toEqual(['elle', 'girilen'])
    expect(clean.nodes[3].items).toBeUndefined()
  })

  it('motorun yazdığı liste "değişti" saymaz; elle liste değişikliği sayar', () => {
    const kutu = createNode('loop', 0, 0)
    kutu.folder = 'C:\\Images\\{{klasör}}'
    kutu.items = ['a.png']
    const before: AgentGraph = { nodes: [kutu], edges: [] }
    const afterRun = structuredClone(before)
    afterRun.nodes[0].items = ['C:\\Images\\mutlak\\b.png']
    afterRun.nodes[0].loopIndex = 3
    afterRun.nodes[0].templated = true
    afterRun.nodes[0].startIndex = 0
    expect(sameCanvasContent(before, afterRun)).toBe(true)

    const elleBir: AgentGraph = { nodes: [{ ...createNode('loop', 0, 0), items: ['bir'] }], edges: [] }
    const elleIki: AgentGraph = { nodes: [{ ...createNode('loop', 0, 0), items: ['iki'] }], edges: [] }
    expect(sameCanvasContent(elleBir, elleIki)).toBe(false)
  })
})
