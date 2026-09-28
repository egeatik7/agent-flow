import { useEffect, useMemo, useRef, useState } from 'react'
import {
  NODE_KINDS,
  NODE_SPECS,
  NODE_W,
  baseName,
  inputPoint,
  listItems,
  loopKeys,
  nodeHeight,
  outputPoint,
  portLabel,
  summarize,
  type AgentGraph,
  type AgentNode,
  type NodeKind,
  type StepStatus,
} from '../types'
import { allMembers, ancestors, frameInput, frameOutput, frameRect, ownerOf, type Rect } from '../../electron/groups'

type Frame = { loop: AgentNode; rect: Rect; depth: number; label: string; sub: string }

function computeFrames(graph: AgentGraph, override?: Map<string, Rect>): Frame[] {
  const frames: Frame[] = []
  for (const loop of graph.nodes) {
    if (loop.kind !== 'loop') continue
    const rect = override?.get(loop.id) ?? frameRect(graph, loop)
    const keys = loopKeys(loop)
    const isList = listItems(loop).length > 0
    const cur = loop.loopIndex
    const label = `${loop.title} · ${isList ? `${keys.length} öğe` : `${keys.length} kez`}`
    const sub =
      typeof cur === 'number' && keys[cur] ? `şu an: ${isList ? baseName(keys[cur]) : `${cur + 1}. tur`}` : ''
    frames.push({ loop, rect, depth: ancestors(graph, loop.id).length, label, sub })
  }
  return frames.sort((a, b) => a.depth - b.depth)
}

type Props = {
  graph: AgentGraph
  selectedNodeId: string | null
  selectedIds: string[]
  selectedEdgeId: string | null
  stepStatus: Record<string, StepStatus>
  running: boolean
  onSelectNode: (id: string | null, additive?: boolean) => void
  onSelectMany: (ids: string[], mode: 'replace' | 'add') => void
  onSelectEdge: (id: string | null) => void
  onMoveNodes: (positions: Record<string, { x: number; y: number }>) => void
  onSetMembership: (ids: string[], loopId: string | null) => void
  onWrap: (ids: string[]) => void
  onConnect: (from: string, port: string, to: string) => void
  onAddAfter: (fromId: string, port: string, kind: NodeKind) => void
  onAddAt: (kind: NodeKind, x: number, y: number) => void
  onDeleteNode: (id: string) => void
  onDeleteEdge: (id: string) => void
  onDuplicate: (id: string) => void
  onRunFrom: (id: string) => void
  onEnterPackage: (id: string) => void
}

type Linking = { from: string; port: string; mx: number; my: number; sx: number; sy: number; moved: boolean }

type Menu =
  | { mode: 'canvas'; x: number; y: number }
  | { mode: 'after'; x: number; y: number; fromId: string; port: string }
  | { mode: 'node'; x: number; y: number; nodeId: string }

type Drag = { ids: string[]; frozen: Map<string, Rect>; over: string | null; skip: Set<string> }

type Marquee = { x: number; y: number; w: number; h: number }

const PORT_COLORS: Record<string, string> = {
  next: '#0a246a',
  done: '#0a246a',
  error: '#b03a3a',
  true: '#2f8a2f',
  found: '#2f8a2f',
  false: '#b03a3a',
  timeout: '#b03a3a',
  fail: '#b03a3a',
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

function inside(r: Rect, x: number, y: number) {
  return x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h
}

function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

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
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const graphRef = useRef(p.graph)
  graphRef.current = p.graph

  const byId = useMemo(() => new Map(p.graph.nodes.map((n) => [n.id, n])), [p.graph.nodes])
  const hasStart = p.graph.nodes.some((n) => n.kind === 'start')
  const addableKinds = NODE_KINDS.filter((k) => k !== 'package' && (k !== 'start' || !hasStart))

  const frames = useMemo(() => computeFrames(p.graph, drag?.frozen), [p.graph, drag?.frozen])
  const frameById = useMemo(() => new Map(frames.map((f) => [f.loop.id, f])), [frames])

  const size = useMemo(() => {
    let w = 2400
    let h = 1600
    for (const n of p.graph.nodes) {
      w = Math.max(w, n.x + NODE_W + 600)
      h = Math.max(h, n.y + nodeHeight(n.kind) + 500)
    }
    for (const f of frames) {
      w = Math.max(w, f.rect.x + f.rect.w + 400)
      h = Math.max(h, f.rect.y + f.rect.h + 400)
    }
    return { w, h }
  }, [p.graph.nodes, frames])

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
    if (!n || !el || n.kind === 'loop') return
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.selectedNodeId])

  const runningId = Object.keys(p.stepStatus).find((id) => p.stepStatus[id] === 'running' && byId.get(id)?.kind !== 'loop')
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

  /**
   * Drags nodes (and boxes with everything inside them). Box frames are frozen while dragging,
   * so a node can be pulled out of its box; on release it joins the box under it.
   */
  const beginDrag = (e: React.MouseEvent, ids: string[], lead: string) => {
    const g = graphRef.current
    const moving = new Set<string>()
    for (const id of ids) {
      moving.add(id)
      for (const m of allMembers(g, id)) moving.add(m)
    }
    const without: AgentGraph = {
      ...g,
      nodes: g.nodes.map((n) => (n.kind === 'loop' && n.members ? { ...n, members: n.members.filter((m) => !ids.includes(m)) } : n)),
    }
    const frozen = new Map<string, Rect>()
    for (const n of g.nodes) if (n.kind === 'loop' && !moving.has(n.id)) frozen.set(n.id, frameRect(without, n))
    const skip = new Set(moving)
    const leadNode = byId.get(lead)
    const leadRect = leadNode?.kind === 'loop' ? frameRect(g, leadNode) : { x: leadNode?.x ?? 0, y: leadNode?.y ?? 0, w: NODE_W, h: 40 }
    const start = toCanvas(e.clientX, e.clientY)
    const orig = Object.fromEntries([...moving].map((id) => [id, { x: byId.get(id)?.x ?? 0, y: byId.get(id)?.y ?? 0 }]))
    const d0: Drag = { ids, frozen, over: ownerOf(g, lead)?.id ?? null, skip }
    dragRef.current = d0
    let moved = false

    const move = (ev: MouseEvent) => {
      autoScroll(ev.clientX, ev.clientY)
      const c = toCanvas(ev.clientX, ev.clientY)
      const dx = Math.round((c.x - start.x) / 8) * 8
      const dy = Math.round((c.y - start.y) / 8) * 8
      if (!moved && Math.abs(dx) + Math.abs(dy) < 8) return
      if (!moved) {
        moved = true
        setDrag(d0)
      }
      const next: Record<string, { x: number; y: number }> = {}
      for (const [id, o] of Object.entries(orig)) next[id] = { x: Math.max(0, o.x + dx), y: Math.max(0, o.y + dy) }
      p.onMoveNodes(next)
      const px = leadRect.x + dx + Math.min(leadRect.w, NODE_W) / 2
      const py = leadRect.y + dy + 16
      let over: string | null = null
      let area = Infinity
      for (const [id, r] of frozen) {
        if (skip.has(id) || !inside(r, px, py)) continue
        if (r.w * r.h < area) {
          area = r.w * r.h
          over = id
        }
      }
      if (over !== dragRef.current?.over) {
        dragRef.current = { ...d0, over }
        setDrag(dragRef.current)
      }
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!moved || !d) return
      const changed = ids.filter((id) => (ownerOf(graphRef.current, id)?.id ?? null) !== d.over)
      if (changed.length) p.onSetMembership(changed, d.over)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

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
    if (e.shiftKey) {
      e.stopPropagation()
      setMenu(null)
      p.onSelectNode(n.id, true)
      return
    }
    e.stopPropagation()
    setMenu(null)
    const group = p.selectedIds.includes(n.id) ? p.selectedIds : [n.id]
    if (!p.selectedIds.includes(n.id)) p.onSelectNode(n.id)
    beginDrag(e, group, n.id)
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
    if (node.kind === 'loop') {
      const f = frameById.get(node.id)
      if (f) {
        const idx = port === 'error' ? 1 : 0
        return { x: f.rect.x + f.rect.w, y: f.rect.y + 28 + 18 + idx * 28 }
      }
      return frameOutput(p.graph, node, port)
    }
    return outputPoint(node, port)
  }

  const edgeTarget = (node: AgentNode) => {
    if (node.kind === 'loop') {
      const f = frameById.get(node.id)
      return f ? { x: f.rect.x, y: f.rect.y + 14 } : frameInput(p.graph, node)
    }
    return inputPoint(node)
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

  const menuNode = menu?.mode === 'node' ? byId.get(menu.nodeId) : undefined
  const menuOwner = menuNode ? ownerOf(p.graph, menuNode.id) : undefined
  const multi = p.selectedIds.length > 1

  return (
    <div
      ref={scrollRef}
      className={`canvas-scroll${panning ? ' panning' : ''}${marquee ? ' selecting' : ''}`}
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
        const origin = toCanvas(e.clientX, e.clientY)
        const additive = e.shiftKey
        const sx = e.clientX
        const sy = e.clientY
        let box: Marquee | null = null
        const move = (ev: MouseEvent) => {
          if (!box && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return
          const cur = toCanvas(ev.clientX, ev.clientY)
          box = {
            x: Math.min(origin.x, cur.x),
            y: Math.min(origin.y, cur.y),
            w: Math.abs(cur.x - origin.x),
            h: Math.abs(cur.y - origin.y),
          }
          setMarquee(box)
        }
        const up = () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          const drawn = box
          setMarquee(null)
          if (!drawn || (drawn.w < 3 && drawn.h < 3)) {
            if (!additive) {
              p.onSelectNode(null)
              p.onSelectEdge(null)
            }
            return
          }
          const hits: string[] = []
          for (const n of graphRef.current.nodes) {
            if (n.kind === 'loop') {
              const f = frameById.get(n.id)
              if (f && overlaps({ x: f.rect.x, y: f.rect.y, w: f.rect.w, h: 28 }, drawn)) hits.push(n.id)
            } else if (overlaps({ x: n.x, y: n.y, w: NODE_W, h: nodeHeight(n.kind) }, drawn)) {
              hits.push(n.id)
            }
          }
          p.onSelectMany(hits, additive ? 'add' : 'replace')
          p.onSelectEdge(null)
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
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
        className={`canvas-inner${linking ? ' linking' : ''}${drag ? ' dragging' : ''}`}
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
            Tekrar edecek adımları <b>Her Öğe İçin</b> kutusuna sürükle (ya da seçip <b>Ctrl+G</b>).
            <br />
            Tekerlek yakınlaştırır, orta tuş kaydırır.
          </div>
        )}

        {frames.map((f) => {
          const st = p.stepStatus[f.loop.id]
          const empty = !(f.loop.members ?? []).length
          const cls = [
            'loop-frame',
            p.selectedIds.includes(f.loop.id) ? 'selected' : '',
            drag?.over === f.loop.id ? 'drop' : '',
            st === 'running' ? 'running' : '',
            st === 'error' ? 'failed' : '',
            hoverTarget === f.loop.id ? 'drop-target' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div key={f.loop.id} className={cls} style={{ left: f.rect.x, top: f.rect.y, width: f.rect.w, height: f.rect.h, zIndex: f.depth }}>
              <div
                className="loop-frame-head"
                data-node-id={f.loop.id}
                onMouseDown={(e) => {
                  if (e.button !== 0) return
                  const l = linkRef.current
                  if (l) {
                    if (f.loop.id !== l.from) p.onConnect(l.from, l.port, f.loop.id)
                    setLink(null)
                    setHoverTarget(null)
                    e.stopPropagation()
                    return
                  }
                  e.stopPropagation()
                  setMenu(null)
                  if (e.shiftKey) {
                    p.onSelectNode(f.loop.id, true)
                    return
                  }
                  p.onSelectNode(f.loop.id)
                  beginDrag(e, [f.loop.id], f.loop.id)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  p.onSelectNode(f.loop.id)
                  const c = toCanvas(e.clientX, e.clientY)
                  setMenu({ mode: 'node', x: c.x, y: c.y, nodeId: f.loop.id })
                }}
                title="Sürükle: kutuyu içindekilerle taşı · Sağ tık: menü"
              >
                <span className="frame-in node-port in" title="Giriş: akış kutuya buradan girer" />
                <span className="frame-title">↻ {f.label}</span>
                {f.sub && <span className="frame-sub">{f.sub}</span>}
                {st === 'running' && <span className="status-chip running">çalışıyor</span>}
              </div>
              {empty && <div className="frame-empty">Tekrar edecek node’ları buraya sürükle</div>}
              {NODE_SPECS.loop.outputs.map((o, idx) => (
                <div
                  key={o.key}
                  className={`frame-out ${o.key}`}
                  style={{ top: 28 + 18 + idx * 28 }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <span className="port-label" style={{ color: portColor(o.key) }}>
                    {o.label}
                  </span>
                  <button type="button" className="add-next" title="Buradan ileriye yeni node ekle" onClick={(e) => openAfterMenu(e, f.loop, o.key)}>
                    +
                  </button>
                  <div
                    className="node-port out frame-port"
                    style={{ background: o.key === 'done' ? '#ffd24a' : portColor(o.key) }}
                    title="Bütün öğeler bitince akış buradan devam eder. Sürükle ve dışarıdaki bir node’a bırak."
                    onMouseDown={(e) => startLink(e, f.loop, o.key)}
                  />
                </div>
              ))}
            </div>
          )
        })}

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
            const t = edgeTarget(b)
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
          if (n.kind === 'loop') return null
          const spec = NODE_SPECS[n.kind]
          const st = p.stepStatus[n.id] ?? 'idle'
          const cls = [
            'agent-node',
            `kind-${n.kind}`,
            p.selectedIds.includes(n.id) ? 'selected' : '',
            hoverTarget === n.id ? 'drop-target' : '',
            st !== 'idle' ? st : '',
          ]
            .filter(Boolean)
            .join(' ')
          const memo = n.memory?.length ?? 0
          return (
            <div
              key={n.id}
              data-node-id={n.id}
              className={cls}
              style={{ left: n.x, top: n.y, width: NODE_W, height: nodeHeight(n.kind), zIndex: 20 + ancestors(p.graph, n.id).length }}
              onMouseDown={(e) => startNodeDrag(e, n)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (!p.selectedIds.includes(n.id)) p.onSelectNode(n.id)
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
                {n.kind === 'package' && (
                  <button
                    type="button"
                    className="xp-btn enter-pkg"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      p.onEnterPackage(n.id)
                    }}
                  >
                    İçine gir
                  </button>
                )}
                {n.locator ? (
                  <div className="node-meta" title={`${n.locator.windowTitle ?? ''} › ${n.locator.path}`}>
                    {n.locator.icon ? <img className="icon-thumb" alt="" src={`data:image/png;base64,${n.locator.icon}`} /> : '● '}
                    {n.locator.text || n.locator.name || (n.locator.icon ? 'seçilen simge' : n.locator.controlType)}
                    {n.locator.windowTitle ? ` · ${n.locator.windowTitle.slice(0, 24)}` : ''}
                  </div>
                ) : memo ? (
                  <div className="node-meta memo" title="Geçen turlarda bulunan hedef. Her tur yine taze aranır; hafıza sadece kararsız kalınca yardım eder.">
                    ◆ hafıza: {memo} tur · son “{n.memory![0].text.slice(0, 22)}”
                  </div>
                ) : n.kind === 'ai' && n.path?.length ? (
                  <div className="node-meta memo" title="Sonraki turda önce bu yol oynatılır; ekran farklılaşınca model devreye girer.">
                    ◆ kayıtlı yol: {n.path.length} adım
                  </div>
                ) : n.kind === 'ai' && n.trace?.length ? (
                  <div className="node-meta memo" title={n.trace.join('\n')}>
                    ◆ geçen tur {n.trace.length} eylemde oldu
                  </div>
                ) : null}
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

        {marquee && (
          <div
            className="marquee"
            style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
          />
        )}

        {menu && (
          <div
            className="ctx-menu"
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {menu.mode === 'node' ? (
              <>
                <div className="ctx-title">{multi ? `${p.selectedIds.length} node seçili` : menuNode?.title}</div>
                {!multi && (
                  <button type="button" onClick={() => { p.onRunFrom(menu.nodeId); setMenu(null) }}>
                    ▶ Buradan çalıştır
                  </button>
                )}
                {(multi || menuNode?.kind !== 'start') && (
                  <button type="button" onClick={() => { p.onWrap(multi ? p.selectedIds : [menu.nodeId]); setMenu(null) }}>
                    ↻ {multi ? 'Seçilenleri' : 'Bunu'} kutuya al (Ctrl+G)
                  </button>
                )}
                {!multi && menuOwner && (
                  <button type="button" onClick={() => { p.onSetMembership([menu.nodeId], ownerOf(p.graph, menuOwner.id)?.id ?? null); setMenu(null) }}>
                    Kutudan çıkar (“{menuOwner.title}”)
                  </button>
                )}
                {!multi && menuNode?.kind !== 'start' && (
                  <button type="button" onClick={() => { p.onDuplicate(menu.nodeId); setMenu(null) }}>
                    Kopyala
                  </button>
                )}
                {!multi && menuNode && (
                  <button type="button" onClick={() => {
                    const port = NODE_SPECS[menuNode.kind].outputs[0]?.key
                    if (port) {
                      const c = edgeSource(menuNode, port)
                      setLink({ from: menuNode.id, port, mx: c.x + 40, my: c.y, sx: -999, sy: -999, moved: false })
                    }
                    setMenu(null)
                  }}>
                    Bağla… (hedefe tıkla)
                  </button>
                )}
                <button type="button" className="danger" onClick={() => {
                  if (multi) p.selectedIds.forEach((id) => p.onDeleteNode(id))
                  else p.onDeleteNode(menu.nodeId)
                  setMenu(null)
                }}>
                  {menuNode?.kind === 'loop' && !multi ? 'Kutuyu sil (içindekiler kalır)' : 'Sil'}
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
