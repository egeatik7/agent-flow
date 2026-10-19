import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode } from '../electron/graph-types'
import { runGraph, StoppedError, type Executor } from '../electron/runner'
import type { CheckpointSnapshot } from '../electron/checkpoint-types'
const opts = { maxSteps: 1000, stepDelayMs: 0, reportEnd: true }
let edgeNo = 0
const edge = (a: AgentNode, b: AgentNode, fromPort = 'next') => ({ id: `cp-edge-${++edgeNo}`, from: a.id, fromPort, to: b.id })
function leaf(text: string) { const n = createNode('type', 0, 0); n.text = text; return n }
function scenario(depth: number, packages: boolean): AgentGraph {
  const start = createNode('start', 0, 0), end = createNode('end', 0, 0)
  const loop = createNode('loop', 0, 0); loop.title = `L${depth}`; loop.items = [`${depth}-A`, `${depth}-B`]
  const before = leaf(`before-${depth}:{{öğe}}:{{sıra}}/{{toplam}}`), after = leaf(`after-${depth}:{{öğe}}`)
  const child = depth ? scenario(depth - 1, packages) : undefined
  if (packages && child) {
    const pkg = createNode('package', 0, 0); pkg.inner = child; loop.members = [before.id, pkg.id, after.id]
    return { nodes: [start, loop, before, pkg, after, end], edges: [edge(start, loop), edge(before, pkg), edge(pkg, after), edge(loop, end, 'done')] }
  }
  if (child) {
    const childLoop = child.nodes.find(n => n.kind === 'loop')!
    const innerNodes = child.nodes.filter(n => n.kind !== 'start' && n.kind !== 'end')
    loop.members = [before.id, childLoop.id, after.id]
    return { nodes: [start, loop, before, ...innerNodes, after, end], edges: [edge(start, loop), edge(before, childLoop), ...child.edges.filter(e => innerNodes.some(n => n.id === e.from) && innerNodes.some(n => n.id === e.to)), edge(childLoop, after, 'done'), edge(loop, end, 'done')] }
  }
  loop.members = [before.id, after.id]
  return { nodes: [start, loop, before, after, end], edges: [edge(start, loop), edge(before, after), edge(loop, end, 'done')] }
}
async function record(graph: AgentGraph, snapshot?: CheckpointSnapshot) {
  const actions: string[] = [], checkpoints: { snapshot: CheckpointSnapshot; offset: number; label: string }[] = []
  const ex: Executor = {
    log: () => {}, step: () => {}, shouldStop: () => false,
    click: async () => {}, key: async () => {}, exists: async () => true,
    type: async n => { actions.push(n.text ?? '') },
    checkpoint: async (label, cursor) => { checkpoints.push({ label, offset: actions.length, snapshot: { graph: structuredClone(graph), cursor: structuredClone(cursor) } }) },
  }
  const summary = await runGraph(graph, ex, { ...opts, ...(snapshot ? { startId: snapshot.cursor.startId, packagePath: snapshot.cursor.packagePath, resume: true, checkpointResume: snapshot.cursor } : {}) })
  return { actions, checkpoints, summary }
}

describe('checkpoints preserve the exact execution suffix', () => {
  it.each([[0, false], [2, false], [1, true], [2, true]] as const)('depth=%s packages=%s: every checkpoint resumes with the same variables, remaining items and continuation', async (depth, packages) => {
    const original = await record(scenario(depth, packages))
    expect(original.checkpoints.length).toBeGreaterThan(1)
    for (const cp of original.checkpoints) {
      const frozen = JSON.stringify(cp.snapshot)
      const resumed = await record(structuredClone(cp.snapshot.graph), cp.snapshot)
      expect(resumed.actions, cp.label).toEqual(original.actions.slice(cp.offset))
      expect(resumed.summary.reachedEnd).toBe(true)
      expect(JSON.stringify(cp.snapshot)).toBe(frozen)
      // Re-checkpoint a resumed run; outside loops/packages must still be recoverable.
      for (const second of resumed.checkpoints.slice(0, 2)) {
        const again = await record(structuredClone(second.snapshot.graph), second.snapshot)
        expect(again.actions, `second resume ${cp.label} → ${second.label}`).toEqual(resumed.actions.slice(second.offset))
      }
    }
  })
  it('checkpoint write failure prevents the first desktop action of that lap', async () => {
    let actions = 0
    const ex: Executor = { log: () => {}, step: () => {}, shouldStop: () => false, click: async () => {}, key: async () => {}, exists: async () => true, type: async () => { actions++ }, checkpoint: async () => { throw new Error('disk full') } }
    await expect(runGraph(scenario(0, false), ex, opts)).rejects.toThrow('disk full')
    expect(actions).toBe(0)
  })
  it('Stop arriving during checkpoint capture sends no input', async () => {
    let stop = false, actions = 0
    const ex: Executor = { log: () => {}, step: () => {}, shouldStop: () => stop, click: async () => {}, key: async () => {}, exists: async () => true, type: async () => { actions++ }, checkpoint: async () => { stop = true } }
    await expect(runGraph(scenario(0, false), ex, opts)).rejects.toBeInstanceOf(StoppedError)
    expect(actions).toBe(0)
  })
})

it.each([false, true])('freezes active directory listings and repeated resumes (packages=%s)', async packages => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-folders-'))
  try {
    const groups = ['group-A', 'group-B'].map(name => path.join(base, name))
    for (const group of groups) for (const sub of ['sub-A', 'sub-B']) {
      const dir = path.join(group, sub); fs.mkdirSync(dir, { recursive: true })
      for (const name of ['one.txt', 'two.txt']) fs.writeFileSync(path.join(dir, name), name)
    }
    const start = createNode('start', 0, 0), end = createNode('end', 0, 0)
    const outer = createNode('loop', 0, 0), middle = createNode('loop', 0, 0), pkg = createNode('package', 0, 0)
    const inner = createNode('loop', 0, 0), before = leaf('before:{{öğe}}'), action = leaf('{{öğe}}'), after = leaf('after:{{öğe}}')
    outer.items = groups; outer.members = [middle.id]
    middle.folder = '{{öğe}}'; middle.members = [pkg.id]
    inner.folder = '{{öğe}}'; inner.members = [action.id]
    pkg.inner = { nodes: [before, inner, action, after], edges: [edge(before, inner), edge(inner, after, 'done')] }
    if (!packages) middle.members = [before.id, inner.id, after.id]
    const graph = packages
      ? { nodes: [start, outer, middle, pkg, end], edges: [edge(start, outer), edge(outer, end, 'done')] }
      : { nodes: [start, outer, middle, before, inner, action, after, end], edges: [edge(start, outer), edge(before, inner), edge(inner, after, 'done'), edge(outer, end, 'done')] }
    const original = await record(graph)
    const cp = original.checkpoints.find(c => c.snapshot.cursor.loops.length === 3)!
    expect(cp).toBeDefined()
    // New siblings must not change either active frozen list. Future outer items still read fresh folders.
    fs.mkdirSync(path.join(groups[0], 'sub-0'))
    fs.writeFileSync(path.join(groups[0], 'sub-A', 'zero.txt'), 'new')
    const resumed = await record(structuredClone(cp.snapshot.graph), cp.snapshot)
    expect(resumed.actions).toEqual(original.actions.slice(cp.offset))
    const cp2 = resumed.checkpoints[0]
    expect(cp2.snapshot.cursor.loops).toHaveLength(3)
    const twice = await record(structuredClone(cp2.snapshot.graph), cp2.snapshot)
    expect(twice.actions).toEqual(resumed.actions.slice(cp2.offset))
  } finally { fs.rmSync(base, { recursive: true, force: true }) }
})
