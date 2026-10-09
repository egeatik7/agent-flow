import { useMemo, useState } from 'react'
import { NODE_SPECS, type AgentGraph } from '../types'
import { canvasHierarchy, type HierarchyEntry } from '../lib/canvas-hierarchy'

export default function NodeHierarchy(p: {
  graph: AgentGraph; name?: string; onNavigate?: (id: string, path: string[]) => void
}) {
  const entries = useMemo(() => canvasHierarchy(p.graph), [p.graph])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const allKeys = (rows: HierarchyEntry[]): string[] => rows.flatMap(row => [row.key, ...allKeys(row.children)])
  const render = (rows: HierarchyEntry[]) => rows.map(row => {
    const { node } = row
    const folder = node.kind === 'loop' || node.kind === 'package'
    const open = expanded.has(row.key)
    const spec = NODE_SPECS[node.kind]
    return <li role="treeitem" aria-expanded={folder ? open : undefined} key={row.key}>
      <div className="hierarchy-row">
        {folder ? <button className="hierarchy-toggle" aria-label={`${node.title}: ${open ? 'Daralt' : 'Genişlet'}`} onClick={() => setExpanded(prev => {
          const next = new Set(prev); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next
        })}>{open ? '−' : '+'}</button> : <span className="hierarchy-spacer" />}
        <button className="hierarchy-node" title={`${node.title} — ${spec.label}`} onClick={() => p.onNavigate?.(node.id, row.packagePath)}>
          <span className={`hierarchy-icon ${folder ? 'folder' : ''}`} style={{ color: spec.color }} aria-hidden>{folder ? '▰' : spec.icon}</span>
          <span>{node.title || spec.label}</span>
        </button>
      </div>
      {folder && open && (row.children.length ? <ul role="group">{render(row.children)}</ul> : <div className="hierarchy-empty">Boş</div>)}
    </li>
  })
  return <section className="node-hierarchy" aria-label="Tuval hiyerarşisi">
    <h3 title={p.name}>{p.name || 'Tuval hiyerarşisi'}</h3>
    <div className="hierarchy-actions">
      <button className="xp-btn" onClick={() => setExpanded(new Set(allKeys(entries)))}>Expand All</button>
      <button className="xp-btn" onClick={() => setExpanded(new Set())}>Collapse All</button>
    </div>
    {entries.length ? <ul className="hierarchy-tree" role="tree" aria-label="Paketler, döngüler ve nodeler">{render(entries)}</ul>
      : <p className="hint">Bir tuval aç veya yeni tuvale node ekle.</p>}
  </section>
}
