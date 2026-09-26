import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TitleBar from './components/TitleBar'
import Toolbar from './components/Toolbar'
import NodeCanvas from './components/NodeCanvas'
import SidePanel, { type SideTab } from './components/SidePanel'
import LogPanel from './components/LogPanel'
import Taskbar from './components/Taskbar'
import ScreenScanner from './components/ScreenScanner'
import {
  DEFAULT_SETTINGS,
  NODE_SPECS,
  createNode,
  newId,
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
  removeNode,
} from './lib/graph-ops'
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

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [graph, setGraph] = useState<AgentGraph>(initialGraph)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [running, setRunning] = useState(false)
  const [capturing, setCapturing] = useState(0)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [scanner, setScanner] = useState<{ nodeId: string | null } | null>(null)
  const [windows, setWindows] = useState<{ title: string; handle: string }[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [stepStatus, setStepStatus] = useState<Record<string, StepStatus>>({})
  const [sideTab, setSideTab] = useState<SideTab>('node')
  const [loaded, setLoaded] = useState(false)

  const graphRef = useRef(graph)
  graphRef.current = graph
  const selectedRef = useRef(selectedNodeId)
  selectedRef.current = selectedNodeId
  const recordTailRef = useRef<{ id: string; port: string } | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const fileRef = useRef<HTMLInputElement>(null)

  const pushLog = useCallback((level: LogLevel, message: string) => {
    setLogs((prev) => [...prev.slice(-300), { id: newId(), level, message, at: Date.now() }])
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
        pushLog('info', 'XP Agent Studio hazır.')
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
      if (api) void api.saveGraph(graph)
      else localStorage.setItem(LOCAL_GRAPH, JSON.stringify(graph))
    }, 400)
    return () => clearTimeout(t)
  }, [graph, loaded])

  const appendClick = useCallback((c: NewClick) => {
    const g = graphRef.current
    let tailRef = recordTailRef.current
    if (!tailRef || !g.nodes.some((n) => n.id === tailRef!.id)) {
      const sel = g.nodes.find((n) => n.id === selectedRef.current)
      const port = sel ? freePort(g, sel) : null
      const tail = chainTail(g)
      tailRef = sel && port ? { id: sel.id, port } : tail ? { id: tail.node.id, port: tail.port } : null
    }
    const res = tailRef ? addAfter(g, tailRef.id, tailRef.port, 'click') : addAt(g, 'click', 300, 80)
    const next = {
      ...res.graph,
      nodes: res.graph.nodes.map((n) =>
        n.id === res.id ? { ...n, prompt: c.prompt, locator: c.locator, anchor: c.anchor, title: c.title.slice(0, 40) } : n
      ),
    }
    recordTailRef.current = { id: res.id, port: 'next' }
    setGraph(next)
    setSelectedNodeId(res.id)
    setSelectedEdgeId(null)
  }, [])

  const appendRecorded = useCallback(
    (loc: Locator) => {
      const t = locText(loc)
      appendClick({
        prompt: promptFor(loc),
        title: `Tıkla: ${t || loc.controlType}`,
        locator: loc,
        anchor: loc.x !== undefined && loc.y !== undefined ? { x: loc.x, y: loc.y } : undefined,
      })
      pushLog('success', `Kaydedildi: ${promptFor(loc)}${loc.windowTitle ? ` — ${loc.windowTitle}` : ''}`)
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
    const offRec = api.onRecordEvent((payload) => appendRecorded(payload as Locator))
    const offAnchor = api.onAgentAnchor((payload) => {
      const p = payload as { id: string; x: number; y: number }
      setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === p.id ? { ...n, anchor: { x: p.x, y: p.y } } : n)) }))
    })
    return () => {
      offLog()
      offStep()
      offRec()
      offAnchor()
    }
  }, [pushLog, appendRecorded])

  const selected = useMemo(() => graph.nodes.find((n) => n.id === selectedNodeId) ?? null, [graph.nodes, selectedNodeId])
  const selectedEdge = useMemo(() => graph.edges.find((e) => e.id === selectedEdgeId) ?? null, [graph.edges, selectedEdgeId])

  const selectNode = (id: string | null) => {
    setSelectedNodeId(id)
    if (id) {
      setSelectedEdgeId(null)
      setSideTab('node')
    }
  }
  const selectEdge = (id: string | null) => {
    setSelectedEdgeId(id)
    if (id) {
      setSelectedNodeId(null)
      setSideTab('node')
    }
  }

  const updateNode = (id: string, patch: Partial<AgentNode>) =>
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }))

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
    if (selectedNodeId === id) setSelectedNodeId(null)
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
        else if (selectedNodeId) deleteNode(selectedNodeId)
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

  const toggleRecord = async () => {
    if (recording) {
      await api?.stopRecord()
      setRecording(false)
      recordTailRef.current = null
      pushLog('info', 'Kayıt durduruldu.')
      return
    }
    recordTailRef.current = null
    setRecording(true)
    if (api) {
      const real = await api.startRecord()
      pushLog(
        'info',
        real
          ? 'Kayıt açık: hedef uygulamada tıkladığın her öğe sıradaki node olarak eklenecek. Bitince “Kaydı Durdur”.'
          : 'Kayıt yalnızca Windows’ta gerçek tıklamaları yakalar.'
      )
    } else {
      pushLog('info', 'Önizleme: “Öğe Yakala” ile örnek kayıt ekleyebilirsin.')
    }
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
    if (loc) appendRecorded(loc)
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
    if (node?.kind === 'waitFor' || node?.kind === 'condition') {
      updateNode(id, { text: locText(loc) })
    } else {
      updateNode(id, { locator: loc, anchor, prompt: node?.prompt?.trim() ? node.prompt : promptFor(loc) })
    }
    pushLog('success', `“${locText(loc) || loc.controlType}” node’a bağlandı.`)
  }

  const openScanner = (nodeId: string | null) => setScanner({ nodeId })

  const scanScreen = async (windowTitle: string) => {
    if (!api) {
      await new Promise((r) => setTimeout(r, 400))
      return demoScan()
    }
    return api.scanScreen(windowTitle || undefined)
  }

  const pickScreenItem = (item: ScreenItem) => {
    const text = item.text.trim()
    const anchor = { x: Math.round(item.x + item.w / 2), y: Math.round(item.y + item.h / 2) }
    const node = scanner?.nodeId ? graphRef.current.nodes.find((n) => n.id === scanner.nodeId) : undefined
    if (node && (node.kind === 'waitFor' || node.kind === 'condition')) {
      updateNode(node.id, { text })
    } else if (node && node.kind === 'type') {
      updateNode(node.id, { prompt: `“${text}” alanı`, anchor, locator: undefined })
    } else if (node && node.kind === 'click') {
      updateNode(node.id, { prompt: `“${text}” yazan yere tıkla`, anchor, locator: undefined })
    } else {
      appendClick({ prompt: `“${text}” yazan yere tıkla`, title: `Tıkla: ${text}`, anchor })
      recordTailRef.current = null
    }
    pushLog('success', `Ekrandan seçildi: “${text}”${node ? ` → ${node.title}` : ' (yeni Tıkla node’u)'}`)
    setScanner(null)
  }

  const run = async (startId?: string) => {
    if (graph.nodes.length === 0) return
    if (recording) await toggleRecord()
    setRunning(true)
    setStepStatus({})
    pushLog('info', startId ? 'Seçili node’dan çalıştırılıyor…' : 'Ajan çalışıyor…')
    try {
      if (api) await api.runAgent(graph, startId)
      else
        await runDemo(graph, settings, pushLog, (id, s) => setStepStatus((prev) => ({ ...prev, [id]: s })), startId)
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
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'xp-agent-akis.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importGraph = async (file: File) => {
    try {
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
    setGraph(initialGraph())
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setStepStatus({})
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
          recording={recording}
          running={running}
          hasStart={hasStart}
          hasSelection={!!selectedNodeId}
          capturing={capturing}
          onAdd={addNode}
          onToggleRecord={toggleRecord}
          onCapture={captureAsNewNode}
          onOpenScanner={() => openScanner(null)}
          onRun={() => run()}
          onRunFromSelected={() => selectedNodeId && run(selectedNodeId)}
          onStop={stop}
          onLayout={() => setGraph((g) => autoLayout(g))}
          onClear={newFlow}
        />
        <div className="workspace">
          <div className="canvas-wrap">
            <NodeCanvas
              graph={graph}
              selectedNodeId={selectedNodeId}
              selectedEdgeId={selectedEdgeId}
              stepStatus={stepStatus}
              running={running}
              onSelectNode={selectNode}
              onSelectEdge={selectEdge}
              onMoveNode={(id, x, y) => updateNode(id, { x, y })}
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
            graph={graph}
            selected={selected}
            selectedEdge={selectedEdge}
            onUpdateNode={(patch) => selected && updateNode(selected.id, patch)}
            onDeleteNode={() => selected && deleteNode(selected.id)}
            onDeleteEdge={() => selectedEdge && deleteEdge(selectedEdge.id)}
            onCaptureForNode={captureForSelected}
            onOpenScanner={() => openScanner(selectedNodeId)}
            capturing={capturing}
          />
          <LogPanel logs={logs} onClear={() => setLogs([])} />
        </div>
      </div>
      <Taskbar recording={recording} running={running} />
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
