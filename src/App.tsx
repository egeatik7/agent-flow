import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TitleBar from './components/TitleBar'
import Toolbar from './components/Toolbar'
import NodeCanvas from './components/NodeCanvas'
import SidePanel, { type SideTab } from './components/SidePanel'
import LogPanel from './components/LogPanel'
import ScreenScanner from './components/ScreenScanner'
import ConfirmDialog from './components/ConfirmDialog'
import {
  DEFAULT_SETTINGS,
  NODE_SPECS,
  createNode,
  newId,
  hasTemplate,
  listItems,
  normalizeGraph,
  type AgentGraph,
  type AgentNode,
  type AppSettings,
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
  duplicateNode,
  freePort,
  mapNodes,
  packageSelection,
  unpackPackage,
  removeNode,
  setMembership,
  wrapInLoop,
} from './lib/graph-ops'
import { outsideFolder, templateLoops } from '../electron/enclosing'
import { DEMO_CAPTURE, demoScan, runDemo, stopDemo } from './lib/demo'

const api = typeof window !== 'undefined' ? window.xpAgent : undefined

const LOCAL_GRAPH = 'xp-agent-graph'
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

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [graph, setGraph] = useState<AgentGraph>(initialGraph)
  const [stack, setStack] = useState<Crumb[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [capturing, setCapturing] = useState(0)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [scanner, setScanner] = useState<{ nodeId: string | null } | null>(null)
  const [windows, setWindows] = useState<{ title: string; handle: string }[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [stepStatus, setStepStatus] = useState<Record<string, StepStatus>>({})
  const [sideTab, setSideTab] = useState<SideTab>('node')
  const [loaded, setLoaded] = useState(false)
  const [confirmQuestion, setConfirmQuestion] = useState<string | null>(null)
  const confirmAnswer = useRef<((yes: boolean) => void) | null>(null)

  const graphRef = useRef(graph)
  graphRef.current = graph
  const stackRef = useRef(stack)
  stackRef.current = stack
  const selectedRef = useRef(selectedNodeId)
  selectedRef.current = selectedNodeId
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const fileRef = useRef<HTMLInputElement>(null)

  const pushLog = useCallback((level: LogLevel, message: string) => {
    setLogs((prev) => [...prev.slice(-400), { id: newId(), level, message, at: Date.now() }])
  }, [])

  const patchNode = useCallback((id: string, patch: Partial<AgentNode>) => {
    setGraph((g) => mapNodes(g, (n) => (n.id === id ? { ...n, ...patch } : n)))
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

  useEffect(() => {
    void (async () => {
      if (api) {
        setSettings({ ...DEFAULT_SETTINGS, ...(await api.getSettings()) })
        setGraph(normalizeGraph(await api.getGraph()))
        pushLog('info', 'Nubbo Agent Studio hazır.')
      } else {
        try {
          const g = localStorage.getItem(LOCAL_GRAPH)
          if (g) setGraph(normalizeGraph(JSON.parse(g)))
          const s = localStorage.getItem(LOCAL_SETTINGS)
          if (s) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(s) })
        } catch {
          /* corrupt local data, keep defaults */
        }
        pushLog('info', 'Tarayıcı önizlemesi: tıklamalar simüle edilir. Gerçek otomasyon Windows exe’de çalışır.')
      }
      setLoaded(true)
      void refreshWindows()
    })()
  }, [pushLog, refreshWindows])

  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => {
      const root = rooted(graphRef.current, stackRef.current)
      if (api) void api.saveGraph(root)
      else localStorage.setItem(LOCAL_GRAPH, JSON.stringify(root))
    }, 400)
    return () => clearTimeout(t)
  }, [graph, stack, loaded])

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

  useEffect(() => {
    if (!api) return
    const offLog = api.onAgentLog((payload) => {
      const p = payload as { level: LogLevel; message: string }
      pushLog(p.level, p.message)
    })
    const offStep = api.onAgentStep((payload) => {
      const p = payload as { id: string; status: StepStatus }
      setStepStatus((prev) => ({ ...prev, [p.id]: p.status }))
    })
    const offPatch = api.onAgentPatch((payload) => {
      const p = payload as { id: string; patch: Partial<AgentNode> }
      patchNode(p.id, p.patch)
    })
    return () => {
      offLog()
      offStep()
      offPatch()
    }
  }, [pushLog, patchNode])

  const selected = useMemo(() => graph.nodes.find((n) => n.id === selectedNodeId) ?? null, [graph.nodes, selectedNodeId])
  const selectedEdge = useMemo(() => graph.edges.find((e) => e.id === selectedEdgeId) ?? null, [graph.edges, selectedEdgeId])

  const selectNode = (id: string | null, additive = false) => {
    setSelectedEdgeId(null)
    if (!id) {
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
    if (next.length) setSideTab('node')
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
    if (!r) return
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
      confirmAnswer.current = resolve
      setConfirmQuestion(question)
    })

  const answerSure = (yes: boolean) => {
    const done = confirmAnswer.current
    confirmAnswer.current = null
    setConfirmQuestion(null)
    done?.(yes)
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

  const enterPackage = (id: string) => {
    const g = graphRef.current
    const n = g.nodes.find((x) => x.id === id && x.kind === 'package')
    if (!n) return
    setStack((s) => [...s, { parent: g, id }])
    setGraph(normalizeGraph(n.inner ?? { nodes: [], edges: [] }))
    setSelectedNodeId(null)
    setSelectedIds([])
    selectedIdsRef.current = []
    setSelectedEdgeId(null)
    setStepStatus({})
  }

  const exitPackage = () => {
    const s = stackRef.current
    const crumb = s[s.length - 1]
    if (!crumb) return
    const parent: AgentGraph = {
      ...crumb.parent,
      nodes: crumb.parent.nodes.map((n) => (n.id === crumb.id ? { ...n, inner: graphRef.current } : n)),
    }
    const nextStack = s.slice(0, -1)
    stackRef.current = nextStack
    setStack(nextStack)
    setGraph(parent)
    setSelectedNodeId(crumb.id)
    setSelectedIds([crumb.id])
    selectedIdsRef.current = [crumb.id]
    setSelectedEdgeId(null)
    setStepStatus({})
  }

  const addNode = (kind: NodeKind) => {
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
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedEdgeId) deleteEdge(selectedEdgeId)
        else if (selectedIdsRef.current.length || selectedNodeId) deleteSelection()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        const ids = selectedIdsRef.current.length ? selectedIdsRef.current : selectedNodeId ? [selectedNodeId] : []
        if (ids.length) wrapSelection(ids)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selectedNodeId) {
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
      patchAnywhere(nodeId, { folder, items: [], startIndex: 0, loopIndex: undefined, results: undefined })
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
        patchAnywhere(nodeId, { folder, items: files ?? [], startIndex: 0, loopIndex: undefined, results: undefined })
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
        patchAnywhere(nodeId, { items: r.files, folder: r.folder, loopIndex: undefined, startIndex: 0, results: undefined })
        return
      }
      const dir = await api.pickDir()
      if (!dir) return
      syncLoopFolder(nodeId, dir, true)
    } catch (e) {
      pushLog('error', errText(e))
    }
  }

  const scanScreen = async (windowTitle: string) => {
    if (!api) {
      await new Promise((r) => setTimeout(r, 400))
      return demoScan()
    }
    return api.scanScreen(windowTitle || undefined)
  }

  const pickScreenItem = async (item: ScreenItem) => {
    const text = item.text.trim()
    const letters = (text.match(/\p{L}/gu) ?? []).length
    const meaningful = item.src === 'uia' ? letters >= 2 : letters >= 3 && letters / Math.max(1, text.length) >= 0.5
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
      `Ekrandan seçildi: ${meaningful ? `“${text}”` : 'yazısız simge'}${loc?.icon ? ' (resmi de kaydedildi; yazı bulunamazsa ekranda resmi aranır)' : ''}${
        node ? ` → ${node.title}` : ' (yeni Tıkla node’u)'
      }`
    )
    if (!meaningful && !loc?.icon) pushLog('warn', 'Bu öğenin okunabilir yazısı yok ve resmi alınamadı; node’u “Ekran görüntüsüne bakarak yap” ile çalıştır.')
  }

  const run = async (startId?: string) => {
    if (graph.nodes.length === 0) return
    setRunning(true)
    setStepStatus({})
    pushLog('info', startId ? 'Seçili node’dan çalıştırılıyor…' : 'Ajan çalışıyor…')
    try {
      if (api) await api.runAgent(graph, startId)
      else
        await runDemo(graph, settings, pushLog, (id, s) => setStepStatus((prev) => ({ ...prev, [id]: s })), startId, patchNode)
    } catch (e) {
      pushLog('error', errText(e))
    } finally {
      setRunning(false)
    }
  }

  const stop = () => {
    if (api) void api.stopAgent()
    else stopDemo()
    pushLog('warn', 'Durdurma istendi…')
  }

  const exportGraph = () => {
    const blob = new Blob([JSON.stringify(rooted(graphRef.current, stackRef.current), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'nubbo-akis.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importGraph = async (file: File) => {
    try {
      setStack([])
      stackRef.current = []
      setGraph(normalizeGraph(JSON.parse(await file.text())))
      setSelectedNodeId(null)
      setStepStatus({})
      pushLog('success', `Akış yüklendi: ${file.name}`)
    } catch {
      pushLog('error', 'Dosya okunamadı (geçerli bir akış JSON’u değil).')
    }
  }

  const newFlow = () => {
    if (graph.nodes.length > 1 && !window.confirm('Mevcut akış silinsin mi?')) return
    setStack([])
    stackRef.current = []
    setGraph(initialGraph())
    setSelectedNodeId(null)
    setSelectedIds([])
    selectedIdsRef.current = []
    setSelectedEdgeId(null)
    setStepStatus({})
  }

  const forgetAll = () => {
    let count = 0
    const cleared = mapNodes(graph, (n) => {
      if (!n.memory?.length && !n.path?.length && !n.trace?.length) return n
      count++
      return { ...n, memory: undefined, path: undefined, trace: undefined }
    })
    if (!count) {
      pushLog('info', 'Silinecek hafıza yok.')
      return
    }
    setGraph(cleared)
    pushLog('info', `${count} node’un hafızası ve kayıtlı yolu silindi.`)
  }

  const hasStart = graph.nodes.some((n) => n.kind === 'start')
  const counts = graph.nodes.filter((n) => n.kind !== 'start').length

  return (
    <div className="desktop">
      <div className="xp-window">
        <TitleBar />
        <div className="menubar">
          <button type="button" onClick={exportGraph}>Dışa Aktar</button>
          <button type="button" onClick={() => fileRef.current?.click()}>İçe Aktar</button>
          <button type="button" onClick={() => setSideTab('settings')}>Ayarlar</button>
          <button type="button" onClick={() => openScanner(null)}>Ekran Tarayıcı</button>
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
            {counts} aşama · {graph.edges.length} bağlantı
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
          hasStart={hasStart}
          hasSelection={!!selectedNodeId}
          capturing={capturing}
          onAdd={addNode}
          canPackage={selectedIds.length > 0}
          onPackage={packSelection}
          onCapture={captureAsNewNode}
          onOpenScanner={() => openScanner(null)}
          onRun={() => run()}
          onRunFromSelected={() => selectedNodeId && run(selectedNodeId)}
          onStop={stop}
          onLayout={() => setGraph((g) => autoLayout(g))}
          onClear={newFlow}
          onForget={forgetAll}
        />
        <div className="workspace">
          <div className="canvas-wrap">
            {stack.length > 0 && (
              <button type="button" className="xp-btn package-exit" onMouseDown={(e) => e.stopPropagation()} onClick={exitPackage}>
                Paketten çık
              </button>
            )}
            <NodeCanvas
              graph={graph}
              selectedNodeId={selectedNodeId}
              selectedIds={selectedIds}
              selectedEdgeId={selectedEdgeId}
              stepStatus={stepStatus}
              running={running}
              onSelectNode={selectNode}
              onSelectMany={selectMany}
              onSelectEdge={selectEdge}
              onMoveNodes={(pos) =>
                setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (pos[n.id] ? { ...n, ...pos[n.id] } : n)) }))
              }
              onSetMembership={(ids, loopId) => {
                const g = graphRef.current
                const next = setMembership(g, ids, loopId)
                if (next === g) return
                setGraph(next)
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
              onPatchNode={updateNode}
            />
          </div>
          <SidePanel
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
      {scanner && (
        <ScreenScanner
          targetLabel={
            (scanner.nodeId && graph.nodes.find((n) => n.id === scanner.nodeId)?.title) || 'yeni Tıkla node’u'
          }
          windows={windows}
          defaultWindow={settings.targetWindow}
          onScan={scanScreen}
          onPick={pickScreenItem}
          onClose={() => setScanner(null)}
        />
      )}
    </div>
  )
}
