import { useEffect, useMemo, useRef, useState } from 'react'
import {
  NODE_KINDS,
  NODE_SPECS,
  NODE_W,
  inputPoint,
  listItems,
  nodeHeight,
  outputPoint,
  portLabel,
  summarize,
  type AgentGraph,
  type AgentNode,
  type NodeKind,
  type StepStatus,
} from '../types'
import { loopBody } from '../lib/graph-ops'

type Frame = { loop: AgentNode; ids: string[]; x: number; y: number; w: number; h: number; label: string }

const FRAME_PAD = 22
const FRAME_HEAD = 24
const FRAME_BOTTOM = 128

function computeFrames(graph: AgentGraph): Frame[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const frames: Frame[] = []
  for (const loop of graph.nodes) {
    if (loop.kind !== 'loop') continue
    const ids = loopBody(graph, loop.id)
    if (!ids.length) continue
    const nodes = ids.map((id) => byId.get(id)!).filter(Boolean)
    const x1 = Math.min(...nodes.map((n) => n.x)) - FRAME_PAD
    const y1 = Math.min(...nodes.map((n) => n.y)) - FRAME_PAD - FRAME_HEAD
    const x2 = Math.max(...nodes.map((n) => n.x + NODE_W)) + FRAME_PAD
    const y2 = Math.max(...nodes.map((n) => n.y + nodeHeight(n.kind))) + FRAME_BOTTOM
    const items = listItems(loop)
    const idx = items.length ? Math.min(Math.max(0, loop.loopIndex ?? 0), items.length - 1) : 0
    const label = items.length
      ? `${loop.title} · ${items.length} öğe · sıradaki ${idx + 1}/${items.length}`
      : `${loop.title} · ${loop.count ?? 1} kez`
    frames.push({ loop, ids, x: x1, y: y1, w: x2 - x1, h: y2 - y1, label })
  }
  return frames.sort((a, b) => b.w * b.h - a.w * a.h)
}

type Props = {
  graph: AgentGraph
  selectedNodeId: string | null
  selectedEdgeId: string | null
  stepStatus: Record<string, StepStatus>
  running: boolean
  onSelectNode: (id: string | null) => void
  onSelectEdge: (id: string | null) => void
  onMoveNode: (id: string, x: number, y: number) => void
  onMoveNodes: (positions: Record<string, { x: number; y: number }>) => void
  onConnect: (from: string, port: string, to: string) => void
  onAddAfter: (fromId: string, port: string, kind: NodeKind) => void
  onAddAt: (kind: NodeKind, x: number, y: number) => void
  onDeleteNode: (id: string) => void
  onDeleteEdge: (id: string) => void
  onDuplicate: (id: string) => void
  onRunFrom: (id: string) => void
}

type Linking = { from: string; port: string; mx: number; my: number; sx: number; sy: number; moved: boolean }

type Menu =
  | { mode: 'canvas'; x: number; y: number }
  | { mode: 'after'; x: number; y: number; fromId: string; port: string }
  | { mode: 'node'; x: number; y: number; nodeId: string }

const PORT_COLORS: Record<string, string> = {
  next: '#0a246a',
  loop: '#d27a00',
  done: '#0a246a',
  true: '#2f8a2f',
  found: '#2f8a2f',
  false: '#b03a3a',
  timeout: '#b03a3a',
}

const portColor = (p: string) => PORT_COLORS[p] ?? '#0a246a'

function edgePath(x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1
  if (dx > 40) {
    const c = Math.max(40, dx / 2)
    return { d: `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 }
  }
  const off = 70
  const below = Math.max(y1, y2) + 110
  const mid = (x1 + x2) / 2
  return {
    d: `M${x1},${y1} C${x1 + off},${y1} ${x1 + off},${below} ${mid},${below} S${x2 - off},${y2} ${x2},${y2}`,
    mx: mid,
    my: below,
  }
}

function headerGradient(color: string) {
  return `linear-gradient(180deg, ${color}cc 0%, ${color} 55%, ${color}ee 100%)`
}

type View = { x: number; y: number; z: number }

const MIN_Z = 0.25
const MAX_Z = 2.5

export default function NodeCanvas(p: Props) {
  const innerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [linking, setLinking] = useState<Linking | null>(null)
  const linkRef = useRef<Linking | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [hoverTarget, setHoverTarget] = useState<string | null>(null)
  const [view, setView] = useState<View>({ x: 24, y: 24, z: 1 })
  const viewRef = useRef(view)
  viewRef.current = view
  const [panning, setPanning] = useState(false)
  const graphRef = useRef(p.graph)
  graphRef.current = p.graph

  const byId = useMemo(() => new Map(p.graph.nodes.map((n) => [n.id, n])), [p.graph.nodes])
  const hasStart = p.graph.nodes.some((n) => n.kind === 'start')
  const addableKinds = NODE_KINDS.filter((k) => k !== 'start' || !hasStart)

  const size = useMemo(() => {
    let w = 2400
    let h = 1600
    for (const n of p.graph.nodes) {
      w = Math.max(w, n.x + NODE_W + 600)
      h = Math.max(h, n.y + nodeHeight(n.kind) + 500)
    }
    return { w, h }
  }, [p.graph.nodes])

  const toCanvas = (clientX: number, clientY: number) => {
    const r = scrollRef.current!.getBoundingClientRect()
    const v = viewRef.current
    return { x: (clientX - r.left - v.x) / v.z, y: (clientY - r.top - v.y) / v.z }
  }

  const setViewNow = (next: View) => {
    viewRef.current = next
    setView(next)
  }

  const autoScroll = (clientX: number, clientY: number) => {
    const s = scrollRef.current
    if (!s) return
    const r = s.getBoundingClientRect()
    const edge = 36
    const dx = clientX < r.left + edge ? 16 : clientX > r.right - edge ? -16 : 0
    const dy = clientY < r.top + edge ? 16 : clientY > r.bottom - edge ? -16 : 0
    if (!dx && !dy) return
    const v = viewRef.current
    setViewNow({ ...v, x: v.x + dx, y: v.y + dy })
  }

  const reveal = (id: string) => {
    const n = graphRef.current.nodes.find((x) => x.id === id)
    const el = scrollRef.current
    if (!n || !el) return
    const v = viewRef.current
    const left = v.x + n.x * v.z
    const top = v.y + n.y * v.z
    const right = left + NODE_W * v.z
    const bottom = top + nodeHeight(n.kind) * v.z
    const m = 56
    const vw = el.clientWidth
    const vh = el.clientHeight
    let x = v.x
    let y = v.y
    if (left < m) x += m - left
    else if (right > vw - m) x -= right - (vw - m)
    if (top < m) y += m - top
    else if (bottom > vh - m) y -= bottom - (vh - m)
    if (Math.abs(x - v.x) < 1 && Math.abs(y - v.y) < 1) return
    setViewNow({ ...v, x, y })
  }

  const setLink = (l: Linking | null) => {
    linkRef.current = l
    setLinking(l)
  }

  const nodeIdAt = (clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
    return el?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId ?? null
  }

  useEffect(() => {
    if (!linking) return
    const move = (e: MouseEvent) => {
      const l = linkRef.current
      if (!l) return
      autoScroll(e.clientX, e.clientY)
      const c = toCanvas(e.clientX, e.clientY)
      const moved = l.moved || Math.hypot(e.clientX - l.sx, e.clientY - l.sy) > 5
      setLink({ ...l, mx: c.x, my: c.y, moved })
      const t = nodeIdAt(e.clientX, e.clientY)
      setHoverTarget(t && t !== l.from ? t : null)
    }
    const up = (e: MouseEvent) => {
      const l = linkRef.current
      if (!l || !l.moved) return
      const target = nodeIdAt(e.clientX, e.clientY)
      if (target && target !== l.from) p.onConnect(l.from, l.port, target)
      setLink(null)
      setHoverTarget(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!linking])

  useEffect(() => {
    if (p.selectedNodeId) reveal(p.selectedNodeId)
    // reveal reads refs; only jump when the selection changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.selectedNodeId])

  const runningId = Object.keys(p.stepStatus).find((id) => p.stepStatus[id] === 'running')
  useEffect(() => {
    if (runningId) reveal(runningId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningId])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = viewRef.current
      const z = Math.min(MAX_Z, Math.max(MIN_Z, v.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
      const rect = el.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const cx = (px - v.x) / v.z
      const cy = (py - v.y) / v.z
      setViewNow({ x: px - cx * z, y: py - cy * z, z })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLink(null)
        setMenu(null)
        setHoverTarget(null)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const startNodeDrag = (e: React.MouseEvent, n: AgentNode) => {
    if (e.button !== 0) return
    const l = linkRef.current
    if (l) {
      if (n.id !== l.from) p.onConnect(l.from, l.port, n.id)
      setLink(null)
      setHoverTarget(null)
      e.stopPropagation()
      return
    }
    e.stopPropagation()
    setMenu(null)
    p.onSelectNode(n.id)
    const start = toCanvas(e.clientX, e.clientY)
    const offX = start.x - n.x
    const offY = start.y - n.y
    const move = (ev: MouseEvent) => {
      autoScroll(ev.clientX, ev.clientY)
      const c = toCanvas(ev.clientX, ev.clientY)
      const x = Math.round((c.x - offX) / 8) * 8
      const y = Math.round((c.y - offY) / 8) * 8
      p.onMoveNode(n.id, Math.max(0, x), Math.max(0, y))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const frames = useMemo(() => computeFrames(p.graph), [p.graph])

  const startFrameDrag = (e: React.MouseEvent, f: Frame) => {
    if (e.button !== 0) return
    e.stopPropagation()
    setMenu(null)
    p.onSelectNode(f.loop.id)
    const start = toCanvas(e.clientX, e.clientY)
    const orig = Object.fromEntries(
      f.ids.map((id) => {
        const n = byId.get(id)!
        return [id, { x: n.x, y: n.y }]
      })
    )
    const move = (ev: MouseEvent) => {
      autoScroll(ev.clientX, ev.clientY)
      const c = toCanvas(ev.clientX, ev.clientY)
      const dx = Math.round((c.x - start.x) / 8) * 8
      const dy = Math.round((c.y - start.y) / 8) * 8
      const next: Record<string, { x: number; y: number }> = {}
      for (const [id, o] of Object.entries(orig)) next[id] = { x: Math.max(0, o.x + dx), y: Math.max(0, o.y + dy) }
      p.onMoveNodes(next)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const startLink = (e: React.MouseEvent, n: AgentNode, port: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    setMenu(null)
    const c = toCanvas(e.clientX, e.clientY)
    setLink({ from: n.id, port, mx: c.x, my: c.y, sx: e.clientX, sy: e.clientY, moved: false })
  }

  const openAfterMenu = (e: React.MouseEvent, n: AgentNode, port: string) => {
    e.stopPropagation()
    const c = toCanvas(e.clientX, e.clientY)
    setMenu({ mode: 'after', x: c.x + 8, y: c.y - 10, fromId: n.id, port })
  }

  const edgeSource = (node: AgentNode, port: string) => {
    if (node.kind === 'loop' && port === 'done') {
      const f = frames.find((fr) => fr.loop.id === node.id)
      if (f) return { x: f.x + f.w - 7, y: f.y + f.h / 2 }
      return { x: node.x + NODE_W - 7, y: node.y + nodeHeight(node.kind) / 2 }
    }
    return outputPoint(node, port)
  }

  const linkFrom = linking ? byId.get(linking.from) : undefined
  const linkStart = linkFrom && linking ? edgeSource(linkFrom, linking.port) : null

  const resetZoom = () => {
    const el = scrollRef.current
    if (!el) return
    const v = viewRef.current
    const cx = el.clientWidth / 2
    const cy = el.clientHeight / 2
    const canvasX = (cx - v.x) / v.z
    const canvasY = (cy - v.y) / v.z
    setViewNow({ x: cx - canvasX, y: cy - canvasY, z: 1 })
  }

  return (
      <div
        ref={scrollRef}
        className={`canvas-scroll${panning ? ' panning' : ''}`}
        style={{
          backgroundSize: `${24 * view.z}px ${24 * view.z}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault()
          setPanning(true)
          const startX = e.clientX
          const startY = e.clientY
          const orig = viewRef.current
          const move = (ev: MouseEvent) => {
            setViewNow({ ...orig, x: orig.x + ev.clientX - startX, y: orig.y + ev.clientY - startY })
          }
          const up = () => {
            setPanning(false)
            window.removeEventListener('mousemove', move)
            window.removeEventListener('mouseup', up)
          }
          window.addEventListener('mousemove', move)
          window.addEventListener('mouseup', up)
          return
        }
        if (e.button !== 0) return
        if (linkRef.current) {
          setLink(null)
          setHoverTarget(null)
        }
        setMenu(null)
        p.onSelectNode(null)
        p.onSelectEdge(null)
      }}
      onAuxClick={(e) => {
        if (e.button === 1) e.preventDefault()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        if (!innerRef.current) return
        const c = toCanvas(e.clientX, e.clientY)
        setMenu({ mode: 'canvas', x: c.x, y: c.y })
      }}
    >
      <div
        ref={innerRef}
        className={`canvas-inner${linking ? ' linking' : ''}`}
        style={{
          width: size.w,
          height: size.h,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
        }}
      >
        {p.graph.nodes.length <= 1 && (
          <div className="empty-canvas">
            <b>Başlangıç</b> node’unun sağındaki <b>+</b> ile ileriye node ekle,
            <br />
            sarı çıkış noktasından sürükleyip başka bir node’un üstüne bırakarak bağla.
            <br />
            Boş yere sağ tıklayarak istediğin türde node ekleyebilirsin. Tekerlek yakınlaştırır, orta tuş kaydırır.
          </div>
        )}

        {frames.map((f) => (
          <div
            key={f.loop.id}
            className={`loop-frame${p.selectedNodeId && f.ids.includes(p.selectedNodeId) ? ' active' : ''}${
              p.stepStatus[f.loop.id] === 'running' || f.ids.some((id) => p.stepStatus[id] === 'running') ? ' running' : ''
            }`}
            style={{ left: f.x, top: f.y, width: f.w, height: f.h }}
          >
            <div className="loop-frame-head" onMouseDown={(e) => startFrameDrag(e, f)} title="Sürükle: gruptaki tüm node’ları taşı">
              ↻ {f.label}
            </div>
          </div>
        ))}

        <svg className="edge-layer" width={size.w} height={size.h}>
          <defs>
            {Object.entries(PORT_COLORS).map(([k, c]) => (
              <marker key={k} id={`arrow-${k}`} markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill={c} />
              </marker>
            ))}
            <marker id="arrow-sel" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="#e05a00" />
            </marker>
          </defs>
          {p.graph.edges.map((e) => {
            const a = byId.get(e.from)
            const b = byId.get(e.to)
            if (!a || !b) return null
            const s = edgeSource(a, e.fromPort)
            const t = inputPoint(b)
            const { d, mx, my } = edgePath(s.x + 7, s.y, t.x - 7, t.y)
            const sel = p.selectedEdgeId === e.id
            const color = sel ? '#e05a00' : portColor(e.fromPort)
            const label = e.fromPort !== 'next' ? portLabel(a.kind, e.fromPort) : null
            return (
              <g key={e.id} className="edge">
                <path
                  d={d}
                  className="edge-hit"
                  onMouseDown={(ev) => {
                    ev.stopPropagation()
                    setMenu(null)
                    p.onSelectEdge(e.id)
                  }}
                  onDoubleClick={() => p.onDeleteEdge(e.id)}
                />
                <path
                  d={d}
                  stroke={color}
                  strokeWidth={sel ? 3 : 2}
                  fill="none"
                  markerEnd={`url(#${sel ? 'arrow-sel' : `arrow-${PORT_COLORS[e.fromPort] ? e.fromPort : 'next'}`})`}
                  className={p.running ? 'edge-line flowing' : 'edge-line'}
                />
                {label && (
                  <text x={mx} y={my - 6} className="edge-label" fill={color}>
                    {label}
                  </text>
                )}
              </g>
            )
          })}
          {linking && linkStart && (
            <path
              d={edgePath(linkStart.x + 7, linkStart.y, linking.mx, linking.my).d}
              stroke={portColor(linking.port)}
              strokeWidth={2}
              strokeDasharray="6 4"
              fill="none"
            />
          )}
        </svg>

        {p.graph.nodes.map((n) => {
          const spec = NODE_SPECS[n.kind]
          const st = p.stepStatus[n.id] ?? 'idle'
          const cls = [
            'agent-node',
            `kind-${n.kind}`,
            p.selectedNodeId === n.id ? 'selected' : '',
            hoverTarget === n.id ? 'drop-target' : '',
            st !== 'idle' ? st : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div
              key={n.id}
              data-node-id={n.id}
              className={cls}
              style={{ left: n.x, top: n.y, width: NODE_W, height: nodeHeight(n.kind) }}
              onMouseDown={(e) => startNodeDrag(e, n)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                p.onSelectNode(n.id)
                const c = toCanvas(e.clientX, e.clientY)
                setMenu({ mode: 'node', x: c.x, y: c.y, nodeId: n.id })
              }}
            >
              <div className="node-head" style={{ background: headerGradient(spec.color) }}>
                <span className="node-icon">{spec.icon}</span>
                <span className="node-title">{n.title}</span>
                {n.useVision && (
                  <span className="vision-badge" title="Ekran görüntüsüne bakarak çalışır">
                    görsel
                  </span>
                )}
                {st !== 'idle' && <span className={`status-chip ${st}`}>{st === 'running' ? 'çalışıyor' : st === 'done' ? 'tamam' : 'hata'}</span>}
              </div>
              <div className="node-body">
                <div className="node-summary">{summarize(n)}</div>
                {n.locator && (
                  <div className="node-meta" title={`${n.locator.windowTitle ?? ''} › ${n.locator.path}`}>
                    ● {n.locator.controlType}: {n.locator.name || n.locator.path}
                  </div>
                )}
              </div>
              <div className="node-outputs">
                {spec.outputs.map((o) => (
                  <div className="port-row" key={o.key}>
                    <span className="port-label" style={{ color: portColor(o.key) }}>
                      {o.label}
                    </span>
                    <button
                      type="button"
                      className="add-next"
                      title="Buradan ileriye yeni node ekle"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => openAfterMenu(e, n, o.key)}
                    >
                      +
                    </button>
                    <div
                      className="node-port out"
                      style={{ background: o.key === 'next' ? '#ffd24a' : portColor(o.key) }}
                      title="Sürükle ve bir node’un üstüne bırak (veya tıkla, sonra hedef node’a tıkla)"
                      onMouseDown={(e) => startLink(e, n, o.key)}
                    />
                  </div>
                ))}
              </div>
              {spec.hasInput && <div className="node-port in" title="Giriş" />}
            </div>
          )
        })}

        {frames.map((f) => (
          <div
            key={`${f.loop.id}-exit`}
            className="loop-frame-exit"
            style={{ left: f.x + f.w, top: f.y + f.h / 2 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              className="node-port out frame-port"
              style={{ background: portColor('done') }}
              title="Turlar bitince akış buradan devam eder. Sürükle ve dışarıdaki bir node’a bırak."
              onMouseDown={(e) => startLink(e, f.loop, 'done')}
            />
            <span className="port-label" style={{ color: portColor('done') }}>
              bitti
            </span>
            <button
              type="button"
              className="add-next"
              title="Bitti çıkışından ileriye yeni node ekle"
              onClick={(e) => openAfterMenu(e, f.loop, 'done')}
            >
              +
            </button>
          </div>
        ))}

        {menu && (
          <div
            className="ctx-menu"
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {menu.mode === 'node' ? (
              <>
                <div className="ctx-title">{byId.get(menu.nodeId)?.title}</div>
                <button type="button" onClick={() => { p.onRunFrom(menu.nodeId); setMenu(null) }}>
                  ▶ Buradan çalıştır
                </button>
                {byId.get(menu.nodeId)?.kind !== 'start' && (
                  <button type="button" onClick={() => { p.onDuplicate(menu.nodeId); setMenu(null) }}>
                    Kopyala
                  </button>
                )}
                <button type="button" onClick={() => {
                  const n = byId.get(menu.nodeId)
                  const port = n ? NODE_SPECS[n.kind].outputs[0]?.key : undefined
                  if (n && port) {
                    const c = outputPoint(n, port)
                    setLink({ from: n.id, port, mx: c.x + 40, my: c.y, sx: -999, sy: -999, moved: false })
                  }
                  setMenu(null)
                }}>
                  Bağla… (hedefe tıkla)
                </button>
                <button type="button" className="danger" onClick={() => { p.onDeleteNode(menu.nodeId); setMenu(null) }}>
                  Sil
                </button>
              </>
            ) : (
              <>
                <div className="ctx-title">{menu.mode === 'after' ? 'İleriye ekle' : 'Node ekle'}</div>
                {(menu.mode === 'after' ? addableKinds.filter((k) => k !== 'start') : addableKinds).map((k) => (
                  <button
                    type="button"
                    key={k}
                    onClick={() => {
                      if (menu.mode === 'after') p.onAddAfter(menu.fromId, menu.port, k)
                      else p.onAddAt(k, menu.x, menu.y)
                      setMenu(null)
                    }}
                  >
                    <span className="ctx-icon" style={{ background: NODE_SPECS[k].color }}>
                      {NODE_SPECS[k].icon}
                    </span>
                    <span>
                      <b>{NODE_SPECS[k].label}</b>
                      <small>{NODE_SPECS[k].description}</small>
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
      <button type="button" className="canvas-zoom" title="Tekerlek: yakınlaştır · Orta tuş: kaydır · Tıkla: 100%" onMouseDown={(e) => e.stopPropagation()} onClick={resetZoom}>
        {Math.round(view.z * 100)}%
      </button>
    </div>
  )
}
