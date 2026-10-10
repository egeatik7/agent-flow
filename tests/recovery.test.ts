import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNode, itemVars, type AgentGraph } from '../electron/graph-types'
import { runRecovery, recoveryTools, type RecoveryReport } from '../electron/recovery'
import { DEFAULT_RECOVERY, recoverySettings } from '../electron/recovery-settings'
import { runGraph, StoppedError, type Executor, type RecoveryRequest } from '../electron/runner'
import type { ToolMessage } from '../electron/openrouter'

const leaf = { ...createNode('click', 0, 0), id: 'blender', prompt: 'Blender 5.2' }
const graph: AgentGraph = { nodes: [leaf], edges: [] }
const request: RecoveryRequest = { graph, node: leaf, live: leaf, error: new Error('Blender bulunamadı'), stepNo: 4, ahead: {}, vars: itemVars('saved.glb', 0, 1) }
const call = (name: string, args: Record<string, unknown> = {}): ToolMessage => ({ role: 'assistant', content: null, tool_calls: [{ id: `call-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
const finish = () => call('recovery_retry', { probableCause: 'Chrome önde kalmış olabilir.', evidence: 'Ekranda Chrome var.', summary: 'Masaüstü açıldı; aynı node’dan devam denenecek.' })
afterEach(() => { vi.restoreAllMocks() })

function harness(answers: ToolMessage[], patch = {}) {
  const execute = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ ok: true, outcome: 'tamam', message: 'Gönderildi.' }))
  const reports: RecoveryReport[] = []
  const turns: ToolMessage[][] = []
  const deps = { settings: { ...DEFAULT_RECOVERY, enabled: true, model: 'fixture/model', ...patch }, shouldStop: () => false,
    log: vi.fn(), makeExecute: () => execute, recentLog: [{ text: 'Tıkla: Blender 5.2' }],
    previousReports: [{ summary: 'Önceki kurtarma' }], saveReport: (r: RecoveryReport) => reports.push(structuredClone(r)),
    turn: vi.fn(async ({ messages }: { messages: ToolMessage[] }) => { turns.push(structuredClone(messages)); return answers.shift() ?? finish() }),
  }
  return { execute, deps, reports, turns }
}

describe('recovery controller', () => {
  it('reads canvas JSON, lap and prior reports, repairs with a shortcut, then requests the same node', async () => {
    const h = harness([call('act_key', { keys: 'win+d' }), finish()])
    const before = JSON.stringify(graph)
    const result = await runRecovery(request, h.deps)
    expect(result.decision).toBe('retry')
    expect(h.execute).toHaveBeenCalledExactlyOnceWith('act.key', { keys: 'win+d' })
    const context = JSON.parse(h.turns[0][1].content as string)
    expect(context.canvasJson).toEqual(graph)
    expect(context.failure.vars['oge']).toBe('saved.glb')
    expect(context.previousRecoveryReports[0].summary).toBe('Önceki kurtarma')
    expect(JSON.stringify(graph)).toBe(before)
    expect(h.reports[0].probableCause).toContain('olabilir')
    expect(h.reports[0].actions).toHaveLength(1)
  })
  it('does not accept a dispatched node as goal completion, but lets the agent correct the click visually', async () => {
    const done = call('recovery_complete', { probableCause: 'Wrong point', evidence: 'Blender is now open', summary: 'Corrected through the pointer' })
    const h = harness([call('step_run', { nodeId: leaf.id }), finish(), done, call('step_run', { nodeId: leaf.id }),
      call('screen_read'), call('act_move', { x: 0.4, y: 0.8 }), call('screen_read'), call('act_click_current', { mode: 'double' }), done, call('screen_read'), done])
    expect((await runRecovery(request, h.deps)).decision).toBe('completed')
    expect(h.execute.mock.calls.map(([name]) => name)).toEqual(['step.run', 'screen.read', 'act.move', 'screen.read', 'act.clickCurrent', 'screen.read'])
    expect(h.reports[0].actions.filter(a => a.outcome === 'hata')).toHaveLength(4)
    expect(h.reports[0].completionBasis).toBe('model-observed')
  })
  it('can finish the current goal through alternative actions after observing the new screen', async () => {
    const done = call('recovery_complete', { probableCause: 'Shortcut obscured', evidence: 'Blender is now open', summary: 'Blender launched using Run' })
    const h = harness([done, call('act_key', { keys: 'win+r' }), call('screen_read'), done])
    expect((await runRecovery(request, h.deps)).decision).toBe('completed')
    expect(h.execute).toHaveBeenCalledTimes(2)
    expect(h.reports[0].completionBasis).toBe('model-observed')
    expect(h.reports[0].actions[0].outcome).toBe('hata')
    expect(h.reports[0].summary).toBe('Blender launched using Run')
  })
  it('does not act from a model answer that arrived after the recovery deadline', async () => {
    const h = harness([], { timeoutMs: 10_000 })
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    h.deps.turn = vi.fn(async () => { clock.mockReturnValue(now + 11_000); return call('act_key', { keys: 'delete' }) })
    expect((await runRecovery(request, h.deps)).decision).toBe('stop')
    expect(h.execute).not.toHaveBeenCalled()
    expect(h.reports[0].summary).toContain('süresi doldu')
  })
  it.each(['ai', 'condition', 'package', 'loop'] as const)('cannot execute %s even when its id is explicitly allowed', async kind => {
    const forbidden = { ...createNode(kind, 0, 0), id: 'forbidden' }
    const h = harness([call('step_run', { nodeId: forbidden.id }), finish()], { allowedNodeIds: [forbidden.id] })
    await runRecovery({ ...request, graph: { nodes: [leaf, forbidden], edges: [] } }, h.deps)
    expect(h.execute).not.toHaveBeenCalled()
    expect(h.reports[0].actions[0].outcome).toBe('hata')
  })
  it('honors desktop and node permissions in actual calls, and rejects flow mutation', async () => {
    const h = harness([call('act_key', { keys: 'alt+f4' }), call('step_run', { nodeId: leaf.id }), call('flow_edit', { graph }), finish()], { allowDesktop: false, allowNodes: false })
    await runRecovery(request, h.deps)
    expect(h.execute).not.toHaveBeenCalled()
    expect(h.reports[0].actions).toHaveLength(3)
    expect(recoveryTools(h.deps.settings).some(t => t.function.name.startsWith('act_'))).toBe(false)
  })
  it('never sends an action from a delayed answer after Stop, and still saves the report', async () => {
    const h = harness([])
    let stopped = false
    h.deps.shouldStop = () => stopped
    h.deps.turn = vi.fn(async () => { stopped = true; return call('act_key', { keys: 'alt+f4' }) })
    await expect(runRecovery(request, h.deps)).rejects.toBeInstanceOf(StoppedError)
    expect(h.execute).not.toHaveBeenCalled()
    expect(h.reports[0].result).toBe('stopped')
  })
  it('stops on the current item when its action budget is spent; bare prose is not success', async () => {
    const h = harness([call('act_key', { keys: 'win+d' }), finish()], { maxCalls: 1 })
    expect((await runRecovery(request, h.deps)).decision).toBe('stop')
    expect(h.reports[0].summary).toContain('sınırı')
    const prose = harness(Array.from({ length: 8 }, () => ({ role: 'assistant' as const, content: 'Done!' })), { maxCalls: 1 })
    expect((await runRecovery(request, prose.deps)).decision).toBe('stop')
    expect(prose.execute).not.toHaveBeenCalled()
  })
  it('is silent and consumes no model calls when disabled', async () => {
    const h = harness([finish()], { enabled: false })
    expect((await runRecovery(request, h.deps)).decision).toBeUndefined()
    expect(h.deps.turn).not.toHaveBeenCalled(); expect(h.reports).toEqual([])
  })
  it('sends actual screenshot image content after all tool results of a batch', async () => {
    const batch = call('screen_read'); batch.tool_calls!.push(...call('flow_read').tool_calls!)
    const h = harness([batch, finish()])
    h.execute.mockImplementation(async () => ({ ok: true, outcome: 'tamam', message: 'Ekran', data: { image: { data: 'PIXELS', mime: 'image/png' } } }))
    await runRecovery(request, h.deps)
    const messages = h.turns[1]
    expect(messages[3].role).toBe('tool'); expect(messages[4].role).toBe('tool')
    expect(JSON.stringify(messages[3])).not.toContain('PIXELS')
    expect(JSON.stringify(messages[5])).toContain('data:image/png;base64,PIXELS')
  })
  it('normalizes old or malformed configuration without enabling the agent', () => {
    expect(recoverySettings().enabled).toBe(false)
    expect(recoverySettings({ maxCalls: Infinity, timeoutMs: -5 }).maxCalls).toBe(16)
    expect(recoverySettings({ timeoutMs: -5 }).timeoutMs).toBe(10_000)
  })
})

describe('inline recovery preserves the runner stack', () => {
  it('continues through nested loops and a package without replaying completed sibling actions', async () => {
    const start = createNode('start', 0, 0)
    const before = { ...createNode('key', 0, 0), keys: 'before' }
    const after = { ...createNode('key', 0, 0), keys: 'after' }
    const click = { ...createNode('click', 0, 0), prompt: '{{öğe}}' }
    const pkg = { ...createNode('package', 0, 0), inner: { nodes: [click], edges: [] } }
    const inner = { ...createNode('loop', 0, 0), count: 2, members: [before.id, pkg.id, after.id] }
    const outer = { ...createNode('loop', 0, 0), items: ['folderA', 'folderB'], members: [inner.id] }
    const g = { nodes: [start, outer, inner, before, pkg, after], edges: [
      { id: 'entry', from: start.id, fromPort: 'next', to: outer.id },
      { id: 'before', from: before.id, fromPort: 'next', to: pkg.id },
      { id: 'after', from: pkg.id, fromPort: 'next', to: after.id },
    ] }
    const actions: string[] = []
    let firstFailure = true
    const ex: Executor = { log: () => {}, step: () => {}, shouldStop: () => false, type: async () => {}, exists: async () => true,
      key: async n => { actions.push(n.keys!) }, click: async n => { actions.push(`click:${n.prompt}`); if (firstFailure) { firstFailure = false; throw new Error('not found') } },
      recover: async r => { expect(r.vars['oge']).toBe('1'); expect(r.graph).toBe(g); actions.push('repair'); return 'retry' },
    }
    expect((await runGraph(g, ex, { maxSteps: 100, stepDelayMs: 0 })).failed).toBe(0)
    expect(actions).toEqual(['before', 'click:1', 'repair', 'click:1', 'after', 'before', 'click:2', 'after', 'before', 'click:1', 'after', 'before', 'click:2', 'after'])
  })
  it('does not advance to the next loop item when recovery could not fix the failure', async () => {
    const click = { ...createNode('click', 0, 0), prompt: '{{öğe}}' }
    const loop = { ...createNode('loop', 0, 0), items: ['first', 'second'], members: [click.id] }
    const actions: string[] = []
    const ex: Executor = { log: () => {}, step: () => {}, shouldStop: () => false, type: async () => {}, key: async () => {}, exists: async () => true,
      click: async n => { actions.push(n.prompt!); throw new Error('missing') }, recover: async () => 'stop',
    }
    await expect(runGraph({ nodes: [loop, click], edges: [] }, ex, { maxSteps: 100, stepDelayMs: 0 })).rejects.toThrow('toparlayamadı')
    expect(actions).toEqual(['first']); expect(loop.loopIndex).toBe(0)
  })
})
