import { inspectRunStructure, type NamedStructureIssue, type StructureOptions } from '../electron/run-structure'
import { SettingsWriter, settingsDelta } from './lib/settings-writer'
import { mergeSettingsPatch, type SettingsPatch } from '../electron/settings-patch'
import { exportCanvasFile, readCanvasFile } from '../electron/canvas-file'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TitleBar from './components/TitleBar'
import TabletDialog from './components/TabletDialog'
import Toolbar from './components/Toolbar'
import CanvasTabs from './components/CanvasTabs'
import ZipCanvasLibrary, { ZipWorkspacePicker } from './components/ZipCanvasLibrary'
import { zipLibraryOf, openZipCanvas, openZipGroup, adoptZipLibrary, adoptZipCanvasRename, savedZipTab } from '../electron/zip-workspace'
import type { ZipCanvasGroup } from '../electron/zip-library-storage'
import type { ZipLibraryAction } from '../electron/zip-library-api'
import { addCanvasTab, closeCanvasTab, activateCanvasSnapshot, reorderCanvasTab } from '../electron/canvas-library'
import { CanvasSequence } from './lib/canvas-sequence'
import { beginProgress, finishProgress, progressEdge, progressStep, runNodeView, visibleRunNodes, type RunProgress } from './lib/run-progress'
import NodeCanvas from './components/NodeCanvas'
import { useRecoveryReports } from './hooks/useRecoveryReports'
import WorkspaceWelcome from './components/WorkspaceWelcome'
import { canvasView, emptyNavigation, visitLocation, type CanvasLocation } from './lib/canvas-navigation'
import SidePanel, { type SideTab } from './components/SidePanel'
import LogPanel from './components/LogPanel'
import ScreenScanner from './components/ScreenScanner'
import ConfirmDialog from './components/ConfirmDialog'
import SaveCanvasDialog from './components/SaveCanvasDialog'
import WorkspaceNameDialog from './components/WorkspaceNameDialog'
import MissingPathsNote from './components/MissingPathsNote'
import { collectLoopPaths, missingLoopPaths, type LoopPathReport } from './lib/item-paths'
import { canvasDirty, emptyCanvasSession, startCanvasSession, restoreCanvasDraft, discardCanvasDraft, type SaveDecision } from '../electron/canvas-session'
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
  type RecoveredCanvas,
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
  return { workspaceVersion: 3, activeId: '', tabs: [] }
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
  const raw = localStorage.getItem(LOCAL_BOOK)
  if (raw) return normalizeCanvasBook(JSON.parse(raw))
  const g = localStorage.getItem(LOCAL_GRAPH)
  if (g) {
    const legacy = normalizeGraph(JSON.parse(g))
    if (legacy.nodes.length) return normalizeCanvasBook(undefined, legacy)
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
  const [settingsSaveStatus, setSettingsSaveStatus] = useState('')
  const [savedSettings, setSavedSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const settingsWriter = useRef<SettingsWriter | null>(null)
  const [graph, setGraph] = useState<AgentGraph>({ nodes: [], edges: [] })
  const [activeId, setActiveId] = useState(book0.activeId)
  const [tabList, setTabList] = useState(book0.tabs.map((t) => ({ id: t.id, name: t.name })))
  const [stack, setStack] = useState<Crumb[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [pasteRevision, setPasteRevision] = useState(0)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const recoveryReports = useRecoveryReports(running)
  const localCatalogRequest = useRef(0)
  const [capturing, setCapturing] = useState(0)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [scanner, setScanner] = useState<{ nodeId: string | null } | null>(null)
  const [windows, setWindows] = useState<{ title: string; handle: string }[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [localCatalogBase, setLocalCatalogBase] = useState('')
  const [stepStatus, setStepStatus] = useState<Record<string, StepStatus>>({})
  const [runProgress, setRunProgress] = useState<RunProgress>(() => finishProgress(beginProgress(''), false))
  const stopRequested = useRef(false)
  const [workspacePicker, setWorkspacePicker] = useState<'canvas' | 'group' | null>(null)
  const [navigation, setNavigation] = useState(emptyNavigation)
  const navigationRef = useRef(navigation)
  navigationRef.current = navigation
  useEffect(() => { const next = emptyNavigation(); navigationRef.current = next; setNavigation(next) }, [activeId])
  const [canvasFocus, setCanvasFocus] = useState<{ nodeId: string; at: number }>()
  const [sideTab, setSideTab] = useState<SideTab>('canvases')
  const [fileOpen, setFileOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [tabletDialog,setTabletDialog]=useState(false)
  const [libraryDirectory, setLibraryDirectory] = useState('')
  const [zipLibrary, setZipLibrary] = useState(() => zipLibraryOf(book0))
  const [recovery, setRecovery] = useState<RecoveredCanvas[]>([])
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | 'error'>('saved')
  const [loadError, setLoadError] = useState('')
  const writeSerial = useRef(0)
  const [libraryBusy, setLibraryBusy] = useState(false)
  const libraryBusyRef = useRef(false)
  const sequenceRef = useRef(new CanvasSequence())
  const [sequenceLabel, setSequenceLabel] = useState('')
  const [confirmQuestion, setConfirmQuestion] = useState<string | null>(null)
  /** Koşu öncesi eksik döngü yolu raporu; açıkken koşu beklemede kalır. */
  const [missingReport, setMissingReport] = useState<{ items: LoopPathReport[]; structure?: NamedStructureIssue[]; answer: (run: boolean) => void } | null>(null)
  const missingAnswer = useRef<((run: boolean) => void) | null>(null)
  const confirmAnswer = useRef<((yes: boolean) => void) | null>(null)
  const [saveQuestion, setSaveQuestion] = useState<{ name: string; kind: 'canvas' } | null>(null)
  const [nameQuestion, setNameQuestion] = useState<{ kind: 'canvas'; tabId: string; initial: string } | null>(null)
  const saveAnswer = useRef<((answer: SaveDecision) => void) | null>(null)
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const runIdle = useRef<(() => void) | null>(null)
  const writeQueue = useRef<Promise<boolean>>(Promise.resolve(true))
  const canvasRenameFlush = useRef<(() => void) | null>(null)
  const registerCanvasRenameFlush = useCallback((flush: (() => void) | null) => { canvasRenameFlush.current = flush }, [])

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
    setZipLibrary(zipLibraryOf(book))
    setRecovery(book.recovery ?? [])
  }, [])

  
  const persistBook = useCallback((book: CanvasBook): Promise<boolean> => {
    const { zipLibrary: _library, ...session } = book
    const snapshot = structuredClone(session), serial = ++writeSerial.current
    setSaveStatus('saving')
    const next = writeQueue.current.then(async () => {
      try {
        if (api) { if (await api.saveCanvases(snapshot) === false) throw Error('Çalışma diske kaydedilemedi.') }
        else localStorage.setItem(LOCAL_BOOK, JSON.stringify(snapshot))
        if (serial === writeSerial.current) setSaveStatus('saved')
        return true
      } catch (e) { if (serial === writeSerial.current) setSaveStatus('error'); pushLog('error', `Çalışma kaydedilemedi: ${errText(e)}`); return false }
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
      try {
        if (api) {
          const loadedSettings = { ...DEFAULT_SETTINGS, ...(await api.getSettings()) }
          setSettings(loadedSettings); setSavedSettings(loadedSettings)
          if(api.libraryInfo)setLibraryDirectory((await api.libraryInfo()).directory)
          const book = startCanvasSession(normalizeCanvasBook(await api.getCanvases()))
          showCanvas(book, '', false)
          await persistBook(book)
          pushLog('info', 'Nubbo Agent Studio hazır.')
        } else {
          const book = startCanvasSession(previewBook())
          showCanvas(book, '', false)
          await persistBook(book)
          const s = localStorage.getItem(LOCAL_SETTINGS)
          if (s) { const loadedSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(s) }; setSettings(loadedSettings); setSavedSettings(loadedSettings) }
          pushLog('info', 'Tarayıcı önizlemesi: tıklamalar simüle edilir. Gerçek otomasyon Windows exe’de çalışır.')
        }
        setLoaded(true)
        void refreshWindows()
        requestAnimationFrame(() => requestAnimationFrame(() => api?.bootReady?.()))
      } catch (e) {
        // A read failure is never permission to overwrite the profile with defaults.
        setLoadError(errText(e)); pushLog('error', `Kayıtlar açılamadı: ${errText(e)}`)
        api?.bootReady?.()
      }
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
      if (ids.length) pushLog('warn', 'Bu seçim tek girişli ve tek çıkışlı bir pakete kayıpsız alınamıyor. Döngü üyesinden dışarı çıkan oku kutunun “bitti” çıkışına bağla; birden fazla dış kol varsa devamını da seç. Akış değiştirilmedi.')
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

  const askCanvasSave = (tab: { name: string }, kind: 'canvas' = 'canvas'): Promise<SaveDecision> => new Promise(resolve => {
    saveAnswer.current = resolve
    setSaveQuestion({ name: tab.name, kind })
  })
  const answerCanvasSave = (answer: SaveDecision) => {
    const done = saveAnswer.current
    saveAnswer.current = null
    setSaveQuestion(null)
    done?.(answer)
  }
  const settleChanges = async (ids = commitActive().tabs.map(t => t.id)) => {
    try {
      for (const id of ids) {
        const book = commitActive(), tab = book.tabs.find(t => t.id === id)
        if (!tab || !canvasDirty(book, tab)) continue
        const answer = await askCanvasSave(tab)
        if (answer === 'cancel') return false
        if (answer === 'save' && !await saveZipTabInternal(tab)) return false
      }
      return true
    } catch (error) { pushLog('error', errText(error)); return false }
  }

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
    if(bookRef.current.tabs.find(t=>t.id===id)?.name===name.trim())return
    const clean = name.trim().slice(0, 24)
    if (!clean) return
    const base = id === activeIdRef.current ? commitActive() : bookRef.current
    if (!base.tabs.some((t) => t.id === id)) return
    rememberBook({ ...base, tabs: base.tabs.map((t) => (t.id === id ? { ...t, name: clean } : t)) })
  }

  const saveZipTabInternal = async (tab: import('./types').CanvasTab, target?: ZipCanvasGroup, copy = false, name?: string): Promise<boolean> => {
    if (!api?.zipLibraryAction) { pushLog('error', 'ZIP kaydı masaüstü Nubbo’da kullanılabilir.'); return false }
    await writeQueue.current
    const library = zipLibraryOf(bookRef.current)
    const owner = !copy && tab.savedId ? library.groups.find(g => g.canvases.some(c => c.canvasId === tab.savedId)) : undefined
    const group = target ?? owner
    const result = await api.zipLibraryAction({ action: 'saveCanvas', tab: { ...tab, ...(name ? { name } : {}) }, copy, ...(group ? { id: group.id, revision: group.revision } : {}), ...(name ? { name } : {}) })
    if (!result?.canvas) return false
    const next = savedZipTab(commitActive(), tab.id, result.canvas, result.library)
    adoptBook(next)
    if (!await persistBook(next)) { pushLog('warn', `“${result.canvas.name}” ZIP’e kaydedildi; açık oturum kaydı başarısız. Çalışma açık tutuldu.`); return false }
    pushLog('success', `“${result.canvas.name}” ZIP’e kaydedildi.`); return true
  }
  const saveCurrentCanvas = async (group?: ZipCanvasGroup) => {
    if (runningRef.current || libraryBusyRef.current || closingRef.current) return false
    canvasRenameFlush.current?.(); const tab = commitActive().tabs.find(t => t.id === activeIdRef.current); if (!tab) return false
    libraryBusyRef.current = true; setLibraryBusy(true)
    try { const owner = zipLibraryOf(bookRef.current).groups.find(g => g.canvases.some(c => c.canvasId === tab.savedId)); return await saveZipTabInternal(tab, group, !!group && !!owner && group.id !== owner.id) }
    catch (error) { pushLog('error', errText(error)); return false }
    finally { libraryBusyRef.current = false; setLibraryBusy(false) }
  }
  const saveAllWorkspace = async () => {
    if (runningRef.current || libraryBusyRef.current) return false
    canvasRenameFlush.current?.(); libraryBusyRef.current = true; setLibraryBusy(true)
    try { for (const tab of commitActive().tabs) if ((!tab.savedId || canvasDirty(commitActive(), tab)) && !await saveZipTabInternal(tab)) return false; return true }
    catch (error) { pushLog('error', errText(error)); return false }
    finally { libraryBusyRef.current = false; setLibraryBusy(false) }
  }
  const askName = (kind: 'canvas') => {
    if (!loaded || runningRef.current || libraryBusyRef.current || closingRef.current || saveAnswer.current || confirmAnswer.current) return
    canvasRenameFlush.current?.(); setNameQuestion({ kind, tabId: activeIdRef.current, initial: `${canvasName().slice(0, 36)} (Kopya)` })
  }
  const answerName = async (name: string | null) => {
    const question = nameQuestion; setNameQuestion(null); if (!question || name === null) return
    const tab = commitActive().tabs.find(t => t.id === question.tabId); if (!tab) return
    libraryBusyRef.current = true; setLibraryBusy(true)
    try { await saveZipTabInternal(tab, undefined, true, name) } catch (error) { pushLog('error', errText(error)) }
    finally { libraryBusyRef.current = false; setLibraryBusy(false) }
  }
  const runZipAction = async (action: ZipLibraryAction) => {
    if (!api?.zipLibraryAction || runningRef.current || libraryBusyRef.current) return false
    libraryBusyRef.current = true; setLibraryBusy(true)
    try { await writeQueue.current; const result = await api.zipLibraryAction(action); if (!result) return false; const working = commitActive(); const next = action.action === 'renameCanvas' ? adoptZipCanvasRename(working, result.library, action.canvasId) : adoptZipLibrary(working, result.library); adoptBook(next); if (!await persistBook(next)) { pushLog('warn', 'ZIP işlemi uygulandı; açık oturum kaydı başarısız.'); return false }; return true }
    catch (error) {
      pushLog('error', errText(error))
      try { const refreshed = await api.manageLibrary?.('reload'); if (refreshed?.book) adoptBook(adoptZipLibrary(commitActive(), zipLibraryOf(refreshed.book))) } catch { /* The original error remains visible; working tabs are retained. */ }
      return false
    }
    finally { libraryBusyRef.current = false; setLibraryBusy(false) }
  }
  const openZipLibraryCanvas = async (id: string): Promise<boolean> => {
    if (runningRef.current || libraryBusyRef.current) return false
    try { const next = openZipCanvas(commitActive(), id); showCanvas(next, next.activeId); return true } catch (error) { pushLog('error', errText(error)); return false }
  }
  const loadZipGroup = async (id: string): Promise<boolean> => {
    if (runningRef.current || libraryBusyRef.current) return false
    libraryBusyRef.current = true; setLibraryBusy(true)
    try { if (!await settleChanges()) return false; const group = zipLibraryOf(bookRef.current).groups.find(g => g.id === id); if (!group) return false; const next = openZipGroup(commitActive(), group); if (!await persistBook(next)) return false; showCanvas(next, next.activeId, false); pushLog('success', `“${group.name}” ZIP sırasıyla soldan sağa açıldı.`); return true }
    catch (error) { pushLog('error', errText(error)); return false }
    finally { libraryBusyRef.current = false; setLibraryBusy(false) }
  }
  const newZipCanvas = async (group?: ZipCanvasGroup) => {
    if (runningRef.current || libraryBusyRef.current) return
    const next = addCanvasTab(commitActive(), nextCanvasName(bookRef.current.tabs), initialGraph()); showCanvas(next, next.activeId); if (group) await saveCurrentCanvas(group)
  }
  const recoverZipDraft = async (id: string, discard = false) => {
    if (runningRef.current || libraryBusyRef.current) return
    if (discard && !await askSure('Bu kurtarma taslağı kalıcı olarak silinsin mi?')) return
    libraryBusyRef.current = true; setLibraryBusy(true)
    try {
      const next = discard ? discardCanvasDraft(commitActive(), id) : restoreCanvasDraft(commitActive(), id)
      if (!await persistBook(next)) return
      if (discard) adoptBook(next); else showCanvas(next, next.activeId, false)
    } catch (error) { pushLog('error', errText(error)) }
    finally { libraryBusyRef.current = false; setLibraryBusy(false) }
  }
  const moveTab = (id:string,targetId:string,after:boolean) => {
    if (runningRef.current || libraryBusyRef.current) return
    void rememberBook(reorderCanvasTab(commitActive(),id,targetId,after))
  }
  const downloadJson = (value: unknown, name: string) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = fileNameFor(name); a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const manageLibrary = async (mode: 'open'|'reveal'|'reload') => {
    if(!api?.manageLibrary || runningRef.current || libraryBusyRef.current)return
    try {
      if(loaded && mode === 'open') {
        if(!await settleChanges())return
      }
      libraryBusyRef.current=true;setLibraryBusy(true)
      await writeQueue.current
      // Yeniden yükleme: kütüphane diskten tazelenir; AÇIK SEKMELER VE TASLAKLAR KORUNUR.
      if (mode === 'reload') {
        const result = await api.manageLibrary('reload')
        if (result?.book) {
          // Keep the current editor and original save baselines; only the ZIP snapshot is refreshed.
          adoptBook(adoptZipLibrary(commitActive(), zipLibraryOf(result.book)))
          pushLog('info', 'Kütüphane diskten yeniden yüklendi; açık sekmeler ve taslaklar korundu.')
        }
        return
      }
      const result=await api.manageLibrary(mode)
      if(result){setLibraryDirectory(result.directory);if(result.book){showCanvas(normalizeCanvasBook(result.book),result.book.activeId,false);setLoadError('');setLoaded(true)};pushLog('success','Kütüphane işlemi tamamlandı.')}
    } catch(e){pushLog('error',errText(e))}
    finally{libraryBusyRef.current=false;setLibraryBusy(false)}
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

  /** Başlangıç node'u silinmez: motor silinen Başlangıç yerine rastgele id'li yenisini enjekte eder. */
  const isStartNode = (id: string) => graphRef.current.nodes.find((n) => n.id === id)?.kind === 'start'

  const deleteNode = (id: string) => {
    if (isStartNode(id)) {
      pushLog('warn', 'Başlangıç node’u silinemez; akışın girişi olarak kalıyor.')
      return
    }
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
    // Çoklu seçimde Başlangıç ATLANIR; kalanlar silinir ve kullanıcıya kısa bir uyarı düşülür.
    const atlanan = ids.filter(isStartNode)
    const silinen = ids.filter((id) => !atlanan.includes(id))
    if (atlanan.length) pushLog('warn', 'Başlangıç node’u silinmedi; seçimdeki diğer node’lar silindi.')
    if (!silinen.length) {
      selectedIdsRef.current = atlanan
      setSelectedIds(atlanan)
      setSelectedNodeId(atlanan[0] ?? null)
      return
    }
    setGraph((g) => silinen.reduce((acc, id) => removeNode(acc, id), g))
    selectedIdsRef.current = atlanan
    setSelectedIds(atlanan)
    setSelectedNodeId(atlanan[0] ?? null)
  }

  const deleteEdge = (id: string) => {
    setGraph((g) => ({ ...g, edges: g.edges.filter((e) => e.id !== id) }))
    if (selectedEdgeId === id) setSelectedEdgeId(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 's') {
        e.preventDefault()
        if (!loaded || workspacePicker || nameQuestion || confirmQuestion || missingReport || saveAnswer.current || closingRef.current || runningRef.current || libraryBusyRef.current || scanner) return
        if (e.shiftKey) void saveAllWorkspace()
        else if (activeIdRef.current) void saveCurrentCanvas()
        return
      }
      const t = e.target as HTMLElement
      if(t?.closest?.('.canvas-library,.library-canvas-picker,.library-context-menu'))return
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || (typeof t.closest === 'function' && (t.closest('[data-template-editor]') || t.closest('[data-template-field]'))))) return
      if (!activeIdRef.current || workspacePicker || nameQuestion || confirmQuestion || missingReport || scanner || saveAnswer.current || closingRef.current || runningRef.current || libraryBusyRef.current) return
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

  if (!settingsWriter.current) settingsWriter.current = new SettingsWriter(
    async patch => {
      if (api) return api.saveSettings(patch)
      const previous = JSON.parse(localStorage.getItem(LOCAL_SETTINGS) || 'null') ?? DEFAULT_SETTINGS
      const next = mergeSettingsPatch(previous, patch)
      localStorage.setItem(LOCAL_SETTINGS, JSON.stringify(next))
      return next
    },
    (next, patch) => {
      setSavedSettings(next)
      // Store normalization must never erase a space/newline the user is currently typing.
      settingsRef.current = { ...settingsRef.current, modelRevision: next.modelRevision }
      setSettings(prev => ({ ...prev, modelRevision: next.modelRevision }))
      pushLog('success', `Kaydedildi: ${Object.keys(patch).join(', ')}`)
    },
    (pending, failed, error) => {
      if (error) pushLog('error', errText(error))
      setSettingsSaveStatus(pending ? 'Otomatik kaydediliyor…' : failed.length
        ? `Kaydedilemedi: ${failed.join(', ')}. Kaydet ile tekrar dene.`
        : 'Otomatik kaydedildi. Programı yeniden açınca da korunur.')
    },
  )
  const saveSettings = async (partial: SettingsPatch) => {
    const next = mergeSettingsPatch(settingsRef.current, partial)
    settingsRef.current = next; setSettings(next)
    await settingsWriter.current!.enqueue(partial)
  }
  const changeSettings: React.Dispatch<React.SetStateAction<AppSettings>> = action => {
    const before = settingsRef.current
    const next = typeof action === 'function' ? action(before) : action
    const patch = settingsDelta(before, next)
    if (Object.keys(patch).length) void saveSettings(patch)
  }
  const flushSettings = async () => {
    const ok = await settingsWriter.current!.flush()
    if (!ok) pushLog('error', 'Ayarlar kaydedilemedi; eski ayarlarla işlem başlatılmadı. Kaydet ile tekrar dene.')
    return ok
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
    if (node?.kind === 'condition') {
      pushLog('warn', 'Koşul artık seçim kullanmıyor; kutuya ne aradığını yaz.')
      return
    }
    const anchor = loc.x !== undefined && loc.y !== undefined ? { x: loc.x, y: loc.y } : undefined
    updateNode(id, { locator: loc, anchor, prompt: node?.prompt?.trim() ? node.prompt : promptFor(loc) })
    pushLog('success', `“${locText(loc) || loc.controlType}” node’a bağlandı.`)
  }

  const openScanner = (nodeId: string | null) => setScanner({ nodeId })

  const loopFolderPending = useRef(new Map<string, { timer?: number }>())
  const templateFillGen = useRef(0)
  const templateSeen = useRef(new Map<string, string>())

  useEffect(() => () => {
    for (const entry of loopFolderPending.current.values()) if (entry.timer !== undefined) window.clearTimeout(entry.timer)
    loopFolderPending.current.clear()
  }, [])

  const syncLoopFolder = (nodeId: string, folder: string, immediate = false) => {
    if (runningRef.current) return
    const canvasId = activeIdRef.current
    const key = JSON.stringify([canvasId, nodeId])
    const previous = loopFolderPending.current.get(key)
    if (previous?.timer !== undefined) window.clearTimeout(previous.timer)
    const pending: { timer?: number } = {}
    loopFolderPending.current.set(key, pending)
    const trimmed = folder.trim()
    // Apply to the initiating canvas even when the user has navigated elsewhere.
    const apply = (patch: Partial<AgentNode>) => {
      if (activeIdRef.current === canvasId) patchNode(nodeId, patch)
      else {
        const book = commitActive()
        void rememberBook({ ...book, tabs: book.tabs.map(tab => tab.id === canvasId
          ? { ...tab, graph: mapNodes(tab.graph, n => n.id === nodeId ? { ...n, ...patch } : n) } : tab) })
      }
    }
    if (!trimmed || hasTemplate(folder)) {
      loopFolderPending.current.delete(key)
      templateSeen.current.delete(nodeId)
      apply({ folder, ...(!trimmed ? { items: [], startIndex: 0, loopIndex: undefined } : {}) })
      return
    }
    apply({ folder })
    const run = async () => {
      if (!api?.listDir) return
      try {
        const files = await api.listDir(trimmed)
        if (loopFolderPending.current.get(key) !== pending) return
        apply({ folder, items: files ?? [], startIndex: 0, loopIndex: undefined })
        if (!immediate) return
        pushLog(files && files.length ? 'success' : 'warn',
          files == null ? `Klasör yok: ${trimmed}` : `Klasörden ${files.length} öğe listeye eklendi: ${trimmed}`)
      } catch (e) {
        if (loopFolderPending.current.get(key) === pending) pushLog('error', errText(e))
      } finally {
        if (loopFolderPending.current.get(key) === pending) loopFolderPending.current.delete(key)
      }
    }
    if (immediate) void run()
    else pending.timer = window.setTimeout(() => void run(), 400)
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
    if (node?.kind === 'condition') {
      pushLog('warn', 'Koşul artık seçim kullanmıyor; kutuya ne aradığını yaz.')
      return
    }
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
    if (node && (node.kind === 'type' || node.kind === 'click')) {
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

  /**
   * İlk işlemden önce dosya yollarını ve çalıştırılacak bütün tuvallerin yapısını denetler.
   * Yapısal hatalar engelleyicidir; uyarılar ve eksik yollar rapordan onaylanabilir.
   * Dosya kontrolü kullanılamasa bile yapısal kontrol atlanmaz.
   */
  const guardMissingPaths = async (tabs: ({ name: string; graph: AgentGraph } & StructureOptions)[]): Promise<boolean> => {
    const structure: NamedStructureIssue[] = tabs.flatMap(tab => inspectRunStructure(tab.graph, tab).map(issue => ({ ...issue, canvas: tab.name })))
    const candidates = collectLoopPaths(tabs)
    let missing: string[] = []
    if (api?.missingPaths && candidates.length) {
      try { missing = await api.missingPaths(candidates.map(c => c.path)) }
      catch (error) { pushLog('warn', `Dosya yolları denetlenemedi: ${errText(error)}`) }
    }
    if (stopRequested.current || closingRef.current) return false
    const items = missingLoopPaths(candidates, new Set(missing))
    if (!items.length && !structure.length) return true
    return await new Promise<boolean>(resolve => {
      const answer = (run: boolean) => {
        missingAnswer.current = null; setMissingReport(null)
        resolve(run && !structure.some(issue => issue.severity === 'error'))
      }
      missingAnswer.current = answer
      setMissingReport({ items, structure, answer })
    })
  }

  const run = async (startId?: string) => {
    if (!loaded || closingRef.current || saveAnswer.current || runningRef.current || libraryBusyRef.current || confirmAnswer.current || missingReport || !activeIdRef.current || graphRef.current.nodes.length === 0) return
    const path = stackRef.current.map(c => c.id)
    const full = structuredClone(path.length ? rooted(graphRef.current, stackRef.current) : graphRef.current)
    const name = canvasName()
    const canvasId = bookRef.current.tabs.find(t => t.id === activeIdRef.current)?.savedId ?? `tab:${activeIdRef.current}`
    runningRef.current = true
    setRunning(true)
    stopRequested.current = false
    let halted = true
    let failed = false
    pushLog('info', startId ? `“${name}” seçili adımdan çalışıyor…` : `“${name}” çalışıyor…`)
    try {
      if (!await flushSettings()) return
      if (!(await guardMissingPaths([{ name, graph: full, startId, packagePath: path }])) || stopRequested.current || closingRef.current) return
      if (!startId) { const reset = resetLoopTicks(full); full.nodes = reset.nodes; full.edges = reset.edges; writeCanvas(full) }
      setStepStatus({})
      setRunProgress(beginProgress(activeIdRef.current))
      if (api) {
        const result = await api.runAgent(full, startId, path, { canvasId })
        halted = !!result.stopped || !result.ok
        failed = !result.ok && !result.stopped
        // The agent log already explains each error; this one line says the run did not end clean.
        if (!result.ok && !result.stopped) pushLog('error', (result.failed ?? 0) > 0 ? `“${name}” ${result.failed} öğe/tur hatayla bitti. Ayrıntılar yukarıdaki kayıtlarda.` : `“${name}” tamamlanmadan sonlandı. Ayrıntılar yukarıdaki kayıtlarda.`)
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
    missingAnswer.current?.(false)
    sequenceRef.current.stop()
    if (api) void api.stopAgent().catch(e => pushLog('error', errText(e)))
    else stopDemo()
    pushLog('warn', 'Durdurma istendi…')
  }

  // Kullanıcı isteği: üstteki oynatma tuşu AKTİF tuvalden başlar ve SAĞA doğru devam eder.
  // "Seçiliden Çalıştır" ise aktif tuvali seçili ADIMDAN başlatır; o tuval Bitti'ye ulaşınca
  // sıra sağındaki tuvallerle devam eder (soldakiler çalıştırılmaz).
  const runAllCanvases = async (startNodeId?: string) => {
    if (!loaded || closingRef.current || saveAnswer.current || runningRef.current || libraryBusyRef.current || capturing || confirmAnswer.current || missingReport) return
    // showCanvas clears the open package view. Capture its path before switching;
    // the selected node belongs to that package, not to the root canvas.
    const startPath = startNodeId ? stackRef.current.map(c => c.id) : []
    const book = commitActive()
    const from = book.tabs.findIndex(t => t.id === activeId)
    const ordered = structuredClone(from <= 0 ? book.tabs : book.tabs.slice(from))
    if (!ordered.length) { pushLog('warn', 'Oynatılacak tuval yok.'); return }
    runningRef.current = true
    setRunning(true)
    stopRequested.current = false
    let halted = true
    let failed = false
    try {
      if (!await flushSettings()) return
      if (!(await guardMissingPaths(ordered.map((t, i) => ({ name: t.name, graph: t.graph, requireEnd: true, ...(i === 0 ? { startId: startNodeId, packagePath: startPath } : {}) })))) || stopRequested.current || closingRef.current) return
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
        const result = api ? await api.runAgent(prepared.graph, ilk, path, { requireEnd: true, canvasId: tab.savedId ?? `tab:${tab.id}` })
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
    const book = commitActive(), tab = book.tabs.find(t => t.id === book.activeId)
    if (!tab) return
    downloadJson(exportCanvasFile(tab), tab.name)
    pushLog('info', `“${tab.name}” kimliğiyle dışa aktarıldı.`)
  }
  const importGraph = async (file: File) => {
    if (runningRef.current || libraryBusyRef.current) return
    try {
      const document = readCanvasFile(JSON.parse(await file.text()), file.name.replace(/\.json$/i, ''))
      const next = addCanvasTab(commitActive(), document.name, reconcileLoopMembership(document.graph))
      next.tabs[next.tabs.length - 1].canvasId = document.id ?? next.tabs[next.tabs.length - 1].canvasId
      showCanvas(next, next.activeId); pushLog('info', 'JSON çalışma sekmesinde açıldı; ZIP’e eklemek için Kaydet.')
    } catch (error) { pushLog('error', errText(error)) }
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
  const editorLocked = libraryBusy || closing || !!confirmQuestion || !!saveQuestion || !!workspacePicker || !!nameQuestion

  const closeProgram = async (requestId?: number) => {
    if (closingRef.current) return
    if (loadError) {
      // Loading failed, so there is no editable session to save or discard.
      // Permit a normal close without touching the unread profile.
      if (requestId !== undefined) await api?.finishClose?.(requestId, true)
      return
    }
    if (!loaded || libraryBusyRef.current || confirmAnswer.current || saveAnswer.current || nameQuestion || capturing || scanner) {
      pushLog('warn', 'Açık işlemi tamamladıktan sonra programı kapatabilirsiniz.')
      if (requestId !== undefined) await api?.finishClose?.(requestId, false)
      return
    }
    canvasRenameFlush.current?.()
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
      if (!await flushSettings()) return
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
      if (!loaded) return
      const book = commitActive()
      // Synchronously preserve settings and canvas before browser reload.
      try { localStorage.setItem(LOCAL_SETTINGS, JSON.stringify(settingsRef.current)); localStorage.setItem(LOCAL_BOOK, JSON.stringify(book)) } catch { /* native prompt still protects the page */ }
      if (!book.tabs.some(tab => canvasDirty(book, tab))) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [commitActive, loaded])

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
                <button type="button" role="menuitem" disabled={!hasCanvas || running || editorLocked || !loaded} onClick={() => { setFileOpen(false); void saveCurrentCanvas() }}>Tuvali Kaydet · Ctrl+S</button>
                <button type="button" role="menuitem" disabled={!hasCanvas || running || editorLocked || !loaded} onClick={() => { setFileOpen(false); askName('canvas') }}>Tuvali Farklı Kaydet</button>
                <button type="button" role="menuitem" disabled={running || editorLocked || !loaded} onClick={() => { setFileOpen(false); void saveAllWorkspace() }}>Tümünü Kaydet · Ctrl+Shift+S</button>
              </div>
            )}
          </div>
          <button type="button" onClick={() => setSideTab('settings')}>
            Ayarlar
          </button>
          {api?.viewerInfo&&<button type="button" onClick={()=>setTabletDialog(true)}>Tablet İzleme</button>}
          {tabletDialog&&<TabletDialog onClose={()=>setTabletDialog(false)}/>}
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
            <span className={`workspace-save-status ${saveStatus}`} role="status">{saveStatus === 'saving' ? 'Taslak yazılıyor…' : saveStatus === 'error' ? 'Taslak kaydı başarısız' : 'Taslak güncel'} · </span>
            {hasCanvas ? `${tabList.find((t) => t.id === activeId)?.name ?? 'Tuval'} · ${counts} aşama · ${graph.edges.length} bağlantı` : 'Açık tuval yok'}
            {settings.targetWindow
              ? ` · hedef: ${settings.targetWindow}${
                  windows.length && !windows.some((w) => w.title === settings.targetWindow) ? ' (açık değil)' : ''
                }`
              : ' · hedef: tüm ekran'}
            {settings.apiKey ? '' : ' · API anahtarı yok'}
          </span>
          {saveStatus === 'error' && <button className="xp-btn" disabled={!loaded || editorLocked || running} onClick={() => void rememberBook(commitActive())}>Kaydı Tekrar Dene</button>}
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
          onRegisterRenameFlush={registerCanvasRenameFlush}
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
          onReorder={moveTab}
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
              searchGraph={rooted(graph, stack)}
              searchScopeKey={activeId ?? undefined}
              onSearchNavigate={hit => applyLocation({ path: hit.path, nodeId: hit.nodeId }, true)}
              onExitPackage={exitPackage}
              canExitPackage={stack.length > 0}
              recoveryReports={recoveryReports}
              reportCanvasId={bookRef.current.tabs.find(t => t.id === activeId)?.savedId ?? `tab:${activeId}`}
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
            /> : loadError ? <div className="workspace-load-error" role="alert"><h2>Kayıtlar açılamadı</h2><p>{loadError}</p><p>Mevcut kayıtlar korunuyor. Kütüphane klasörünü taşıdıysan yeni konumundan açabilirsin.</p>{api?.manageLibrary && <button className="xp-btn" disabled={libraryBusy} onClick={()=>void manageLibrary('open')}>Kütüphane Aç…</button>}</div> : <WorkspaceWelcome disabled={!loaded || editorLocked} onOpen={setWorkspacePicker} onNew={addTab} />}
          </div>
          <div className="right-sidebar">
            <fieldset className="canvas-editor-fields" disabled={editorLocked || !loaded}>
          <SidePanel
            disabled={running || editorLocked}
            canvasPanel={<ZipCanvasLibrary library={zipLibrary} disabled={running || editorLocked || !loaded}
              onAction={runZipAction} onOpenCanvas={id => void openZipLibraryCanvas(id)} onOpenGroup={id => void loadZipGroup(id)}
              onNewCanvas={group => void newZipCanvas(group)} onSaveCanvas={group => void saveCurrentCanvas(group)}
              onManage={mode => void manageLibrary(mode)} onConfirm={askSure}
              recovery={recovery} onRecover={id => void recoverZipDraft(id)} onDiscardRecovery={id => void recoverZipDraft(id, true)} />}
            tab={sideTab}
            onTab={setSideTab}
            settings={settings}
            setSettings={changeSettings}
            onSaveSettings={saveSettings}
            settingsSaveStatus={settingsSaveStatus}
            savedSettings={savedSettings}
            windows={windows}
            onRefreshWindows={refreshWindows}
            models={models.filter(m => !m.id.startsWith('local:') || localCatalogBase === (settings.localBaseUrl ?? '').trim()).map(m =>
              m.id.startsWith('local:') ? { ...m, vision: m.vision || settings.localVision === true } : m)}
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
                setModels(prev => [...list, ...prev.filter(m => m.id.startsWith('local:'))])
                const vision = list.filter((m) => m.vision).length
                pushLog('success', `${list.length} model yüklendi (${vision} tanesi ekran görüntüsü görebiliyor).`)
              } catch (e) {
                pushLog('error', errText(e))
                throw e
              }
            }}
            onBeforeLocalChat={flushSettings}
            onLoadLocalModels={async () => {
              const request = ++localCatalogRequest.current
              try {
                if (!await flushSettings()) throw new Error('Ayar kaydı tamamlanamadı.')
                const base = (settingsRef.current.localBaseUrl ?? '').trim()
                if (!api?.listLocalModels) throw new Error('Yerel bağlantı testi masaüstü uygulamasında kullanılabilir.')
                const list = await api.listLocalModels(base)
                if (request !== localCatalogRequest.current) return []
                if (base !== (settingsRef.current.localBaseUrl ?? '').trim()) throw new Error('Sunucu adresi değişti. Yeni adres için listeyi tekrar getir.')
                setLocalCatalogBase(base)
                setModels((prev) => [...prev.filter((m) => !m.id.startsWith('local:')), ...list.map((m) => ({ id: `local:${m.id}`, vision: m.vision }))])
                pushLog('success', `Yerel model listesi: ${list.length} model${base ? ` · ${base}` : ''}.`)
                return list
              } catch (e) {
                pushLog('error', errText(e))
                throw e
              }
            }}
            onTestApi={async () => {
              if (!api) {
                pushLog('info', 'Önizlemede API testi yapılmaz.')
                return
              }
              try {
                if (!await flushSettings()) return
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
                if (!await flushSettings()) return
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
      {workspacePicker && <ZipWorkspacePicker kind={workspacePicker} library={zipLibrary} onCancel={() => setWorkspacePicker(null)} onOpen={id => workspacePicker === 'canvas' ? openZipLibraryCanvas(id) : loadZipGroup(id)} />}

      {missingReport && <MissingPathsNote items={missingReport.items} structure={missingReport.structure} onAnswer={(a) => missingReport.answer(a === 'run')} />}
      {saveQuestion !== null && <SaveCanvasDialog name={saveQuestion.name} kind={saveQuestion.kind} onAnswer={answerCanvasSave} />}
      {nameQuestion && <WorkspaceNameDialog title={'Tuvali Farklı Kaydet'} initial={nameQuestion.initial} onAnswer={name => void answerName(name)} />}
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
            await saveSettings({ valueLo: lo, valueHi: hi })
          }}
          onScan={scanScreen}
          onPick={pickScreenItem}
          onClose={() => setScanner(null)}
        />
      )}
    </div>
  )
}
