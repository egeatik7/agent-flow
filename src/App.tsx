import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TitleBar from './components/TitleBar'
import Toolbar from './components/Toolbar'
import CanvasTabs from './components/CanvasTabs'
import CanvasLibraryPanel from './components/CanvasLibrary'
import { addCanvasTab, closeCanvasTab, activateCanvasSnapshot, libraryOf, saveCanvas, deleteSavedCanvas, openSavedCanvas, moveCanvasTab, saveAutomation, renameSavedCanvas, deleteAutomation, type AutomationDraft, openAutomation, exportAutomation, importAutomation } from '../electron/canvas-library'
import { CanvasSequence } from './lib/canvas-sequence'
import { beginProgress, finishProgress, progressEdge, progressStep, runNodeView, visibleRunNodes, type RunProgress } from './lib/run-progress'
import NodeCanvas from './components/NodeCanvas'
import WorkspaceWelcome, { WorkspacePicker } from './components/WorkspaceWelcome'
import { canvasView, emptyNavigation, visitLocation, type CanvasLocation } from './lib/canvas-navigation'
import SidePanel, { type SideTab } from './components/SidePanel'
import LogPanel from './components/LogPanel'
import ScreenScanner from './components/ScreenScanner'
import ConfirmDialog from './components/ConfirmDialog'
import SaveCanvasDialog from './components/SaveCanvasDialog'
import { canvasDirty, emptyCanvasSession, settleCanvasChanges, startCanvasSession, type SaveDecision } from '../electron/canvas-session'
import {
  DEFAULT_SETTINGS,
  NODE_SPECS,
  createNode,
  newId,
  hasTemplate,
  listItems,
  normalizeCanvasBook,
  normalizeGraph,
  type AgentGraph,
  type AgentNode,
  type AppSettings,
  type CanvasBook,
  type SavedCanvas,
  type CanvasAutomation,
  type Locator,
  type LogEntry,
  type LogLevel,
  type ModelInfo,
  type NodeKind,
  type ScreenItem,
  type StepStatus,
} from './types'
import {
  addAfter,
  addAt,
  autoLayout,
  chainTail,
  connect,
  copyNodes,
  duplicateNode,
  pasteNodes,
  type NodeClip,
  freePort,
  mapNodes,
  packageSelection,
  unpackPackage,
  removeNode,
  reconcileLoopMembership,
  resetLoopTicks,
  setMembership,
  wrapInLoop,
} from './lib/graph-ops'
import { outsideFolder, templateLoops } from '../electron/enclosing'
import { DEMO_CAPTURE, demoScan, runDemo, stopDemo } from './lib/demo'

const api = typeof window !== 'undefined' ? window.xpAgent : undefined

const LOCAL_GRAPH = 'xp-agent-graph'
const LOCAL_BOOK = 'xp-agent-canvases'
const LOCAL_SETTINGS = 'xp-agent-settings'

function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function locText(loc: Locator): string {
  return (loc.text || loc.name || '').trim()
}

function promptFor(loc: Locator): string {
  const t = locText(loc)
  return t ? `“${t}” yazan yere tıkla` : `${loc.controlType} öğesine tıkla`
}

type NewClick = { prompt: string; title: string; locator?: Locator; anchor?: { x: number; y: number } }

function initialGraph(): AgentGraph {
  return normalizeGraph({ nodes: [createNode('start', 40, 80)], edges: [] })
}

function emptyBook(): CanvasBook {
  return { activeId: '', tabs: [], library: { schemaVersion: 2, canvases: [], automations: [] } }
}

function nextCanvasName(tabs: { name: string }[]): string {
  const used = new Set(tabs.map((t) => t.name))
  let n = 1
  while (used.has(`Tuval ${n}`)) n += 1
  return `Tuval ${n}`
}

function fileNameFor(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48)
  return `${clean || 'tuval'}.json`
}

function previewBook(): CanvasBook {
  try {
    const raw = localStorage.getItem(LOCAL_BOOK)
    if (raw) return normalizeCanvasBook(JSON.parse(raw))
    const g = localStorage.getItem(LOCAL_GRAPH)
    if (g) {
      const legacy = normalizeGraph(JSON.parse(g))
      if (legacy.nodes.length) return normalizeCanvasBook(undefined, legacy)
    }
  } catch {
    /* corrupt preview data */
  }
  return emptyBook()
}

type Crumb = { parent: AgentGraph; id: string }

/** The saved flow: the open package view written back into its parents. */
function rooted(view: AgentGraph, stack: Crumb[]): AgentGraph {
  return stack.reduceRight(
    (inner, crumb) => ({
      ...crumb.parent,
      nodes: crumb.parent.nodes.map((n) => (n.id === crumb.id ? { ...n, inner } : n)),
    }),
    view
  )
}

/** The same package path, read back out of a canvas that was edited at the root. */
function projectView(full: AgentGraph, stack: Crumb[]): { view: AgentGraph; stack: Crumb[] } {
  let view = full
  const next: Crumb[] = []
  for (const crumb of stack) {
    next.push({ parent: view, id: crumb.id })
    const pkg = view.nodes.find((n) => n.id === crumb.id && n.kind === 'package')
    view = pkg?.inner ?? { nodes: [], edges: [] }
  }
  return { view, stack: next }
}

export default function App() {
  const [book0] = useState(emptyBook)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [graph, setGraph] = useState<AgentGraph>({ nodes: [], edges: [] })
  const [activeId, setActiveId] = useState(book0.activeId)
  const [tabList, setTabList] = useState(book0.tabs.map((t) => ({ id: t.id, name: t.name })))
  const [stack, setStack] = useState<Crumb[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [pasteRevision, setPasteRevision] = useState(0)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [capturing, setCapturing] = useState(0)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [scanner, setScanner] = useState<{ nodeId: string | null } | null>(null)
  const [windows, setWindows] = useState<{ title: string; handle: string }[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [stepStatus, setStepStatus] = useState<Record<string, StepStatus>>({})
  const [runProgress, setRunProgress] = useState<RunProgress>(() => finishProgress(beginProgress(''), false))
  const stopRequested = useRef(false)
  const [workspacePicker, setWorkspacePicker] = useState<'canvas' | 'automation' | null>(null)
  const [navigation, setNavigation] = useState(emptyNavigation)
  const navigationRef = useRef(navigation)
  navigationRef.current = navigation
  useEffect(() => { const next = emptyNavigation(); navigationRef.current = next; setNavigation(next) }, [activeId])
  const [canvasFocus, setCanvasFocus] = useState<{ nodeId: string; at: number }>()
  const [sideTab, setSideTab] = useState<SideTab>('canvases')
  const [fileOpen, setFileOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [library, setLibrary] = useState(() => libraryOf(book0))
  const [libraryBusy, setLibraryBusy] = useState(false)
  const libraryBusyRef = useRef(false)
  const sequenceRef = useRef(new CanvasSequence())
  const [sequenceLabel, setSequenceLabel] = useState('')
  const [confirmQuestion, setConfirmQuestion] = useState<string | null>(null)
  const confirmAnswer = useRef<((yes: boolean) => void) | null>(null)
  const [saveQuestion, setSaveQuestion] = useState<string | null>(null)
  const saveAnswer = useRef<((answer: SaveDecision) => void) | null>(null)
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const runIdle = useRef<(() => void) | null>(null)
  const writeQueue = useRef<Promise<boolean>>(Promise.resolve(true))
  const automationCloseReview = useRef<(() => Promise<boolean>) | null>(null)
  const registerAutomationCloseReview = useCallback((review: (() => Promise<boolean>) | null) => {
    automationCloseReview.current = review
  }, [])

  const graphRef = useRef(graph)
  graphRef.current = graph
  const bookRef = useRef(book0)
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const clipRef = useRef<NodeClip | null>(null)
  const pasteTargetRef = useRef<(() => { x: number; y: number }) | null>(null)
  const registerPasteTarget = useCallback((readPoint: (() => { x: number; y: number }) | null) => {
    pasteTargetRef.current = readPoint
  }, [])
  const runningRef = useRef(false)
  runningRef.current = running
  const stackRef = useRef(stack)
  stackRef.current = stack
  const selectedRef = useRef(selectedNodeId)
  selectedRef.current = selectedNodeId
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const fileRef = useRef<HTMLInputElement>(null)
  const fileMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!fileOpen) return
    const close = (e: MouseEvent) => {
      if (!fileMenuRef.current?.contains(e.target as Node)) setFileOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFileOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [fileOpen])

  const pushLog = useCallback((level: LogLevel, message: string) => {
    setLogs((prev) => [...prev.slice(-400), { id: newId(), level, message, at: Date.now() }])
  }, [])

  const patchNode = useCallback((id: string, patch: Partial<AgentNode>) => {
    // Agent events arrive before runAgent resolves: retain their changes synchronously
    // before a sequence switches the editor to the next canvas.
    const full = rooted(graphRef.current, stackRef.current)
    const next = mapNodes(full, n => n.id === id ? { ...n, ...patch } : n)
    const projected = projectView(next, stackRef.current)
    graphRef.current = projected.view
    stackRef.current = projected.stack
    setGraph(projected.view)
    setStack(projected.stack)
  }, [])

  const refreshWindows = useCallback(async () => {
    if (!api) {
      setWindows([{ title: 'Demo Uygulama', handle: '0' }])
      return
    }
    try {
      setWindows(await api.listWindows())
    } catch (e) {
      pushLog('error', `Pencere listesi alınamadı: ${errText(e)}`)
    }
  }, [pushLog])

  const adoptBook = useCallback((book: CanvasBook) => {
    bookRef.current = book
    activeIdRef.current = book.activeId
    setActiveId(book.activeId)
    setTabList(book.tabs.map(t => ({ id: t.id, name: t.name })))
    setLibrary(libraryOf(book))
  }, [])

  const persistBook = useCallback((book: CanvasBook): Promise<boolean> => {
    const snapshot = structuredClone(book)
    // Draft autosaves, catalog writes and final closure always reach disk in order.
    const next = writeQueue.current.then(async () => {
      try {
        if (api) { if (await api.saveCanvases(snapshot) === false) throw new Error('Tuvaller diske kaydedilemedi.') }
        else localStorage.setItem(LOCAL_BOOK, JSON.stringify(snapshot))
        return true
      } catch (e) { pushLog('error', `Tuvaller kaydedilemedi: ${errText(e)}`); return false }
    })
    writeQueue.current = next
    return next
  }, [pushLog])

  const rememberBook = useCallback((book: CanvasBook): Promise<boolean> => {
    adoptBook(book)
    return persistBook(book)
  }, [adoptBook, persistBook])

  const commitActive = useCallback((): CanvasBook => {
    const cur = bookRef.current
    const root = rooted(graphRef.current, stackRef.current)
    const id = activeIdRef.current
    return {
      ...cur,
      activeId: id,
      tabs: cur.tabs.map((t) => (t.id === id ? { ...t, graph: root } : t)),
    }
  }, [])

  const showCanvas = useCallback((book: CanvasBook, id: string, persist = true) => {
    const tab = book.tabs.find((t) => t.id === id) ?? book.tabs[0]
    const next = { ...book, activeId: tab?.id ?? '' }
    if (persist) void rememberBook(next)
    else adoptBook(next)
    const view = tab ? reconcileLoopMembership(tab.graph) : { nodes: [], edges: [] }
    if (!tab) setSideTab('canvases')
    graphRef.current = view
    stackRef.current = []
    setStack([])
    setGraph(view)
    setSelectedNodeId(null)
    setSelectedIds([])
    selectedIdsRef.current = []
    setSelectedEdgeId(null)
    setStepStatus({})
  }, [rememberBook, adoptBook])

  useEffect(() => {
    void (async () => {
      if (api) {
        setSettings({ ...DEFAULT_SETTINGS, ...(await api.getSettings()) })
        const book = startCanvasSession(normalizeCanvasBook(await api.getCanvases()))
        showCanvas(book, '', false)
        await persistBook(book)
        pushLog('info', 'Nubbo Agent Studio hazır.')
      } else {
        try {
          const book = startCanvasSession(previewBook())
          showCanvas(book, '', false)
          await persistBook(book)
          const s = localStorage.getItem(LOCAL_SETTINGS)
          if (s) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(s) })
        } catch {
          /* corrupt local data, keep defaults */
        }
        pushLog('info', 'Tarayıcı önizlemesi: tıklamalar simüle edilir. Gerçek otomasyon Windows exe’de çalışır.')
      }
      setLoaded(true)
      void refreshWindows()
      requestAnimationFrame(() => requestAnimationFrame(() => api?.bootReady?.()))
    })()
  }, [pushLog, refreshWindows, showCanvas, persistBook])

  useEffect(() => {
    if (!loaded || libraryBusy || closing || saveQuestion) return
    const t = setTimeout(() => { if (!libraryBusyRef.current && !closingRef.current && !saveAnswer.current) void rememberBook(commitActive()) }, 400)
    return () => clearTimeout(t)
  }, [graph, stack, loaded, libraryBusy, closing, saveQuestion, rememberBook, commitActive])

  /** Adds a Click node after the selected node (or the end of the main path) and selects it. */
  const appendClick = useCallback((c: NewClick) => {
    const g = graphRef.current
    const sel = g.nodes.find((n) => n.id === selectedRef.current)
    const port = sel ? freePort(g, sel) : null
    const tail = chainTail(g)
    const after = sel && port ? { id: sel.id, port } : tail ? { id: tail.node.id, port: tail.port } : null
    const res = after ? addAfter(g, after.id, after.port, 'click') : addAt(g, 'click', 300, 80)
    const next = {
      ...res.graph,
      nodes: res.graph.nodes.map((n) =>
        n.id === res.id ? { ...n, prompt: c.prompt, locator: c.locator, anchor: c.anchor, title: c.title.slice(0, 40) } : n
      ),
    }
    setGraph(next)
    setSelectedNodeId(res.id)
    setSelectedEdgeId(null)
  }, [])

  const appendCaptured = useCallback(
    (loc: Locator) => {
      const t = locText(loc)
      appendClick({
        prompt: promptFor(loc),
        title: `Tıkla: ${t || loc.controlType}`,
        locator: loc,
        anchor: loc.x !== undefined && loc.y !== undefined ? { x: loc.x, y: loc.y } : undefined,
      })
      pushLog('success', `Yakalandı: ${promptFor(loc)}${loc.windowTitle ? ` — ${loc.windowTitle}` : ''}`)
    },
    [appendClick, pushLog]
  )

  const recordStep = useCallback((id: string, status: StepStatus) => {
    setStepStatus(prev => ({ ...prev, [id]: status }))
    const full = rooted(graphRef.current, stackRef.current)
    setRunProgress(prev => progressStep(prev, full, id, status))
  }, [])
  const recordEdge = useCallback((id: string, from: string, to: string) => {
    const full = rooted(graphRef.current, stackRef.current)
    setRunProgress(prev => progressEdge(prev, full, id, from, to))
  }, [])

  // Navigate once AFTER the engine stops. During execution, inspection and
  // panning remain under the user's control; later manual navigation stays put.
  useEffect(() => {
    if (runProgress.phase !== 'stopped' || !runProgress.nodeId || runProgress.canvasId !== activeIdRef.current) return
    const found = runNodeView(rooted(graphRef.current, stackRef.current), runProgress.nodeId)
    if (!found) return
    const history = visitLocation(navigationRef.current, currentLocation(), { path: found.stack.map(c => c.id), nodeId: runProgress.nodeId })
    navigationRef.current = history; setNavigation(history)
    graphRef.current = found.view
    stackRef.current = found.stack
    setGraph(found.view)
    setStack(found.stack)
    setSelectedNodeId(runProgress.nodeId)
    setSelectedIds([runProgress.nodeId])
    selectedIdsRef.current = [runProgress.nodeId]
    setSelectedEdgeId(null)
    setCanvasFocus(prev => ({ nodeId: runProgress.nodeId!, at: (prev?.at ?? 0) + 1 }))
  }, [runProgress.phase, runProgress.nodeId, runProgress.canvasId])

  useEffect(() => {
    if (!api) return
    const offLog = api.onAgentLog((payload) => {
      const p = payload as { level: LogLevel; message: string }
      pushLog(p.level, p.message)
    })
    const offStep = api.onAgentStep((payload) => {
      const p = payload as { id: string; status: StepStatus }
      recordStep(p.id, p.status)
    })
    const offEdge = api.onAgentEdge?.(payload => {
      const p = payload as { id: string; from: string; to: string }
      recordEdge(p.id, p.from, p.to)
    })
    const offPatch = api.onAgentPatch((payload) => {
      const p = payload as { id: string; patch: Partial<AgentNode> }
      patchNode(p.id, p.patch)
    })
    return () => {
      offLog()
      offStep()
      offEdge?.()
      offPatch()
    }
  }, [pushLog, patchNode, recordStep, recordEdge])

  const selected = useMemo(() => graph.nodes.find((n) => n.id === selectedNodeId) ?? null, [graph.nodes, selectedNodeId])
  const selectedEdge = useMemo(() => graph.edges.find((e) => e.id === selectedEdgeId) ?? null, [graph.edges, selectedEdgeId])

  const selectNode = (id: string | null, additive = false) => {
    setSelectedEdgeId(null)
    if (!id) {
      if (activeIdRef.current) setSideTab('node')
      setSelectedNodeId(null)
      setSelectedIds([])
      selectedIdsRef.current = []
      return
    }
    setSideTab('node')
    if (!additive) {
      setSelectedNodeId(id)
      setSelectedIds([id])
      selectedIdsRef.current = [id]
      return
    }
    const prev = selectedIdsRef.current
    const has = prev.includes(id)
    const next = has ? prev.filter((x) => x !== id) : [...prev, id]
    selectedIdsRef.current = next
    setSelectedIds(next)
    setSelectedNodeId(has ? (next[next.length - 1] ?? null) : id)
  }

  const selectMany = (ids: string[], mode: 'replace' | 'add') => {
    setSelectedEdgeId(null)
    const prev = selectedIdsRef.current
    const next = mode === 'add' ? [...prev, ...ids.filter((id) => !prev.includes(id))] : [...ids]
    selectedIdsRef.current = next
    setSelectedIds(next)
    const cur = selectedRef.current
    setSelectedNodeId(cur && next.includes(cur) ? cur : (next[next.length - 1] ?? null))
    if (activeIdRef.current) setSideTab('node')
  }
  const currentLocation = (): CanvasLocation => {
    const path = stackRef.current.map(c => c.id)
    const tracked = navigationRef.current.entries[navigationRef.current.index]
    if (tracked && JSON.stringify(tracked.path) === JSON.stringify(path)) {
      return { path, nodeId: graphRef.current.nodes.some(n => n.id === tracked.nodeId) ? tracked.nodeId : undefined }
    }
    return { path, nodeId: selectedRef.current ?? undefined }
  }
  const applyLocation = (location: CanvasLocation, inspect = false) => {
    if (!activeIdRef.current || libraryBusyRef.current || closingRef.current || saveAnswer.current || confirmAnswer.current) return false
    const target = canvasView(rooted(graphRef.current, stackRef.current), location.path)
    if (!target || (location.nodeId && !target.graph.nodes.some(n => n.id === location.nodeId))) return false
    // Preserve the existing package-entry rule: a newly created empty package
    // needs its Start marker before the user adds its first action.
    if (location.path.length && !target.graph.nodes.some(n => n.kind === 'start')) target.graph = normalizeGraph(target.graph)
    graphRef.current = target.graph; stackRef.current = target.stack
    setGraph(target.graph); setStack(target.stack)
    const selectedId = inspect ? location.nodeId ?? null : null
    selectedRef.current = selectedId; selectedIdsRef.current = selectedId ? [selectedId] : []
    setSelectedNodeId(selectedId); setSelectedIds(selectedIdsRef.current); setSelectedEdgeId(null); setSideTab('node')
    const focusId = location.nodeId ?? target.graph.nodes.find(n => n.kind === 'start')?.id ?? target.graph.nodes[0]?.id
    setCanvasFocus(previous => ({ nodeId: focusId ?? '', at: (previous?.at ?? 0) + 1 }))
    return true
  }
  const visitCanvasLocation = (location: CanvasLocation, inspect = false) => {
    const current = currentLocation()
    if (!applyLocation(location, inspect)) return
    const history = visitLocation(navigationRef.current, current, location)
    navigationRef.current = history; setNavigation(history)
  }
  const navigateNode = (id: string, inspect = false) => {
    const node = graphRef.current.nodes.find(n => n.id === id)
    if (!node) return
    const path = stackRef.current.map(c => c.id)
    visitCanvasLocation(node.kind === 'package' && !inspect ? { path: [...path, id] } : { path, nodeId: id }, inspect)
  }
  const navigateHistory = (direction: -1 | 1) => {
    const history = navigationRef.current
    let index = history.index + direction
    while (index >= 0 && index < history.entries.length) {
      if (applyLocation(history.entries[index])) { const next = { ...history, index }; navigationRef.current = next; setNavigation(next); return }
      index += direction
    }
  }
  const navigateOut = () => {
    const path = stackRef.current.map(c => c.id)
    const id = path.pop()
    if (id) visitCanvasLocation({ path, nodeId: id })
  }

  const selectEdge = (id: string | null) => {
    setSelectedEdgeId(id)
    if (id) {
      setSelectedNodeId(null)
      setSelectedIds([])
      selectedIdsRef.current = []
      setSideTab('node')
    }
  }

  const updateNode = (id: string, patch: Partial<AgentNode>) =>
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }))

  const patchAnywhere = (id: string, patch: Partial<AgentNode>) =>
    setGraph((g) => mapNodes(g, (n) => (n.id === id ? { ...n, ...patch } : n)))

  const wrapSelection = (ids: string[]) => {
    const r = wrapInLoop(graphRef.current, ids)
    if (!r) return
    setGraph(r.graph)
    selectNode(r.id)
    pushLog('success', 'Seçilenler “Her Öğe İçin” kutusuna alındı. Sağ panelden listeyi doldur.')
  }

  const packSelection = () => {
    const ids = selectedIdsRef.current.length ? selectedIdsRef.current : selectedRef.current ? [selectedRef.current] : []
    const r = packageSelection(graphRef.current, ids)
    if (!r) {
      if (ids.length) pushLog('warn', 'Bu seçim tek girişli ve tek çıkışlı bir pakete kayıpsız alınamıyor. Dallanmanın devamını da seç veya adımları ayrı bırak; akış değiştirilmedi.')
      return
    }
    setGraph(r.graph)
    selectNode(r.id)
    pushLog(
      'success',
      r.absorbed
        ? 'Paket oluşturuldu. Seçim bir döngüye değdiği için kutu, bütün üyeleriyle birlikte içeri girdi.'
        : 'Paket oluşturuldu. İçine girince adımları düzenlersin.'
    )
  }

  const askSure = (question: string) =>
    new Promise<boolean>((resolve) => {
      confirmAnswer.current?.(false)
      confirmAnswer.current = resolve
      setConfirmQuestion(question)
    })

  const answerSure = (yes: boolean) => {
    const done = confirmAnswer.current
    confirmAnswer.current = null
    setConfirmQuestion(null)
    done?.(yes)
  }

  const askCanvasSave = (tab: { name: string }): Promise<SaveDecision> => new Promise(resolve => {
    saveAnswer.current = resolve
    setSaveQuestion(tab.name)
  })
  const answerCanvasSave = (answer: SaveDecision) => {
    const done = saveAnswer.current
    saveAnswer.current = null
    setSaveQuestion(null)
    done?.(answer)
  }
  const settleChanges = (ids?: string[]) => settleCanvasChanges(commitActive, askCanvasSave, async book => {
    if (!await persistBook(book)) return false
    adoptBook(book)
    return true
  }, ids)

  const canvasName = () => bookRef.current.tabs.find((t) => t.id === activeIdRef.current)?.name ?? 'Tuval'

  const switchTab = (id: string) => {
    if (runningRef.current || libraryBusyRef.current || id === activeIdRef.current) return
    showCanvas(commitActive(), id)
  }

  const addTab = () => {
    if (runningRef.current || libraryBusyRef.current) return
    const committed = commitActive()
    const name = nextCanvasName(committed.tabs)
    const book = addCanvasTab(committed, name, initialGraph())
    showCanvas(book, book.activeId)
    pushLog('info', `${name} açıldı.`)
  }

  const closeTab = async (id: string) => {
    if (runningRef.current || libraryBusyRef.current || closingRef.current || saveAnswer.current || confirmAnswer.current) return
    const looking = commitActive()
    const tab = looking.tabs.find((t) => t.id === id)
    if (!tab) return
    libraryBusyRef.current = true; setLibraryBusy(true)
    try {
      if (!await settleChanges([id])) return
      const wasOpen = id === activeIdRef.current
      const book = closeCanvasTab(commitActive(), id)
      if (!await persistBook(book)) return
      if (wasOpen) showCanvas(book, book.activeId, false)
      else adoptBook(book)
      pushLog('info', `${tab.name} kapatıldı.`)
    } finally { libraryBusyRef.current = false; setLibraryBusy(false) }
  }

  const renameTab = (id: string, name: string) => {
    if (runningRef.current || libraryBusyRef.current) return
    const clean = name.trim().slice(0, 48)
    if (!clean) return
    const base = id === activeIdRef.current ? commitActive() : bookRef.current
    if (!base.tabs.some((t) => t.id === id)) return
    rememberBook({ ...base, tabs: base.tabs.map((t) => (t.id === id ? { ...t, name: clean } : t)) })
  }

  /** Critical library writes are acknowledged before the UI discards or replaces data. */
  const saveLibraryChange = async (change: (book: CanvasBook) => CanvasBook, message: string, open = false, reviewingClose = false) => {
    if (!loaded || runningRef.current || libraryBusyRef.current || confirmAnswer.current || (!reviewingClose && closingRef.current) || saveAnswer.current) return false
    libraryBusyRef.current = true
    setLibraryBusy(true)
    try {
      const next = change(commitActive())
      if (!await persistBook(next)) return false
      if (open) showCanvas(next, next.activeId, false)
      else adoptBook(next)
      pushLog('success', message)
      return true
    } catch (e) { pushLog('error', errText(e)); return false }
    finally { libraryBusyRef.current = false; setLibraryBusy(false) }
  }
  const saveCurrentCanvas = () => saveLibraryChange(b => saveCanvas(b, b.activeId), `“${canvasName()}” Tuvaller'e kaydedildi.`)
  const openLibraryCanvas = (canvas: SavedCanvas) => saveLibraryChange(b => openSavedCanvas(b, canvas), `“${canvas.name}” yeni sekmede açıldı.`, true)
  const deleteLibraryCanvas = async (id: string) => {
    if (runningRef.current || libraryBusyRef.current) return
    const c = libraryOf(bookRef.current).canvases.find(c => c.id === id)
    if (!c || !await askSure(`“${c.name}” kayıtlı tuvalini silmek istediğinize emin misiniz? Bu kaydı kullanan otomasyonlardaki bağlantıları da silinecek. Açık çalışma sekmeleri silinmez.`)) return
    await saveLibraryChange(b => deleteSavedCanvas(b, id), `“${c.name}” kayıtlı tuvali silindi.`)
  }
  const closeLibraryCanvas = (id: string) => {
    const tabs = commitActive().tabs.filter(t => t.savedId === id)
    const tab = tabs.find(t => t.id === activeIdRef.current) ?? tabs[tabs.length - 1]
    if (tab) void closeTab(tab.id)
  }
  const saveAutomationEditor = async (draft: AutomationDraft): Promise<CanvasAutomation | null> => {
    let savedId: string | undefined
    const ok = await saveLibraryChange(b => {
      const next = saveAutomation(b, draft)
      savedId = draft.id ?? libraryOf(next).automations[libraryOf(next).automations.length - 1].id
      return next
    }, `“${draft.name.trim()}” otomasyon listesi kaydedildi.`, false, true)
    return ok ? libraryOf(bookRef.current).automations.find(a => a.id === savedId) ?? null : null
  }
  const loadAutomation = async (id: string) => {
    if (runningRef.current || libraryBusyRef.current || closingRef.current || saveAnswer.current || confirmAnswer.current) return false
    const a = libraryOf(bookRef.current).automations.find(a => a.id === id)
    if (!a?.entries.length) return false
    libraryBusyRef.current = true; setLibraryBusy(true)
    try {
      if (!await settleChanges()) return false
      const next = openAutomation(commitActive(), id)
      if (!await persistBook(next)) return false
      showCanvas(next, next.activeId, false)
      pushLog('success', `“${a.name}” tuval listesi açıldı.`)
      return true
    } catch (e) { pushLog('error', errText(e)); return false }
    finally { libraryBusyRef.current = false; setLibraryBusy(false) }
  }
  const removeAutomation = async (id: string) => {
    if (runningRef.current || libraryBusyRef.current) return
    const a = libraryOf(bookRef.current).automations.find(a => a.id === id)
    if (!a || !await askSure(`“${a.name}” otomasyonunu ve kayıtlı tuval listesini silmek istediğinize emin misiniz? Açık sekmeler ve ayrı tuval kayıtları silinmez.`)) return
    await saveLibraryChange(b => deleteAutomation(b, id), `“${a.name}” otomasyonu silindi.`)
  }
  const moveTab = (id: string, delta: -1 | 1) => {
    if (runningRef.current || libraryBusyRef.current) return
    void rememberBook(moveCanvasTab(commitActive(), id, delta))
  }
  const downloadJson = (value: unknown, name: string) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = fileNameFor(name); a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const exportAutomationFile = (id: string) => {
    try {
      const file = exportAutomation(commitActive(), id)
      downloadJson(file, `${file.name}.automation`)
      pushLog('info', `“${file.name}” otomasyonu dışa aktarıldı.`)
    } catch (e) { pushLog('error', errText(e)) }
  }

  const unpack = async (id: string) => {
    const yes = await askSure('Paketi çıkarmak istediğinize emin misiniz?')
    if (!yes) return
    const next = unpackPackage(graphRef.current, id)
    if (!next) return
    setGraph(next)
    setSelectedNodeId(null)
    setSelectedIds([])
    selectedIdsRef.current = []
    setSelectedEdgeId(null)
    pushLog('info', 'Paket açıldı. İçindeki adımlar tuvale geri kondu.')
  }

  const updatePackaged = (packageId: string, nodeId: string, patch: Partial<AgentNode>) => {
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) =>
        n.id === packageId && n.inner
          ? { ...n, inner: mapNodes(n.inner, (x) => (x.id === nodeId ? { ...x, ...patch } : x)) }
          : n
      ),
    }))
  }

  const enterPackage = (id: string) => navigateNode(id)
  const exitPackage = navigateOut

  const addNode = (kind: NodeKind) => {
    if (!activeIdRef.current || runningRef.current || libraryBusyRef.current || confirmAnswer.current || closingRef.current || saveAnswer.current) return
    const g = graphRef.current
    const sel = g.nodes.find((n) => n.id === selectedNodeId)
    const selPort = sel ? freePort(g, sel) : null
    const tail = chainTail(g)
    let res
    if (sel && selPort) res = addAfter(g, sel.id, selPort, kind)
    else if (tail && kind !== 'start') res = addAfter(g, tail.node.id, tail.port, kind)
    else res = addAt(g, kind, 60 + g.nodes.length * 20, 260 + g.nodes.length * 16)
    setGraph(res.graph)
    selectNode(res.id)
  }

  const deleteNode = (id: string) => {
    setGraph((g) => removeNode(g, id))
    const next = selectedIdsRef.current.filter((x) => x !== id)
    selectedIdsRef.current = next
    setSelectedIds(next)
    if (selectedNodeId === id) setSelectedNodeId(next[next.length - 1] ?? null)
  }

  const deleteSelection = () => {
    const ids = selectedIdsRef.current
    if (!ids.length) {
      if (selectedNodeId) deleteNode(selectedNodeId)
      return
    }
    setGraph((g) => ids.reduce((acc, id) => removeNode(acc, id), g))
    selectedIdsRef.current = []
    setSelectedIds([])
    setSelectedNodeId(null)
  }

  const deleteEdge = (id: string) => {
    setGraph((g) => ({ ...g, edges: g.edges.filter((e) => e.id !== id) }))
    if (selectedEdgeId === id) setSelectedEdgeId(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || (typeof t.closest === 'function' && (t.closest('[data-template-editor]') || t.closest('[data-template-field]'))))) return
      if (!activeIdRef.current || workspacePicker || confirmQuestion || saveAnswer.current || closingRef.current || runningRef.current || libraryBusyRef.current) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (scanner && mod) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedEdgeId) deleteEdge(selectedEdgeId)
        else if (selectedIdsRef.current.length || selectedNodeId) deleteSelection()
      } else if (mod && key === 'a') {
        e.preventDefault()
        selectMany(graphRef.current.nodes.map((n) => n.id), 'replace')
      } else if (mod && key === 'c') {
        const ids = selectedIdsRef.current.length ? selectedIdsRef.current : selectedNodeId ? [selectedNodeId] : []
        const clip = copyNodes(graphRef.current, ids)
        if (!clip) return
        e.preventDefault()
        clipRef.current = clip
        pushLog('info', `${clip.nodes.length} node kopyalandı.`)
      } else if (mod && key === 'x') {
        const ids = selectedIdsRef.current.length ? selectedIdsRef.current : selectedNodeId ? [selectedNodeId] : []
        const clip = copyNodes(graphRef.current, ids)
        if (!clip) return
        e.preventDefault()
        clipRef.current = clip
        const cut = clip.nodes.filter((n) => n.kind !== 'start').map((n) => n.id)
        if (cut.length) {
          setGraph((g) => {
            const next = cut.reduce((acc, id) => removeNode(acc, id), g)
            graphRef.current = next
            return next
          })
        }
        const stay = ids.filter((id) => graphRef.current.nodes.find((n) => n.id === id)?.kind === 'start')
        selectedIdsRef.current = stay
        setSelectedIds(stay)
        setSelectedNodeId(stay[0] ?? null)
        setSelectedEdgeId(null)
        pushLog('info', cut.length ? `${cut.length} node kesildi.` : 'Başlangıç kesilmez.')
      } else if (mod && key === 'v') {
        const clip = clipRef.current
        if (!clip) return
        e.preventDefault()
        const pasted = pasteNodes(graphRef.current, clip, pasteTargetRef.current?.())
        if (!pasted) {
          pushLog('warn', 'Yapıştırılacak node kalmadı. Bu tuvalde zaten bir Başlangıç var.')
          return
        }
        graphRef.current = pasted.graph
        setGraph(pasted.graph)
        setPasteRevision(revision => revision + 1)
        selectedIdsRef.current = pasted.ids
        setSelectedIds(pasted.ids)
        setSelectedNodeId(pasted.ids[pasted.ids.length - 1] ?? null)
        setSelectedEdgeId(null)
        pushLog('success', `${pasted.ids.length} node yapıştırıldı.`)
      } else if (mod && key === 'g') {
        e.preventDefault()
        const ids = selectedIdsRef.current.length ? selectedIdsRef.current : selectedNodeId ? [selectedNodeId] : []
        if (ids.length) wrapSelection(ids)
      } else if (mod && key === 'd' && selectedNodeId) {
        e.preventDefault()
        const r = duplicateNode(graphRef.current, selectedNodeId)
        if (r) {
          setGraph(r.graph)
          selectNode(r.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const saveSettings = async (partial: Partial<AppSettings>) => {
    if (api) {
      try {
        const next = await api.saveSettings(partial)
        setSettings({ ...DEFAULT_SETTINGS, ...next })
      } catch (e) {
        pushLog('error', errText(e))
        return
      }
    } else {
      const next = { ...settings, ...partial }
      setSettings(next)
      localStorage.setItem(LOCAL_SETTINGS, JSON.stringify(next))
    }
    const keys = Object.keys(partial)
    pushLog('success', keys.length > 2 ? 'Tüm ayarlar kaydedildi.' : `Kaydedildi: ${keys.join(', ')}`)
  }

  const captureAfterDelay = async (): Promise<Locator | null> => {
    setCapturing(3)
    const tick = setInterval(() => setCapturing((c) => Math.max(1, c - 1)), 1000)
    try {
      if (!api) {
        await new Promise((r) => setTimeout(r, 3000))
        return DEMO_CAPTURE
      }
      return await api.captureAfter(3000)
    } catch (e) {
      pushLog('error', `Yakalama başarısız: ${errText(e)}`)
      return null
    } finally {
      clearInterval(tick)
      setCapturing(0)
    }
  }

  const captureAsNewNode = async () => {
    pushLog('info', '3 saniye içinde imleci hedef uygulamadaki öğenin üstüne götür…')
    const loc = await captureAfterDelay()
    if (loc) appendCaptured(loc)
    else pushLog('warn', 'İmleç altında öğe bulunamadı.')
  }

  const captureForSelected = async () => {
    const id = selectedNodeId
    if (!id) return
    pushLog('info', '3 saniye içinde imleci hedef öğenin üstüne götür…')
    const loc = await captureAfterDelay()
    if (!loc) {
      pushLog('warn', 'İmleç altında öğe bulunamadı.')
      return
    }
    const node = graphRef.current.nodes.find((n) => n.id === id)
    const anchor = loc.x !== undefined && loc.y !== undefined ? { x: loc.x, y: loc.y } : undefined
    if (node?.kind === 'condition') {
      updateNode(id, { text: node.text?.trim() ? node.text : locText(loc), locator: loc })
    } else {
      updateNode(id, { locator: loc, anchor, prompt: node?.prompt?.trim() ? node.prompt : promptFor(loc) })
    }
    pushLog('success', `“${locText(loc) || loc.controlType}” node’a bağlandı.`)
  }

  const openScanner = (nodeId: string | null) => setScanner({ nodeId })

  const loopFolderGen = useRef(0)
  const loopFolderTimer = useRef<number | null>(null)
  const templateFillGen = useRef(0)
  const templateSeen = useRef(new Map<string, string>())

  const syncLoopFolder = (nodeId: string, folder: string, immediate = false) => {
    const gen = ++loopFolderGen.current
    if (loopFolderTimer.current) window.clearTimeout(loopFolderTimer.current)
    const trimmed = folder.trim()
    if (!trimmed) {
      templateSeen.current.delete(nodeId)
      patchAnywhere(nodeId, { folder, items: [], startIndex: 0, loopIndex: undefined })
      return
    }
    if (hasTemplate(folder)) {
      templateSeen.current.delete(nodeId)
      patchAnywhere(nodeId, { folder })
      return
    }
    patchAnywhere(nodeId, { folder })
    const run = async () => {
      if (!api?.listDir) return
      try {
        const files = await api.listDir(trimmed)
        if (gen !== loopFolderGen.current) return
        patchAnywhere(nodeId, { folder, items: files ?? [], startIndex: 0, loopIndex: undefined })
        if (!immediate) return
        pushLog(
          files && files.length ? 'success' : 'warn',
          files == null ? `Klasör yok: ${trimmed}` : `Klasörden ${files.length} öğe listeye eklendi: ${trimmed}`
        )
      } catch (e) {
        if (gen !== loopFolderGen.current) return
        pushLog('error', errText(e))
      }
    }
    if (immediate) void run()
    else loopFolderTimer.current = window.setTimeout(() => void run(), 400)
  }

  useEffect(() => {
    if (!loaded || !api?.listDir) return
    const gen = ++templateFillGen.current
    const timer = window.setTimeout(() => {
      void (async () => {
        const root = rooted(graphRef.current, stackRef.current)
        for (const loop of templateLoops(root)) {
          if (gen !== templateFillGen.current) return
          const resolved = outsideFolder(root, loop)
          const sig = `${loop.id}\n${resolved}`
          if (templateSeen.current.get(loop.id) === sig) continue
          const files = resolved ? await api.listDir(resolved) : []
          if (gen !== templateFillGen.current) return
          templateSeen.current.set(loop.id, sig)
          const next = files ?? []
          const cur = listItems(loop)
          if (cur.length === next.length && cur.every((v, i) => v === next[i])) continue
          patchAnywhere(loop.id, { items: next })
        }
      })().catch((e) => {
        if (gen === templateFillGen.current) pushLog('error', errText(e))
      })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [graph, stack, loaded, pushLog])

  const fillLoopFromFolder = async (nodeId: string) => {
    try {
      if (!api) {
        const r = await new Promise<{ folder: string; files: string[] } | null>((resolve) => {
          const input = document.createElement('input')
          input.type = 'file'
          input.setAttribute('webkitdirectory', '')
          input.onchange = () => {
            const files = Array.from(input.files ?? [])
              .map((f) => f.webkitRelativePath || f.name)
              .filter((p) => p.split('/').length <= 2)
              .sort((a, b) => a.localeCompare(b, 'tr', { numeric: true, sensitivity: 'base' }))
            resolve(files.length ? { folder: files[0]?.split('/')[0] ?? '', files } : null)
          }
          input.click()
        })
        if (!r) return
        patchAnywhere(nodeId, { items: r.files, folder: r.folder, loopIndex: undefined, startIndex: 0 })
        return
      }
      const dir = await api.pickDir()
      if (!dir) return
      syncLoopFolder(nodeId, dir, true)
    } catch (e) {
      pushLog('error', errText(e))
    }
  }

  const scanScreen = async (windowTitle: string, ramp?: { lo: number; hi: number }) => {
    if (!api) {
      await new Promise((r) => setTimeout(r, 400))
      return demoScan()
    }
    return api.scanScreen(windowTitle || undefined, ramp)
  }

  const pickScreenItem = async (item: ScreenItem) => {
    let text = item.text.trim()
    let fromPage = false
    if (api?.matchChrome) {
      try {
        const dom = await api.matchChrome({ x: item.x, y: item.y, w: item.w, h: item.h })
        if (dom?.text) {
          text = dom.text.trim()
          fromPage = true
        }
      } catch {
        /* port closed or the page moved; keep the scan text */
      }
    }
    const letters = (text.match(/\p{L}/gu) ?? []).length
    const meaningful = fromPage ? letters >= 1 : item.src === 'uia' ? letters >= 2 : letters >= 3 && letters / Math.max(1, text.length) >= 0.5
    const anchor = { x: Math.round(item.x + item.w / 2), y: Math.round(item.y + item.h / 2) }
    const node = scanner?.nodeId ? graphRef.current.nodes.find((n) => n.id === scanner.nodeId) : undefined
    setScanner(null)
    let loc: Locator | null = null
    if (api) {
      try {
        loc = await api.pickScreenBox({ x: item.x, y: item.y, w: item.w, h: item.h })
      } catch (e) {
        pushLog('warn', `Öğe yakalanamadı, sadece yazısı kullanılacak: ${errText(e)}`)
      }
    }
    if (loc) {
      const broad = ['Pane', 'Window', 'Document', 'Point', 'Custom'].includes(loc.controlType)
      loc = { ...loc, text: meaningful ? text : '', name: broad ? '' : loc.name }
    }
    const prompt = meaningful ? (node?.kind === 'type' ? `“${text}” alanı` : `“${text}” yazan yere tıkla`) : ''
    if (node?.kind === 'condition') {
      updateNode(node.id, { text: meaningful ? text : '', locator: loc ?? undefined })
    } else if (node && (node.kind === 'type' || node.kind === 'click')) {
      updateNode(node.id, { prompt, anchor, locator: loc ?? undefined, memory: undefined })
    } else {
      appendClick({ prompt, title: `Tıkla: ${meaningful ? text : 'simge'}`.slice(0, 40), anchor, locator: loc ?? undefined })
    }
    pushLog(
      'success',
      `Ekrandan seçildi: ${meaningful ? `“${text}”` : 'yazısız simge'}${fromPage ? ' (Chrome sayfasındaki yazı)' : ''}${loc?.icon ? ' (resmi de kaydedildi; yazı bulunamazsa ekranda resmi aranır)' : ''}${
        node ? ` → ${node.title}` : ' (yeni Tıkla node’u)'
      }`
    )
    if (!meaningful && !loc?.icon) pushLog('warn', 'Bu öğenin okunabilir yazısı yok ve resmi alınamadı. Tıklama yazı ya da simge bulamazsa UI-TARS’a kalır.')
  }

  const writeCanvas = (full: AgentGraph) => {
    const next = projectView(full, stackRef.current)
    graphRef.current = next.view
    stackRef.current = next.stack
    setStack(next.stack)
    setGraph(next.view)
  }

  const run = async (startId?: string) => {
    if (!loaded || closingRef.current || saveAnswer.current || runningRef.current || libraryBusyRef.current || confirmAnswer.current || !activeIdRef.current || graphRef.current.nodes.length === 0) return
    runningRef.current = true
    if (!startId) writeCanvas(resetLoopTicks(rooted(graphRef.current, stackRef.current)))
    const path = stackRef.current.map((c) => c.id)
    const full = path.length ? rooted(graphRef.current, stackRef.current) : graphRef.current
    const name = canvasName()
    setRunning(true)
    setStepStatus({})
    stopRequested.current = false
    setRunProgress(beginProgress(activeIdRef.current))
    let halted = true
    let failed = false
    pushLog('info', startId ? `“${name}” seçili adımdan çalışıyor…` : `“${name}” çalışıyor…`)
    try {
      if (api) {
        const result = await api.runAgent(full, startId, path)
        halted = !!result.stopped || !result.ok
        failed = !result.ok && !result.stopped
        // The agent log already explains each error; this one line says the run did not end clean.
        if (!result.ok && !result.stopped) pushLog('error', `“${name}” ${result.failed ?? 0} öğe/tur hatayla bitti, başarılı sayılmaz. Hatalar yukarıdaki kayıtlarda.`)
      } else {
        const result = await runDemo(full, settingsRef.current, pushLog, recordStep, startId, patchNode, path, false, recordEdge)
        halted = !!result.stopped || !result.ok
        failed = !result.ok && !result.stopped
      }
    } catch (e) {
      failed = true
      pushLog('error', errText(e))
    } finally {
      setRunProgress(prev => finishProgress(prev, halted || stopRequested.current, failed && !stopRequested.current))
      runningRef.current = false
      setRunning(false)
      runIdle.current?.(); runIdle.current = null
    }
  }

  const stop = () => {
    stopRequested.current = true
    sequenceRef.current.stop()
    if (api) void api.stopAgent().catch(e => pushLog('error', errText(e)))
    else stopDemo()
    pushLog('warn', 'Durdurma istendi…')
  }

  // Kullanıcı isteği: üstteki oynatma tuşu AKTİF tuvalden başlar ve SAĞA doğru devam eder.
  // "Seçiliden Çalıştır" ise aktif tuvali seçili ADIMDAN başlatır; o tuval Bitti'ye ulaşınca
  // sıra sağındaki tuvallerle devam eder (soldakiler çalıştırılmaz).
  const runAllCanvases = async (startNodeId?: string) => {
    if (!loaded || closingRef.current || saveAnswer.current || runningRef.current || libraryBusyRef.current || capturing || confirmAnswer.current) return
    // showCanvas clears the open package view. Capture its path before switching;
    // the selected node belongs to that package, not to the root canvas.
    const startPath = startNodeId ? stackRef.current.map(c => c.id) : []
    const book = commitActive()
    const from = book.tabs.findIndex(t => t.id === activeId)
    const ordered = from <= 0 ? book.tabs : book.tabs.slice(from)
    if (!ordered.length) { pushLog('warn', 'Oynatılacak tuval yok.'); return }
    runningRef.current = true
    setRunning(true)
    stopRequested.current = false
    let halted = true
    let failed = false
    try {
      pushLog('info', startNodeId
        ? `Aktif tuval seçili adımdan başlatılıyor; bitince sağdaki tuvallerle devam edilecek (${ordered.length} tuval).`
        : `Aktif tuvalden sağa doğru oynatılıyor (${ordered.length} tuval).`)
      const outcome = await sequenceRef.current.run(ordered, async (tab, index, total) => {
        // Selected-node runs resume the marked item. Only fresh canvases restart
        // their loops from the beginning, including every subsequent canvas.
        const prepared = { ...tab, graph: index === 0 && startNodeId ? tab.graph : resetLoopTicks(tab.graph) }
        const committed = commitActive()
        const next = activateCanvasSnapshot(committed, prepared)
        showCanvas(next, tab.id, false)
        setRunProgress(beginProgress(tab.id))
        setSequenceLabel(`${index + 1}/${total} · ${tab.name}`)
        const ilk = index === 0 ? startNodeId : undefined
        const path = index === 0 ? startPath : []
        pushLog('info', `Tuval sırası ${index + 1}/${total}: “${tab.name}” ${ilk ? 'seçili adımdan' : "Başlangıç'tan"} çalışıyor…`)
        if (!await rememberBook(next)) throw new Error('Tuval kaydedilemedi; sıra başlatılmadı.')
        if (sequenceRef.current.isCancelled()) return { ok: false, stopped: true }
        const result = api ? await api.runAgent(prepared.graph, ilk, path, { requireEnd: true })
          : await runDemo(prepared.graph, settingsRef.current, pushLog, recordStep, ilk, patchNode, path, true, recordEdge)
        if (!await rememberBook(commitActive())) throw new Error('Koşu sonrası tuval kaydedilemedi; sonraki tuval başlatılmadı.')
        return result
      })
      halted = outcome !== 'completed'
      pushLog(outcome === 'completed' ? 'success' : 'warn', outcome === 'completed' ? 'Aktif tuvalden sağa doğru bütün tuvaller Bitti node’una ulaştı.' : 'Tuval sırası durduruldu; kalan tuvaller çalıştırılmadı.')
    } catch (e) { failed = true; pushLog('error', errText(e)) }
    finally { setRunProgress(prev => finishProgress(prev, halted || stopRequested.current, failed && !stopRequested.current)); runningRef.current = false; setRunning(false); setSequenceLabel(''); runIdle.current?.(); runIdle.current = null }
  }

  const exportGraph = () => {
    downloadJson(rooted(graphRef.current, stackRef.current), canvasName())
    pushLog('info', `“${canvasName()}” dışa aktarıldı.`)
  }
  const importGraph = async (file: File) => {
    if (runningRef.current || libraryBusyRef.current) return
    try {
      const raw = JSON.parse(await file.text())
      if (raw?.format === 'nubbo-automation') {
        await saveLibraryChange(b => importAutomation(b, raw), `“${raw.name}” otomasyonu içe aktarıldı. Aç ile kayıtlı listeyi yükleyebilirsin.`)
        return
      }
      if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw new Error('Geçerli bir akış veya otomasyon JSON dosyası değil.')
      const g = reconcileLoopMembership(normalizeGraph(raw)), id = newId()
      const name = file.name.replace(/\.json$/i, '').trim().slice(0, 48) || 'Tuval'
      await saveLibraryChange(b => saveCanvas({ ...b, activeId: id, tabs: [...b.tabs, { id, name, graph: g }] }, id), `“${name}” kaydedildi ve yeni sekmede açıldı.`, true)
    } catch (e) { pushLog('error', `Dosya okunamadı: ${errText(e)}`) }
  }

  const resetLoops = async () => {
    let full = rooted(graphRef.current, stackRef.current)
    let ticks = 0
    full = mapNodes(full, (n) => {
      if (n.kind !== 'loop') return n
      if (!n.startIndex && n.loopIndex == null) return n
      ticks++
      return { ...n, startIndex: 0, loopIndex: undefined }
    })
    const find = (g: AgentGraph, id: string): AgentNode | undefined => {
      for (const n of g.nodes) {
        if (n.id === id) return n
        if (n.kind === 'package' && n.inner) {
          const hit = find(n.inner, id)
          if (hit) return hit
        }
      }
      return undefined
    }
    let lists = 0
    if (api?.listDir) {
      for (const id of templateLoops(full).map((n) => n.id)) {
        const loop = find(full, id)
        if (!loop) continue
        const resolved = outsideFolder(full, loop)
        let files: string[] | null = []
        try {
          files = resolved ? await api.listDir(resolved) : []
        } catch (e) {
          pushLog('error', errText(e))
          continue
        }
        const next = files ?? []
        const cur = listItems(loop)
        if (cur.length !== next.length || cur.some((v, i) => v !== next[i])) lists++
        full = mapNodes(full, (n) => (n.id === id ? { ...n, items: next, startIndex: 0, loopIndex: undefined } : n))
        templateSeen.current.set(id, `${id}\n${resolved}`)
      }
    }
    const total = templateLoops(full).length
    let boxes = 0
    mapNodes(full, (n) => {
      if (n.kind === 'loop' && !hasTemplate(n.folder)) boxes++
      return n
    })
    if (!ticks && !lists && boxes + total === 0) {
      pushLog('info', 'Bu tuvalde döngü yok.')
      return
    }
    writeCanvas(full)
    pushLog(
      'info',
      lists
        ? `${boxes + total} döngü 1. öğeye alındı. İç listeler dıştakinin ilk öğesine göre güncellendi.`
        : `${boxes + total} döngü 1. öğeye alındı.`
    )
  }

  const forgetAll = () => {
    let count = 0
    const wipe = (g: AgentGraph) =>
      mapNodes(g, (n) => {
        if (!n.memory?.length && !n.path?.length && !n.trace?.length) return n
        count++
        return { ...n, memory: undefined, path: undefined, trace: undefined }
      })
    const full = rooted(graphRef.current, stackRef.current)
    const cleared = wipe(full)
    if (!count) {
      pushLog('info', 'Silinecek hafıza yok.')
      return
    }
    writeCanvas(cleared)
    pushLog('info', `${count} node’un hafızası silindi. Bu tuvaldeki paketlerin içi de temizlendi.`)
  }

  const hasStart = graph.nodes.some((n) => n.kind === 'start')
  const counts = graph.nodes.filter((n) => n.kind !== 'start').length
  const hasCanvas = !!activeId
  const editorLocked = libraryBusy || closing || !!confirmQuestion || !!saveQuestion || !!workspacePicker

  const closeProgram = async (requestId?: number) => {
    if (closingRef.current) return
    if (!loaded || libraryBusyRef.current || confirmAnswer.current || saveAnswer.current || capturing || scanner) {
      pushLog('warn', 'Açık işlemi tamamladıktan sonra programı kapatabilirsiniz.')
      if (requestId !== undefined) await api?.finishClose?.(requestId, false)
      return
    }
    closingRef.current = true; setClosing(true)
    let allow = false
    try {
      if (runningRef.current) {
        const finished = new Promise<void>(resolve => { runIdle.current = resolve })
        stop()
        await finished
      }
      // Drain writes before final saves/discards; a delayed autosave cannot undo them.
      await writeQueue.current
      if (automationCloseReview.current && !await automationCloseReview.current()) {
        pushLog('error', 'Otomasyon düzenlemesi kaydedilemedi. Program açık bırakıldı; sağdaki listeden tekrar deneyin.')
        return
      }
      if (!await settleChanges()) return
      const next = emptyCanvasSession(commitActive())
      if (!await persistBook(next)) return
      showCanvas(next, '', false)
      allow = true
    } catch (e) { pushLog('error', errText(e)) }
    finally {
      try { if (requestId !== undefined) await api?.finishClose?.(requestId, allow) }
      catch (e) { pushLog('error', errText(e)) }
      finally { closingRef.current = false; setClosing(false) }
    }
  }
  const closeProgramRef = useRef(closeProgram)
  closeProgramRef.current = closeProgram
  useEffect(() => api?.onCloseRequested?.(id => {
    if (typeof id === 'number') void closeProgramRef.current(id)
  }), [])

  useEffect(() => {
    if (api) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const book = commitActive()
      if (!book.tabs.some(tab => canvasDirty(book, tab))) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [commitActive])

  return (
    <div className="desktop">
      <div className="xp-window">
        <TitleBar onClose={() => api ? void api.close() : void closeProgram()} />
        <div className="menubar">
          <div className="dropdown" ref={fileMenuRef}>
            <button type="button" className={fileOpen ? 'open' : ''} onClick={() => setFileOpen((o) => !o)}>
              Dosya
            </button>
            {fileOpen && (
              <div className="dropdown-menu file-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  disabled={running || editorLocked || !loaded}
                  onClick={() => {
                    setFileOpen(false)
                    fileRef.current?.click()
                  }}
                >
                  İçe Aktar
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!hasCanvas || editorLocked}
                  onClick={() => {
                    setFileOpen(false)
                    exportGraph()
                  }}
                >
                  Dışa Aktar
                </button>
                <button type="button" role="menuitem" disabled={!hasCanvas || running || editorLocked || !loaded} onClick={() => { setFileOpen(false); void saveCurrentCanvas() }}>Tuvali Kaydet</button>
              </div>
            )}
          </div>
          <button type="button" onClick={() => setSideTab('settings')}>
            Ayarlar
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void importGraph(f)
              e.target.value = ''
            }}
          />
          <span className="menubar-status">
            {hasCanvas ? `${tabList.find((t) => t.id === activeId)?.name ?? 'Tuval'} · ${counts} aşama · ${graph.edges.length} bağlantı` : 'Açık tuval yok'}
            {settings.targetWindow
              ? ` · hedef: ${settings.targetWindow}${
                  windows.length && !windows.some((w) => w.title === settings.targetWindow) ? ' (açık değil)' : ''
                }`
              : ' · hedef: tüm ekran'}
            {settings.apiKey ? '' : ' · API anahtarı yok'}
          </span>
        </div>
        <Toolbar
          running={running}
          busy={editorLocked || !loaded || !hasCanvas}
          hasStart={hasStart}
          hasSelection={!!selectedNodeId}
          capturing={capturing}
          onAdd={addNode}
          canPackage={selectedIds.length > 0}
          onPackage={packSelection}
          onCapture={captureAsNewNode}
          onOpenScanner={() => openScanner(null)}
          onRun={() => run()}
          onRunFromSelected={() => { if (selectedNodeId) void runAllCanvases(selectedNodeId) }}
          onStop={stop}
          onLayout={() => setGraph((g) => autoLayout(g))}
          onForget={forgetAll}
          onResetLoops={() => void resetLoops()}

        />
        <CanvasTabs
          tabs={tabList.map(tab => {
            const full = commitActive()
            const current = full.tabs.find(t => t.id === tab.id)
            return { ...tab, dirty: current ? canvasDirty(full, current) : false }
          })}
          activeId={activeId}
          disabled={running || editorLocked || !loaded}
          running={running}
          sequenceLabel={sequenceLabel}
          onRunAll={() => void runAllCanvases()}
          onStop={stop}
          onMove={moveTab}
          onSelect={switchTab}
          onAdd={addTab}
          onClose={(id) => void closeTab(id)}
          onRename={renameTab}
        />
        <div className="workspace">
          <div className="canvas-wrap">
            {stack.length > 0 && (
              <button type="button" className="xp-btn package-exit" disabled={editorLocked} onMouseDown={(e) => e.stopPropagation()} onClick={exitPackage}>
                Paketten çık
              </button>
            )}
            {hasCanvas ? <NodeCanvas
              graph={graph}
              canvasKey={JSON.stringify([activeId, ...stack.map(crumb => crumb.id)])}
              pasteRevision={pasteRevision}
              onPasteTarget={registerPasteTarget}
              focus={canvasFocus}
              selectedNodeId={selectedNodeId}
              selectedIds={selectedIds}
              selectedEdgeId={selectedEdgeId}
              stepStatus={stepStatus}
              highlightedNodeIds={visibleRunNodes(runProgress, rooted(graph, stack), graph, activeId)}
              runPhase={runProgress.canvasId === activeId ? runProgress.phase : 'idle'}
              traversedEdges={runProgress.canvasId === activeId ? runProgress.edges : undefined}
              running={running || editorLocked}
              onSelectNode={selectNode}
              onSelectMany={selectMany}
              onSelectEdge={selectEdge}
              onMoveNodes={(pos) =>
                setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (pos[n.id] ? { ...n, ...pos[n.id] } : n)) }))
              }
              onSetMembership={(ids, loopId) => {
                setGraph((g) => {
                  const moved = ids.length ? setMembership(g, ids, loopId) : g
                  return reconcileLoopMembership(moved)
                })
                if (!ids.length) return
                const g = graphRef.current
                const box = loopId ? g.nodes.find((n) => n.id === loopId) : null
                pushLog('info', box ? `${ids.length} node “${box.title}” kutusuna girdi.` : `${ids.length} node kutudan çıktı.`)
              }}
              onWrap={wrapSelection}
              onConnect={(from, port, to) => {
                const g = graphRef.current
                const target = g.nodes.find((n) => n.id === to)
                if (target && !NODE_SPECS[target.kind].hasInput) {
                  pushLog('warn', 'Başlangıç node’una bağlanamaz. Başa dönmek için ilk aşamaya bağla.')
                  return
                }
                setGraph(connect(g, from, port, to))
              }}
              onAddAfter={(fromId, port, kind) => {
                const r = addAfter(graphRef.current, fromId, port, kind)
                setGraph(r.graph)
                selectNode(r.id)
              }}
              onAddAt={(kind, x, y) => {
                const r = addAt(graphRef.current, kind, x, y)
                setGraph(r.graph)
                selectNode(r.id)
              }}
              onDeleteNode={deleteNode}
              onDeleteEdge={deleteEdge}
              onDuplicate={(id) => {
                const r = duplicateNode(graphRef.current, id)
                if (r) {
                  setGraph(r.graph)
                  selectNode(r.id)
                }
              }}
              onRunFrom={(id) => run(id)}
              onEnterPackage={enterPackage}
              onUnpackPackage={unpack}
            /> : <WorkspaceWelcome disabled={!loaded || editorLocked} onOpen={setWorkspacePicker} onNew={addTab} />}
          </div>
          <div className="right-sidebar">
            <fieldset className="canvas-editor-fields" disabled={editorLocked}>
          <SidePanel
            disabled={running || editorLocked}
            canvasPanel={<CanvasLibraryPanel library={library} tabs={bookRef.current.tabs} hasCanvas={hasCanvas} disabled={running || editorLocked || !loaded}
              onCloseReview={registerAutomationCloseReview}
              onConfirm={askSure}
              onSaveCanvas={() => void saveCurrentCanvas()}
              onOpenCanvas={c => void openLibraryCanvas(c)}
              onCloseCanvas={closeLibraryCanvas}
              onRenameCanvas={(id, name) => saveLibraryChange(b => renameSavedCanvas(b, id, name), 'Tuval adı depoda ve onu kullanan otomasyonlarda güncellendi.')}
              onDeleteCanvas={id => void deleteLibraryCanvas(id)}
              onOpenAutomation={id => void loadAutomation(id)}
              onSaveAutomation={saveAutomationEditor}
              onDeleteAutomation={id => void removeAutomation(id)}
              onExportAutomation={exportAutomationFile} />}
            tab={sideTab}
            onTab={setSideTab}
            settings={settings}
            setSettings={setSettings}
            onSaveSettings={saveSettings}
            windows={windows}
            onRefreshWindows={refreshWindows}
            models={models}
            onLoadModels={async () => {
              try {
                const list: ModelInfo[] = api
                  ? await api.listModels()
                  : (
                      (await (await fetch('https://openrouter.ai/api/v1/models')).json()).data as {
                        id: string
                        architecture?: { input_modalities?: string[] }
                      }[]
                    )
                      .map((m) => ({ id: m.id, vision: !!m.architecture?.input_modalities?.includes('image') }))
                      .sort((a, b) => a.id.localeCompare(b.id))
                setModels(list)
                const vision = list.filter((m) => m.vision).length
                pushLog('success', `${list.length} model yüklendi (${vision} tanesi ekran görüntüsü görebiliyor).`)
              } catch (e) {
                pushLog('error', errText(e))
              }
            }}
            onTestApi={async () => {
              if (!api) {
                pushLog('info', 'Önizlemede API testi yapılmaz.')
                return
              }
              try {
                const label = await api.testOpenRouter()
                pushLog('success', `OpenRouter anahtarı geçerli (${label}).`)
              } catch (e) {
                pushLog('error', errText(e))
              }
            }}
            onTestVision={async () => {
              if (!api) {
                pushLog('info', 'Önizlemede görsel test yapılmaz.')
                return
              }
              pushLog('info', 'Ekran görüntüsü alınıp görsel modele gönderiliyor…')
              try {
                const r = await api.testVision()
                pushLog('success', `Görsel model (${r.model}): ${r.text}`)
              } catch (e) {
                pushLog('error', errText(e))
              }
            }}
            graph={graph}
            rootGraph={rooted(graph, stack)}
            canvasName={tabList.find(t => t.id === activeId)?.name}
            canvasKey={activeId}
            onNavigateNode={navigateNode}
            locationName={stack.length ? stack.map(c => c.parent.nodes.find(n => n.id === c.id)?.title ?? 'Paket').join(' › ') : tabList.find(t => t.id === activeId)?.name}
            locationKey={JSON.stringify([activeId, ...stack.map(c => c.id)])}
            navigationDisabled={editorLocked || !hasCanvas}
            onNavigateBack={() => navigateHistory(-1)}
            onNavigateForward={() => navigateHistory(1)}
            onNavigateOut={navigateOut}
            canNavigateBack={navigation.index > 0}
            canNavigateForward={navigation.index < navigation.entries.length - 1}
            canNavigateOut={stack.length > 0}
            stepStatus={stepStatus}
            highlightedNodeIds={visibleRunNodes(runProgress, rooted(graph, stack), graph, activeId)}
            runPhase={runProgress.canvasId === activeId ? runProgress.phase : 'idle'}
            selected={selected}
            selectedCount={selectedIds.length}
            selectedEdge={selectedEdge}
            onUpdateNode={(patch) => selected && updateNode(selected.id, patch)}
            onDeleteNode={() => selected && deleteNode(selected.id)}
            onDeleteEdge={() => selectedEdge && deleteEdge(selectedEdge.id)}
            onCaptureForNode={captureForSelected}
            onOpenScanner={() => openScanner(selectedNodeId)}
            onFillFromFolder={(id) => fillLoopFromFolder(id)}
            onLoopFolder={(id, folder) => syncLoopFolder(id, folder)}
            onEnterPackage={enterPackage}
            onUnpackPackage={unpack}
            onUpdatePackaged={updatePackaged}
            onPickDir={async () => {
              if (api) return api.pickDir()
              return window.prompt('Klasör yolu') || null
            }}
            capturing={capturing}
          />
            </fieldset>
          </div>
          <LogPanel
            logs={logs}
            onClear={() => setLogs([])}
            onOpenFolder={
              api
                ? () => {
                    void api.openLogs().catch((e) => pushLog('error', errText(e)))
                  }
                : undefined
            }
          />
        </div>
      </div>
      {confirmQuestion && (
        <ConfirmDialog question={confirmQuestion} onYes={() => answerSure(true)} onNo={() => answerSure(false)} />
      )}
      {workspacePicker && <WorkspacePicker kind={workspacePicker} library={library} onCancel={() => setWorkspacePicker(null)}
        onOpen={async id => workspacePicker === 'automation' ? loadAutomation(id) : await openLibraryCanvas(library.canvases.find(c => c.id === id)!)} />}
      {saveQuestion !== null && <SaveCanvasDialog name={saveQuestion} onAnswer={answerCanvasSave} />}
      {scanner && (
        <ScreenScanner
          targetLabel={
            (scanner.nodeId && graph.nodes.find((n) => n.id === scanner.nodeId)?.title) || 'yeni Tıkla node’u'
          }
          windows={windows}
          defaultWindow={settings.targetWindow}
          valueLo={settings.valueLo}
          valueHi={settings.valueHi}
          onSave={async (lo, hi) => {
            setSettings((s) => ({ ...s, valueLo: lo, valueHi: hi }))
            if (api) await api.saveSettings({ valueLo: lo, valueHi: hi })
            else localStorage.setItem(LOCAL_SETTINGS, JSON.stringify({ ...settingsRef.current, valueLo: lo, valueHi: hi }))
          }}
          onScan={scanScreen}
          onPick={pickScreenItem}
          onClose={() => setScanner(null)}
        />
      )}
    </div>
  )
}
