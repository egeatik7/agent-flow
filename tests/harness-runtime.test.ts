import { expect, it, vi } from 'vitest'
import { createNode, DEFAULT_SETTINGS } from '../electron/graph-types'
import { recoveryExecutor } from '../electron/recovery-runtime'
import { recoverySettings, harnessSettings } from '../electron/recovery-settings'
import type { ToolContext } from '../electron/tools'
const sent = vi.hoisted(() => [] as any[])
vi.mock('../electron/agent', () => ({ createAgent: (ctx: any) => ({ executor: { log: ctx.log, shouldStop: ctx.shouldStop,
  step: () => {}, type: async (node: any) => { sent.push(node) }, key: async (node: any) => { sent.push(node) }, exists: async () => true,
} }) }))
const shell = vi.hoisted(() => vi.fn(async () => ({ ok: true, outcome: 'tamam', message: 'shell', data: { stdout: 'ok' } })))
vi.mock('../electron/windows-tools', () => ({ runPowerShell: shell, windowScript: () => 'window' }))
it('full control uses a frozen settings snapshot, all leaf nodes, and the paused item while allowing OS commands', async () => {
  sent.length = 0
  const leaf = { ...createNode('type', 0, 0), id: 'leaf', text: '{{oge}}' }
  const helper = { ...leaf, id: 'helper', text: 'helper={{oge}}' }
  const request = { graph: { nodes: [leaf, helper], edges: [] }, node: leaf, live: leaf, error: new Error('missing'), stepNo: 1, ahead: {}, vars: { oge: 'CURRENT.glb' } }
  const snapshot = recoverySettings({ enabled: true, provider: 'harness', allowDesktop: false, allowCode: false, allowNodes: false, harness: harnessSettings({ fullControl: true }) })
  const base = { getSettings: () => ({ ...DEFAULT_SETTINGS, stepDelayMs: 0, recovery: recoverySettings({ enabled: false }) }), log: () => {} } as unknown as ToolContext
  const execute = recoveryExecutor(request, base, () => false, undefined, false, snapshot)
  await execute('step.run', { nodeId: 'helper' })
  await execute('powershell_run', { code: 'Get-Process' })
  expect(sent[0].text).toBe('helper=CURRENT.glb'); expect(shell).toHaveBeenCalled()
  expect(request.graph.nodes[1].text).toBe('helper={{oge}}')
})
it('full control off retains desktop/code restrictions even when a caller knows the tool name', async () => {
  const leaf = createNode('click', 0, 0)
  const request = { graph: { nodes: [leaf], edges: [] }, node: leaf, live: leaf, error: new Error('missing'), stepNo: 1, ahead: {}, vars: {} }
  const snapshot = recoverySettings({ enabled: true, provider: 'harness', allowDesktop: false, allowCode: false, harness: harnessSettings({ fullControl: false }) })
  const base = { getSettings: () => DEFAULT_SETTINGS, log: () => {} } as unknown as ToolContext
  await expect(recoveryExecutor(request, base, () => false, undefined, false, snapshot)('powershell_run', { code: 'Get-Process' })).rejects.toThrow('kapalı')
})
