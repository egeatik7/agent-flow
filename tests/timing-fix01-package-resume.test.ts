import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode } from '../electron/graph-types'
import { runGraph, type Executor } from '../electron/runner'

const edge = (from: AgentNode, port: string, to: AgentNode) => ({ id: `${from.id}-${port}-${to.id}`, from: from.id, fromPort: port, to: to.id })
function fixture(items: string[]) {
  const start = createNode('start', 0, 0)
  const loop = createNode('loop', 100, 0)
  loop.items = items
  loop.startIndex = 0 // formerly b.glb; a.glb was inserted before the saved item
  const pkg = createNode('package', 200, 0)
  const write = createNode('type', 0, 0)
  write.text = '{{öğe}}'
  pkg.inner = { nodes: [write], edges: [] }
  loop.members = [pkg.id]
  const graph: AgentGraph = { nodes: [start, loop, pkg], edges: [edge(start, 'next', loop)] }
  const writes: string[] = []
  const ex: Executor = {
    shouldStop: () => false, log: () => {}, step: () => {},
    click: async () => {}, key: async () => {}, exists: async () => true,
    type: async node => { writes.push(node.text ?? '') },
  }
  return { graph, loop, pkg, write, writes, ex }
}
const opts = { maxSteps: 100, stepDelayMs: 0, resume: true }

describe('package resume identity is validated before input', () => {
  it('validates and uses saved item before first package input when a saved item moves in its outer list', async () => {
    const f = fixture(['a.glb', 'b.glb', 'c.glb'])
    await runGraph(f.graph, f.ex, { ...opts, packagePath: [f.pkg.id], startId: f.write.id, resumeLoopId: f.loop.id, resumeItem: 'b.glb' })
    // The first input must already use the resolved identity.
    expect(f.writes).toEqual(['b.glb', 'c.glb'])
  })
  it('rejects an absent saved item before input', async () => {
    const f = fixture(['a.glb', 'c.glb'])
    await expect(runGraph(f.graph, f.ex, { ...opts, packagePath: [f.pkg.id], startId: f.write.id, resumeLoopId: f.loop.id, resumeItem: 'b.glb' })).rejects.toThrow('b.glb')
    // No desktop input is allowed before identity validation.
    expect(f.writes).toEqual([])
  })
  it('control: selecting the package itself validates identity before running its contents', async () => {
    const f = fixture(['a.glb', 'b.glb', 'c.glb'])
    await runGraph(f.graph, f.ex, { ...opts, startId: f.pkg.id, resumeLoopId: f.loop.id, resumeItem: 'b.glb' })
    expect(f.writes).toEqual(['b.glb', 'c.glb'])
  })
})
