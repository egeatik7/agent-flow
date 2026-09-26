import { useRef } from 'react'
import type { AgentGraph, StepStatus } from '../types'

type Props = {
  graph: AgentGraph
  selectedId: string | null
  stepStatus: Record<string, StepStatus>
  connectFrom: string | null
  onSelect: (id: string) => void
  onMove: (id: string, x: number, y: number) => void
  onPortClick: (id: string, dir: 'in' | 'out') => void
  onOpenNode: () => void
}

export default function NodeCanvas({
  graph,
  selectedId,
  stepStatus,
  connectFrom,
  onSelect,
  onMove,
  onPortClick,
  onOpenNode,
}: Props) {
  const drag = useRef<{
    id: string
    ox: number
    oy: number
    nx: number
    ny: number
  } | null>(null)

  const byId = new Map(graph.nodes.map((n) => [n.id, n]))

  return (
    <>
      {graph.nodes.length === 0 && (
        <div className="empty-canvas">
          Node ekle veya <b>Kayıt</b> ile accessibility öğelerini yakala.
          <br />
          Her node bir aşama prompt’u tutar (örn. “tepeye Hunyuan Tencent yaz”).
        </div>
      )}
      <svg className="edge-layer" width="100%" height="100%">
        {graph.edges.map((e) => {
          const a = byId.get(e.from)
          const b = byId.get(e.to)
          if (!a || !b) return null
          const x1 = a.x + 210
          const y1 = a.y + 36
          const x2 = b.x
          const y2 = b.y + 36
          const mx = (x1 + x2) / 2
          return (
            <path
              key={e.id}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              stroke="#0a246a"
              strokeWidth="2"
              fill="none"
              markerEnd="url(#arrow)"
            />
          )
        })}
        <defs>
          <marker
            id="arrow"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill="#0a246a" />
          </marker>
        </defs>
      </svg>
      {graph.nodes.map((n) => {
        const st = stepStatus[n.id] || 'idle'
        const cls = [
          'agent-node',
          selectedId === n.id ? 'selected' : '',
          connectFrom === n.id ? 'selected' : '',
          st,
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <div
            key={n.id}
            className={cls}
            style={{ left: n.x, top: n.y }}
            onMouseDown={(ev) => {
              if ((ev.target as HTMLElement).classList.contains('node-port')) return
              onSelect(n.id)
              drag.current = {
                id: n.id,
                ox: ev.clientX,
                oy: ev.clientY,
                nx: n.x,
                ny: n.y,
              }
              const move = (e: MouseEvent) => {
                if (!drag.current) return
                const x = drag.current.nx + (e.clientX - drag.current.ox)
                const y = drag.current.ny + (e.clientY - drag.current.oy)
                onMove(drag.current.id, Math.max(0, x), Math.max(0, y))
              }
              const up = () => {
                drag.current = null
                window.removeEventListener('mousemove', move)
                window.removeEventListener('mouseup', up)
              }
              window.addEventListener('mousemove', move)
              window.addEventListener('mouseup', up)
            }}
            onDoubleClick={() => {
              onSelect(n.id)
              onOpenNode()
            }}
          >
            <div className="node-head">
              <span>{n.title || 'Aşama'}</span>
              <span className="status-chip">{st}</span>
            </div>
            <div className="node-body">
              {n.prompt || <i>Prompt yazılmadı…</i>}
            </div>
            {n.recorded && (
              <div className="node-meta">
                [kayıt] {n.recorded.controlType}: {n.recorded.name || n.recorded.path}
              </div>
            )}
            <div
              className="node-port in"
              title="Giriş"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onPortClick(n.id, 'in')
              }}
            />
            <div
              className="node-port"
              title="Çıkış — bağlamak için tıkla"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onPortClick(n.id, 'out')
              }}
            />
          </div>
        )
      })}
    </>
  )
}
