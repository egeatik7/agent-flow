import type { A11yNode } from '../types'

type Props = {
  node: A11yNode
  onPick: (n: A11yNode) => void
}

export default function TreeView({ node, onPick }: Props) {
  return (
    <div className="tree-node">
      <div
        className="tree-row"
        onClick={() => onPick(node)}
        title={node.path}
      >
        <b>{node.controlType}</b> {node.name || '(isimsiz)'}
        {node.automationId ? ` #${node.automationId}` : ''}
      </div>
      {(node.children || []).map((c) => (
        <TreeView key={c.id || c.path} node={c} onPick={onPick} />
      ))}
    </div>
  )
}
