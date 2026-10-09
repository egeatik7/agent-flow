import { useEffect, useMemo, useRef } from 'react'
import { NODE_SPECS, type AgentGraph, type StepStatus } from '../types'
import { canvasNodes } from '../lib/canvas-navigation'

function NavigationIcon(p: { direction: 'back' | 'forward' | 'out' }) {
  return <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
    {p.direction === 'out' ? <><path d="M2 8h6l2 2h8v7H2z" fill="#f4cd65" stroke="#95732c"/><path d="M10 12V2M6 6l4-4 4 4" fill="none" stroke="#2c649f" strokeWidth="2" strokeLinejoin="round"/></>
      : <path d={p.direction === 'back' ? 'M17 8H9V3L2 10l7 7v-5h8z' : 'M3 8h8V3l7 7-7 7v-5H3z'} fill="#5c9f43" stroke="#326c23" strokeLinejoin="round"/>}
  </svg>
}
export default function NodeNavigator(p: {
  graph: AgentGraph; name?: string; locationKey?: string; disabled?: boolean; inspecting?: boolean; active?: boolean
  onNavigate?: (id: string, inspect: boolean) => void
  onBack?: () => void; onForward?: () => void; onOut?: () => void
  canBack?: boolean; canForward?: boolean; canOut?: boolean
  stepStatus?: Record<string, StepStatus>; highlightedNodeIds?: string[]; runPhase?: 'idle' | 'running' | 'stopped'
}) {
  const nodes = useMemo(() => canvasNodes(p.graph), [p.graph])
  const pending = useRef<ReturnType<typeof setTimeout>>()
  const cancel = () => { if (pending.current) clearTimeout(pending.current); pending.current = undefined }
  useEffect(() => cancel, [p.locationKey, p.active, p.disabled])
  return <section className={`node-navigator${p.inspecting ? ' inspecting' : ''}`} aria-label="Tuval gezgini">
    <div className="navigator-toolbar">
      <button className="xp-btn navigator-tool" title="Geri" aria-label="Geri" disabled={p.disabled || !p.canBack} onClick={() => { cancel(); p.onBack?.() }}><NavigationIcon direction="back"/></button>
      <button className="xp-btn navigator-tool" title="İleri" aria-label="İleri" disabled={p.disabled || !p.canForward} onClick={() => { cancel(); p.onForward?.() }}><NavigationIcon direction="forward"/></button>
      <button className="xp-btn navigator-tool" title="Dışarı — bir üst pakete çık" aria-label="Dışarı" disabled={p.disabled || !p.canOut} onClick={() => { cancel(); p.onOut?.() }}><NavigationIcon direction="out"/></button>
      <span className="navigator-location" title={p.name}>{p.name || 'Tuval'}</span>
    </div>
    <ul className="navigator-list" aria-label="Bu bölümdeki nodeler">
      {nodes.map(node => {
        const spec = NODE_SPECS[node.kind]
        const highlighted = p.highlightedNodeIds?.includes(node.id)
        const status = p.stepStatus?.[node.id]
        const state = status === 'error' ? 'error' : highlighted && p.runPhase !== 'idle' ? p.runPhase : status === 'done' ? 'done' : undefined
        return <li key={node.id}><button type="button" className={`navigator-node${state ? ` ${state}` : ''}`} disabled={p.disabled}
          title={`${node.title} — ${spec.label} · Tek tık: ${node.kind === 'package' ? 'içine gir' : 'merkeze git'} · Çift tık: ayarlar`}
          onClick={e => {
            cancel()
            if (e.detail > 1) return
            // Keep the row stable until a possible double click, so package
            // settings can open instead of the second click hitting a new row.
            if (node.kind === 'package') pending.current = setTimeout(() => { pending.current = undefined; p.onNavigate?.(node.id, false) }, 300)
            else p.onNavigate?.(node.id, false)
          }}
          onDoubleClick={() => { cancel(); p.onNavigate?.(node.id, true) }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); cancel(); p.onNavigate?.(node.id, e.ctrlKey || e.metaKey) } }}>
          <span className={`navigator-node-icon ${node.kind === 'package' ? 'package' : ''}`} style={{ color: spec.color }} aria-hidden>{node.kind === 'package' ? '▰' : spec.icon}</span>
          <span className="navigator-node-name">{node.title || spec.label}<small>{spec.label}</small></span>
          {state && <span className={`navigator-status ${state}`}>{state === 'running' ? 'Çalışıyor' : state === 'stopped' ? 'Durdu' : state === 'error' ? 'Hata' : 'Bitti'}</span>}
          {node.kind === 'package' && <span className="navigator-enter" aria-hidden>›</span>}
        </button></li>
      })}
      {!nodes.length && <li><p className="hint">Bu bölüm boş. Bir tuval aç veya node ekle.</p></li>}
    </ul>
  </section>
}
