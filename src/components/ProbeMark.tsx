import { TEMPLATE_VARS, type AgentGraph, type AgentNode } from '../types'
import { revealAt } from '../../electron/reveal'

export default function ProbeMark(p: { graph: AgentGraph; node: AgentNode; onPick: (token: string) => void }) {
  const reveal = p.node.text ? revealAt(p.graph, p.node.id, p.node.text) : null
  return (
    <div className="probe-mark" onMouseDown={(e) => e.stopPropagation()}>
      <div className="probe-chips">
        {TEMPLATE_VARS.map((v) => (
          <button
            type="button"
            key={v}
            className={'chip var' + (p.node.text === v ? ' on' : '')}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              p.onPick(v)
            }}
          >
            {v}
          </button>
        ))}
      </div>
      {reveal ? (
        <>
          <div className="probe-value" title={reveal.value}>
            {reveal.value}
          </div>
          <div className="probe-where">{reveal.where}</div>
        </>
      ) : (
        <div className="probe-where">Bir değişkene tıkla. Bu node’un durduğu kutudaki değeri gösterir.</div>
      )}
    </div>
  )
}
