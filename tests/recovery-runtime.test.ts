import { describe, expect, it, vi } from 'vitest'
import { createNode, itemVars, DEFAULT_SETTINGS, type AgentNode } from '../electron/graph-types'
import { recoveryExecutor } from '../electron/recovery-runtime'
import { DEFAULT_RECOVERY } from '../electron/recovery-settings'
import type { ToolContext } from '../electron/tools'
import type { RecoveryRequest } from '../electron/runner'

const calls = vi.hoisted(() => [] as { kind: string; node: AgentNode }[])
vi.mock('../electron/agent', () => ({ createAgent: (ctx: any) => ({ executor: {
  log: ctx.log, step: () => {}, shouldStop: ctx.shouldStop,
  click: async (node: AgentNode) => { calls.push({ kind: 'click', node }) },
  type: async (node: AgentNode) => { calls.push({ kind: 'type', node }) },
  key: async (node: AgentNode) => { calls.push({ kind: 'key', node }) },
  exists: async () => true,
} }) }))

describe('internal recovery desktop session', () => {
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
  it.each(['ai', 'condition', 'package', 'loop'] as const)('does not use %s even if an internal caller bypasses the model tool catalogue', async kind => {
    calls.length = 0
    const node = { ...createNode(kind, 0, 0), id: 'bad' }
    const req = { graph: { nodes: [node], edges: [] }, node, live: node, error: new Error('x'), stepNo: 1, ahead: {}, vars: {} }
    const base = { getSettings: () => ({ ...DEFAULT_SETTINGS, recovery: { ...DEFAULT_RECOVERY, enabled: true, allowedNodeIds: ['bad'] } }), log: () => {} } as unknown as ToolContext
    await expect(recoveryExecutor(req, base, () => false)('step.run', { nodeId: 'bad' })).rejects.toThrow('yetkisi yok')
    expect(calls).toEqual([])
  })
})
