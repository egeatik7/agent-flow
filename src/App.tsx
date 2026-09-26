import { useCallback, useEffect, useMemo, useState } from 'react'
import { v4 as uuid } from 'uuid'
import TitleBar from './components/TitleBar'
import Toolbar from './components/Toolbar'
import NodeCanvas from './components/NodeCanvas'
import SidePanel from './components/SidePanel'
import LogPanel from './components/LogPanel'
import Taskbar from './components/Taskbar'
import type {
  AgentGraph,
  AgentNode,
  AppSettings,
  A11yNode,
  LogEntry,
  StepStatus,
} from './types'

const defaultSettings: AppSettings = {
  apiKey: '',
  model: 'openai/gpt-4o-mini',
  targetWindow: '',
  maxTreeDepth: 8,
  stepDelayMs: 800,
}

function hasApi(): boolean {
  return typeof window !== 'undefined' && !!window.xpAgent
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [graph, setGraph] = useState<AgentGraph>({ nodes: [], edges: [] })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [tree, setTree] = useState<A11yNode | null>(null)
  const [windows, setWindows] = useState<{ title: string; handle: string }[]>([])
  const [stepStatus, setStepStatus] = useState<Record<string, StepStatus>>({})
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [sideTab, setSideTab] = useState<'settings' | 'node' | 'tree'>('settings')

  const pushLog = useCallback((level: LogEntry['level'], message: string) => {
    setLogs((prev) => [
      ...prev.slice(-200),
      { id: uuid(), level, message, at: Date.now() },
    ])
  }, [])

  useEffect(() => {
    if (!hasApi()) {
      pushLog('info', 'Tarayıcı önizleme modu — Electron’da tam özellikli çalışır.')
      return
    }
    void (async () => {
      const s = await window.xpAgent.getSettings()
      setSettings(s)
      const g = await window.xpAgent.getGraph()
      setGraph(g)
      const w = await window.xpAgent.listWindows()
      setWindows(w)
      pushLog('info', 'XP Agent Studio hazır. OpenRouter ayarlarını kaydet, node diz.')
    })()

    const offLog = window.xpAgent.onAgentLog((payload) => {
      const p = payload as { level: LogEntry['level']; message: string }
      pushLog(p.level, p.message)
    })
    const offStep = window.xpAgent.onAgentStep((payload) => {
      const p = payload as { id: string; status: StepStatus }
      setStepStatus((prev) => ({ ...prev, [p.id]: p.status }))
    })
    const offRec = window.xpAgent.onRecordEvent((payload) => {
      const p = payload as {
        element: A11yNode
        suggestedPrompt: string
      }
      const node: AgentNode = {
        id: uuid(),
        title: `Aşama ${Date.now().toString().slice(-4)}`,
        prompt: p.suggestedPrompt,
        x: 40 + Math.random() * 120,
        y: 40 + Math.random() * 180,
        recorded: {
          name: p.element.name,
          controlType: p.element.controlType,
          automationId: p.element.automationId,
          path: p.element.path,
        },
      }
      setGraph((g) => {
        const last = g.nodes[g.nodes.length - 1]
        const nodes = [...g.nodes, node]
        const edges = last
          ? [...g.edges, { id: uuid(), from: last.id, to: node.id }]
          : g.edges
        return { nodes, edges }
      })
      setSelectedId(node.id)
      setSideTab('node')
      pushLog('success', `Kaydedildi: ${p.suggestedPrompt}`)
    })

    return () => {
      offLog()
      offStep()
      offRec()
    }
  }, [pushLog])

  const selected = useMemo(
    () => graph.nodes.find((n) => n.id === selectedId) || null,
    [graph.nodes, selectedId]
  )

  const persistGraph = useCallback(
    async (next: AgentGraph) => {
      setGraph(next)
      if (hasApi()) await window.xpAgent.saveGraph(next)
    },
    []
  )

  const addNode = () => {
    const n: AgentNode = {
      id: uuid(),
      title: `Aşama ${graph.nodes.length + 1}`,
      prompt: '',
      x: 48 + (graph.nodes.length % 4) * 40,
      y: 48 + (graph.nodes.length % 5) * 36,
    }
    const next = { ...graph, nodes: [...graph.nodes, n] }
    void persistGraph(next)
    setSelectedId(n.id)
    setSideTab('node')
  }

  const updateNode = (id: string, patch: Partial<AgentNode>) => {
    const next = {
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    }
    void persistGraph(next)
  }

  const deleteSelected = () => {
    if (!selectedId) return
    const next = {
      nodes: graph.nodes.filter((n) => n.id !== selectedId),
      edges: graph.edges.filter((e) => e.from !== selectedId && e.to !== selectedId),
    }
    void persistGraph(next)
    setSelectedId(null)
  }

  const saveSettingsField = async (partial: Partial<AppSettings>) => {
    if (!hasApi()) {
      setSettings((s) => ({ ...s, ...partial }))
      pushLog('success', 'Ayarlar kaydedildi (önizleme).')
      return
    }
    const next = await window.xpAgent.saveSettings(partial)
    setSettings(next)
    pushLog('success', 'Ayarlar diske kaydedildi.')
  }

  const saveGraphNow = async () => {
    if (hasApi()) await window.xpAgent.saveGraph(graph)
    pushLog('success', 'Node grafiği kaydedildi.')
  }

  const toggleRecord = async () => {
    if (!hasApi()) {
      setRecording((r) => !r)
      pushLog('info', 'Önizleme: kayıt simülasyonu.')
      return
    }
    if (!recording) {
      await window.xpAgent.startRecord()
      setRecording(true)
    } else {
      await window.xpAgent.stopRecord()
      setRecording(false)
      pushLog('info', 'Kayıt durduruldu.')
    }
  }

  const captureNow = async () => {
    if (!hasApi()) {
      const demo: AgentNode = {
        id: uuid(),
        title: `Aşama ${graph.nodes.length + 1}`,
        prompt: 'TabItem öğesine "Hunyuan Tencent" bas',
        x: 60 + graph.nodes.length * 24,
        y: 60 + graph.nodes.length * 20,
        recorded: {
          name: 'Hunyuan Tencent',
          controlType: 'TabItem',
          path: '0/0',
        },
      }
      const last = graph.nodes[graph.nodes.length - 1]
      const next = {
        nodes: [...graph.nodes, demo],
        edges: last
          ? [...graph.edges, { id: uuid(), from: last.id, to: demo.id }]
          : graph.edges,
      }
      void persistGraph(next)
      setSelectedId(demo.id)
      setSideTab('node')
      return
    }
    const ev = await window.xpAgent.captureNow()
    if (!ev) {
      pushLog('error', 'İmleç altında öğe bulunamadı.')
      return
    }
    const node: AgentNode = {
      id: uuid(),
      title: `Aşama ${graph.nodes.length + 1}`,
      prompt: ev.suggestedPrompt,
      x: 40 + graph.nodes.length * 28,
      y: 40 + graph.nodes.length * 24,
      recorded: {
        name: ev.element.name,
        controlType: ev.element.controlType,
        automationId: ev.element.automationId,
        path: ev.element.path,
      },
    }
    const last = graph.nodes[graph.nodes.length - 1]
    const next = {
      nodes: [...graph.nodes, node],
      edges: last
        ? [...graph.edges, { id: uuid(), from: last.id, to: node.id }]
        : graph.edges,
    }
    void persistGraph(next)
    setSelectedId(node.id)
    setSideTab('node')
    pushLog('success', `Yakalandı: ${ev.suggestedPrompt}`)
  }

  const refreshTree = async () => {
    if (!hasApi()) {
      setTree({
        id: 'root',
        name: settings.targetWindow || 'Demo',
        controlType: 'Window',
        path: '0',
        children: [
          { id: 'a', name: 'Hunyuan Tencent', controlType: 'TabItem', path: '0/0' },
          { id: 'b', name: 'Model Seç', controlType: 'Button', path: '0/1' },
          { id: 'c', name: 'Modeli İndir', controlType: 'Button', path: '0/2' },
        ],
      })
      setSideTab('tree')
      return
    }
    try {
      const t = await window.xpAgent.getA11yTree({
        windowTitle: settings.targetWindow,
      })
      setTree(t)
      setSideTab('tree')
      pushLog('info', 'Accessibility tree yenilendi.')
    } catch (e) {
      pushLog('error', String(e))
    }
  }

  const runAgent = async () => {
    if (graph.nodes.length === 0) {
      pushLog('error', 'Çalıştırılacak node yok.')
      return
    }
    setRunning(true)
    setStepStatus({})
    try {
      if (!hasApi()) {
        for (const n of graph.nodes) {
          setStepStatus((s) => ({ ...s, [n.id]: 'running' }))
          pushLog('info', `Demo aşama: ${n.title} — ${n.prompt}`)
          await new Promise((r) => setTimeout(r, 500))
          setStepStatus((s) => ({ ...s, [n.id]: 'done' }))
        }
        pushLog('success', 'Demo koşu bitti.')
      } else {
        await window.xpAgent.runAgent(graph)
      }
    } catch (e) {
      pushLog('error', String(e))
    } finally {
      setRunning(false)
    }
  }

  const onPortClick = (nodeId: string, dir: 'in' | 'out') => {
    if (dir === 'out') {
      setConnectFrom(nodeId)
      pushLog('info', 'Bağlantı: hedef node’un giriş portuna tıkla.')
      return
    }
    if (!connectFrom || connectFrom === nodeId) return
    const exists = graph.edges.some(
      (e) => e.from === connectFrom && e.to === nodeId
    )
    if (exists) {
      setConnectFrom(null)
      return
    }
    const next = {
      ...graph,
      edges: [...graph.edges, { id: uuid(), from: connectFrom, to: nodeId }],
    }
    void persistGraph(next)
    setConnectFrom(null)
  }

  return (
    <div className="desktop">
      <div className="xp-window">
        <TitleBar />
        <div className="menubar">
          <button type="button" onClick={() => setSideTab('settings')}>
            Ayarlar
          </button>
          <button type="button" onClick={addNode}>
            Node
          </button>
          <button type="button" onClick={refreshTree}>
            Ağaç
          </button>
          <button type="button" onClick={saveGraphNow}>
            Kaydet
          </button>
        </div>
        <Toolbar
          recording={recording}
          running={running}
          onAddNode={addNode}
          onToggleRecord={toggleRecord}
          onCapture={captureNow}
          onRun={runAgent}
          onRefreshTree={refreshTree}
          onSaveGraph={saveGraphNow}
          onDelete={deleteSelected}
          canDelete={!!selectedId}
        />
        <div className="workspace">
          <div className="canvas-wrap">
            <NodeCanvas
              graph={graph}
              selectedId={selectedId}
              stepStatus={stepStatus}
              connectFrom={connectFrom}
              onSelect={setSelectedId}
              onMove={(id, x, y) => updateNode(id, { x, y })}
              onPortClick={onPortClick}
              onOpenNode={() => setSideTab('node')}
            />
          </div>
          <SidePanel
            tab={sideTab}
            onTab={setSideTab}
            settings={settings}
            setSettings={setSettings}
            onSaveSettings={saveSettingsField}
            windows={windows}
            onRefreshWindows={async () => {
              if (hasApi()) setWindows(await window.xpAgent.listWindows())
            }}
            selected={selected}
            onUpdateNode={(patch) => selected && updateNode(selected.id, patch)}
            onClearRecorded={() =>
              selected && updateNode(selected.id, { recorded: undefined })
            }
            tree={tree}
            onPickTreeNode={(n) => {
              if (!selected) {
                pushLog('info', 'Önce bir node seç.')
                return
              }
              updateNode(selected.id, {
                prompt: `${n.controlType} öğesine "${n.name}" bas`,
                recorded: {
                  name: n.name,
                  controlType: n.controlType,
                  automationId: n.automationId,
                  path: n.path,
                },
              })
              setSideTab('node')
              pushLog('success', `Node’a bağlandı: ${n.name}`)
            }}
            onTestApi={async () => {
              try {
                if (!hasApi()) {
                  pushLog('info', 'Önizleme: API testi atlandı.')
                  return
                }
                await window.xpAgent.testOpenRouter()
                pushLog('success', 'OpenRouter bağlantısı OK.')
              } catch (e) {
                pushLog('error', String(e))
              }
            }}
          />
          <LogPanel logs={logs} onClear={() => setLogs([])} />
        </div>
      </div>
      <Taskbar />
    </div>
  )
}
