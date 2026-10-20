import { describe, expect, it, vi } from 'vitest'
import { createNode, itemVars, DEFAULT_SETTINGS, type AgentNode } from '../electron/graph-types'
import { recoveryExecutor } from '../electron/recovery-runtime'
import { DEFAULT_RECOVERY } from '../electron/recovery-settings'
import type { ToolContext } from '../electron/tools'
import { StoppedError, type RecoveryRequest } from '../electron/runner'

const calls = vi.hoisted(() => [] as { kind: string; node: AgentNode }[])
vi.mock('../electron/agent', () => ({ createAgent: (ctx: any) => ({ executor: {
  log: ctx.log, step: () => {}, shouldStop: ctx.shouldStop,
  click: async (node: AgentNode) => { calls.push({ kind: 'click', node }) },
  type: async (node: AgentNode) => { calls.push({ kind: 'type', node }) },
  key: async (node: AgentNode) => { calls.push({ kind: 'key', node }) },
  exists: async () => true,
} }) }))

describe('internal recovery desktop session', () => {
  function waitExecutor(shouldStop = () => false, taskMode = false) {
    const node = { ...createNode('click', 0, 0), id: 'wait-target' }
    const request: RecoveryRequest = { graph: { nodes: [node], edges: [] }, node, live: node, error: new Error('missing'), stepNo: 1, ahead: {}, vars: {} }
    const base = { getSettings: () => ({ ...DEFAULT_SETTINGS, stepDelayMs: 0, recovery: { ...DEFAULT_RECOVERY, enabled: true } }), log: () => {} } as unknown as ToolContext
    return recoveryExecutor(request, base, shouldStop, undefined, taskMode)
  }
  it('actually waits beyond ten seconds in Recovery while keeping the Yap wait cap unchanged', async () => {
    vi.useFakeTimers()
    try {
      let completed = false
      const pending = waitExecutor()('act.wait', { ms: 60_000 }).then(result => { completed = true; return result })
      await vi.advanceTimersByTimeAsync(10_001)
      expect(completed).toBe(false)
      await vi.advanceTimersByTimeAsync(50_000)
      expect((await pending).ok).toBe(true)
      completed = false
      const yap = waitExecutor(() => false, true)('act.wait', { ms: 60_000 }).then(result => { completed = true; return result })
      await vi.advanceTimersByTimeAsync(10_001)
      expect(completed).toBe(true)
      expect((await yap).ok).toBe(true)
    } finally { vi.useRealTimers() }
  })
  it('interrupts a long Recovery wait when the user presses Stop', async () => {
    vi.useFakeTimers()
    try {
      let stopped = false
      const result = waitExecutor(() => stopped)('act.wait', { ms: 60_000 }).catch(error => error)
      await vi.advanceTimersByTimeAsync(500)
      stopped = true
      await vi.advanceTimersByTimeAsync(500)
      expect(await result).toBeInstanceOf(StoppedError)
    } finally { vi.useRealTimers() }
  })
  it('executes only the chosen action with the paused item and leaves graph, tick, and following nodes intact', async () => {
    calls.length = 0
    const leaf = { ...createNode('type', 0, 0), id: 'leaf', text: '{{öğe}}' }
    const following = { ...createNode('key', 0, 0), id: 'following', keys: 'delete' }
    const helper = { ...createNode('type', 0, 0), id: 'helper', text: 'file={{öğe}}' }
    const loop = { ...createNode('loop', 0, 0), items: ['old.glb', 'saved.glb'], loopIndex: 1, members: [leaf.id, following.id] }
    const graph = { nodes: [loop, leaf, following, helper], edges: [{ id: 'next', from: leaf.id, fromPort: 'next', to: following.id }] }
    const req: RecoveryRequest = { graph, node: leaf, live: { ...leaf, text: 'saved.glb' }, vars: itemVars('saved.glb', 1, 2), stepNo: 10, ahead: { next: following }, error: new Error('missing') }
    const base = { getSettings: () => ({ ...DEFAULT_SETTINGS, stepDelayMs: 0, recovery: { ...DEFAULT_RECOVERY, enabled: true, allowedNodeIds: [helper.id] } }), log: () => {} } as unknown as ToolContext
    const execute = recoveryExecutor(req, base, () => false)
    const before = JSON.stringify(graph)
    await execute('step.run', { nodeId: helper.id })
    await execute('step.run', { nodeId: leaf.id })
    expect(calls.map(c => c.node.text)).toEqual(['file=saved.glb', 'saved.glb'])
    expect(calls.every(c => c.kind === 'type')).toBe(true)
    expect(JSON.stringify(graph)).toBe(before)
  })
  it('Yap uses desktop tools with recovery disabled but cannot execute another node', async () => {
    calls.length = 0
    const node = { ...createNode('ai',0,0), id: 'task' }
    const req: RecoveryRequest = { graph: { nodes: [node], edges: [] }, node, live: node, error: new Error(''), stepNo: 1, ahead: {}, vars: {} }
    const base = { getSettings: () => ({ ...DEFAULT_SETTINGS, stepDelayMs: 0, recovery: { ...DEFAULT_RECOVERY, allowDesktop: false, allowNodes: false } }), log: () => {} } as unknown as ToolContext
    const execute = recoveryExecutor(req, base, () => false, undefined, true)
    await execute('act.key', { keys: 'enter' })
    expect(calls[0].node.keys).toBe('enter')
    await expect(execute('step.run', { nodeId: node.id })).rejects.toThrow('başka node')
  })
  it.each(['ai', 'condition', 'package', 'loop'] as const)('does not use %s even if an internal caller bypasses the model tool catalogue', async kind => {
    calls.length = 0
    const node = { ...createNode(kind, 0, 0), id: 'bad' }
    const req = { graph: { nodes: [node], edges: [] }, node, live: node, error: new Error('x'), stepNo: 1, ahead: {}, vars: {} }
    const base = { getSettings: () => ({ ...DEFAULT_SETTINGS, recovery: { ...DEFAULT_RECOVERY, enabled: true, allowedNodeIds: ['bad'] } }), log: () => {} } as unknown as ToolContext
    await expect(recoveryExecutor(req, base, () => false)('step.run', { nodeId: 'bad' })).rejects.toThrow('yetkisi yok')
    expect(calls).toEqual([])
  })
})

it('B2: actual move-only step reports sent:false and preserves the click retry distinction',async()=>{
  const node={...createNode('click',0,0),clickMode:'move' as const,prompt:'target'}
  const request={graph:{nodes:[node],edges:[]},node,live:node,error:new Error('missing'),stepNo:1,ahead:{},vars:{}}
  const execute=recoveryExecutor(request,{getSettings:()=>({...DEFAULT_SETTINGS,recovery:{...DEFAULT_RECOVERY,enabled:true,allowNodes:true}}),log:()=>{}} as unknown as ToolContext,()=>false)
  const result=await execute('step.run',{nodeId:node.id})
  expect(result.data).toMatchObject({sent:false,inputKind:'move'})
})
