import { useState } from 'react'
import type { A11yNode } from '../types'

type Props = {
  node: A11yNode
  onPick: (n: A11yNode) => void
  depth: number
}

export default function TreeView({ node, onPick, depth }: Props) {
  const [open, setOpen] = useState(depth < 3)
  const kids = node.children ?? []
  return (
    <div className="tree-node" style={{ marginLeft: depth === 0 ? 0 : 12 }}>
      <div className="tree-row" title={node.path}>
        <button
          type="button"
          className="tree-toggle"
          onClick={() => setOpen((o) => !o)}
          style={{ visibility: kids.length ? 'visible' : 'hidden' }}
        >
          {open ? '−' : '+'}
        </button>
        <span className="tree-label" onClick={() => onPick(node)}>
          <b>{node.controlType}</b> {node.name || <i>(isimsiz)</i>}
          {node.automationId ? <span className="tree-aid"> #{node.automationId}</span> : null}
        </span>
      </div>
      {open && kids.map((c) => <TreeView key={c.path} node={c} onPick={onPick} depth={depth + 1} />)}
    </div>
  )
}
