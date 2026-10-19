import { describe, expect, it } from 'vitest'
import { runYap, yapTools } from '../electron/yap'
import { createNode, normalizeGraph, NODE_SPECS } from '../electron/graph-types'
import { StoppedError } from '../electron/runner'
import { windowScript, windowsTools } from '../electron/windows-tools'
import type { ToolMessage } from '../electron/openrouter'

const call = (name: string, args: object = {}): ToolMessage => ({ role: 'assistant', content: null, tool_calls: [{ id: Math.random().toString(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
function harness(answers: ToolMessage[]) {
  const executed: string[] = [], transcripts: string[] = []
  return { executed, transcripts, deps: {
    shouldStop: () => false, log: () => {},
    makeExecute: () => async (name: string) => { executed.push(name); return { ok: true, outcome: 'tamam', message: 'ok' } },
    turn: async ({ messages }: { messages: ToolMessage[] }) => { transcripts.push(JSON.stringify(messages)); if (!answers.length) throw new Error('no answer'); return answers.shift()! },
  } }
}

describe('Yap task agent', () => {
  it('reuses desktop tools while excluding repair decisions and node execution', () => {
    const names = yapTools().map(t => t.function.name)
    expect(names).toContain('act_click_point'); expect(names).toContain('window_action'); expect(names).toContain('powershell_run')
    expect(names).not.toContain('step_run'); expect(names).not.toContain('target_preview')
    expect(names.some(n => n.startsWith('recovery_'))).toBe(false)
    expect(yapTools(false).some(t => t.function.name === 'powershell_run')).toBe(false)
  })
  it('retains legacy identities, packages and both existing success/failure connections', () => {
    const node = { ...createNode('ai', 0, 0), id: 'legacy', engine: 'list' as const, trace: ['old'], path: [{ action: 'wait' as const }] }
    const end = { ...createNode('end', 0, 0), id: 'end' }
    const edges = ['next', 'fail'].map(p => ({ id: p, from: node.id, fromPort: p, to: end.id }))
    const graph = normalizeGraph({ nodes: [node, end], edges })
    expect(graph.edges.filter(e => e.from === node.id)).toEqual(edges); expect(graph.nodes.find(n => n.id === 'legacy')?.kind).toBe('ai')
    expect(NODE_SPECS.ai.label).toBe('Yap'); expect(NODE_SPECS.ai.outputs).toEqual([{ key: 'next', label: 'tamamlandı' }])
  })
  it('completes only after observation and never replays legacy recordings', async () => {
    const h = harness([call('task_complete', { summary: 'done' }), call('screen_read'), call('task_complete', { summary: 'done' })])
    await expect(runYap({ ...createNode('ai',0,0), prompt: 'current file.glb', trace: ['delete'], path: [{ action: 'hotkey', keys: ['delete'] }] }, { vars: { öğe: 'file.glb' } }, h.deps)).resolves.toBe(true)
    expect(h.executed).toEqual(['screen.read']); expect(h.transcripts[0]).not.toContain('delete'); expect(h.transcripts[0]).not.toContain('previousRecoveryReports')
  })
  it('requires a new screenshot after input, reports tool errors and forbids injected tools', async () => {
    const h = harness([call('screen_read'), call('act_key', { keys: 'enter' }), call('task_complete', { summary: 'done' }), call('step_run', { nodeId: 'other' }), call('screen_read'), call('task_complete', { summary: 'done' })])
    await runYap({ ...createNode('ai',0,0), prompt: 'do' }, {}, h.deps)
    expect(h.executed).toEqual(['screen.read','screen.read','act.key','screen.read'])
    expect(h.transcripts.some(text => text.includes('Bu araç Yap ajanına açık değil'))).toBe(true)
  })
  it('stops on user cancellation and fails at budget instead of pretending success', async () => {
    const budget = harness([call('act_key', { keys: 'enter' }), call('act_key', { keys: 'escape' })])
    await expect(runYap({ ...createNode('ai',0,0), maxActions: 1 }, {}, budget.deps)).rejects.toThrow('sınırında')
    expect(budget.executed).toEqual(['screen.read','act.key'])
    const stop = harness([call('screen_read')])
    await expect(runYap(createNode('ai',0,0), {}, { ...stop.deps, shouldStop: () => true })).rejects.toBeInstanceOf(StoppedError)
    expect(stop.executed).toEqual([])
  })
  it('does not interpret malformed parameters as desktop actions', async () => {
    const h = harness([call('act_key', { keys: 5 }), call('screen_read'), call('task_complete', { summary: 'done' })])
    await runYap(createNode('ai',0,0), {}, h.deps)
    expect(h.executed).toEqual(['screen.read','screen.read'])
  })
})

describe('Windows tools', () => {
  it('encodes window titles as data and rejects invalid placement before execution', () => {
    const title = "Chrome'; Remove-Item C:\\*"
    const script = windowScript({ action: 'maximize', windowTitle: title }, 123)
    expect(script).not.toContain(title); expect(script).toContain(Buffer.from(title).toString('base64'))
    expect(script).toContain('Count -ne 1'); expect(script).toContain('targetPid -eq 123')
    expect(script).toContain('ShowWindow($h,3)')
    expect(() => windowScript({ action: 'move', x: 'bad', y: 1 }, 123)).toThrow('Geçersiz')
    expect(windowsTools(false).some(t => t.function.name === 'powershell_run')).toBe(false)
  })
})
