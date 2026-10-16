import { describe, expect, it, vi } from 'vitest'
import { createNode, type AgentGraph, type AgentNode } from '../electron/graph-types'
import { runGraph, ConditionUndecidedError, ConditionHaltError, type Executor, type RecoveryRequest, type RecoveryDecision } from '../electron/runner'
import { runRecovery, type RecoveryReport } from '../electron/recovery'
import { DEFAULT_RECOVERY } from '../electron/recovery-settings'
import type { ToolMessage } from '../electron/openrouter'

let edgeNo = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `e${++edgeNo}`, from: from.id, fromPort, to: to.id })

/** start → Koşul “Blender” → (evet) click “EVET” ; (hayır) click “HAYIR” if connected. */
function graph(opts: { hayirBagli: boolean }) {
  const start = createNode('start', 0, 0)
  const cond = createNode('condition', 100, 0)
  cond.text = 'Blender yazıyor'
  const yes = createNode('click', 200, 0)
  yes.prompt = 'EVET'
  const no = createNode('click', 200, 100)
  no.prompt = 'HAYIR'
  const edges = [edge(start, 'next', cond), edge(cond, 'true', yes)]
  if (opts.hayirBagli) edges.push(edge(cond, 'false', no))
  const g: AgentGraph = { nodes: [start, cond, yes, no], edges }
  return { g, cond, yes, no }
}

/** Fake executor. `exists` answers the condition; `recover` is optional (absent = recovery off). */
function executor(answer: boolean | 'undecided', recover?: (req: RecoveryRequest) => Promise<RecoveryDecision>) {
  const clicked: string[] = []
  const recovered: RecoveryRequest[] = []
  const finished: Array<[string, boolean, string | undefined]> = []
  const ex: Executor = {
    log: () => {}, step: () => {}, shouldStop: () => false,
    click: async (node) => { clicked.push(node.prompt ?? '') },
    type: async () => {}, key: async () => {},
    exists: async () => {
      if (answer === 'undecided') throw new ConditionUndecidedError('hiçbir okuyucu karar veremedi')
      return answer
    },
    recoveryFinished: (id, ok, error) => { finished.push([id, ok, error]) },
  }
  if (recover) ex.recover = async (req) => { recovered.push(req); return recover(req) }
  return { ex, clicked, recovered, finished }
}

const run = (g: AgentGraph, ex: Executor) => runGraph(g, ex, { maxSteps: 20, stepDelayMs: 0 })

describe('condition routing', () => {
  it('evet: continues on the true branch and never asks recovery', async () => {
    const { g } = graph({ hayirBagli: false })
    const { ex, clicked, recovered } = executor(true)
    await run(g, ex)
    expect(clicked).toEqual(['EVET'])
    expect(recovered).toHaveLength(0)
  })

  it('hayır with a connected false output goes to that node; recovery is not asked', async () => {
    const { g } = graph({ hayirBagli: true })
    const { ex, clicked, recovered } = executor(false)
    await run(g, ex)
    expect(clicked).toEqual(['HAYIR'])
    expect(recovered).toHaveLength(0)
  })

  it('undecided with a connected false output is routed to the false branch like hayır', async () => {
    const { g } = graph({ hayirBagli: true })
    const { ex, clicked, recovered } = executor('undecided')
    await run(g, ex)
    expect(clicked).toEqual(['HAYIR'])
    expect(recovered).toHaveLength(0)
  })

  it('hayır, unconnected, recovery off: the run stops with the halt error (no silent completion)', async () => {
    const { g } = graph({ hayirBagli: false })
    const { ex, clicked } = executor(false)
    await expect(run(g, ex)).rejects.toBeInstanceOf(ConditionHaltError)
    await expect(run(g, ex)).rejects.toThrow('kurtarma ajanı kapalı')
    expect(clicked).toEqual([])
  })

  it('hayır, unconnected, recovery says var: the flow continues on the true branch', async () => {
    const { g } = graph({ hayirBagli: false })
    const { ex, clicked, recovered, finished } = executor(false, async () => 'var')
    await run(g, ex)
    expect(recovered).toHaveLength(1)
    expect(recovered[0].node.kind).toBe('condition')
    expect(recovered[0].error).toBeInstanceOf(Error)
    expect(clicked).toEqual(['EVET'])
    expect(finished).toEqual([[recovered[0].node.id, true, undefined]])
  })

  it('hayır, unconnected, recovery says yok: the run stops; the true branch never runs', async () => {
    const { g } = graph({ hayirBagli: false })
    const { ex, clicked, finished } = executor(false, async () => 'yok')
    await expect(run(g, ex)).rejects.toBeInstanceOf(ConditionHaltError)
    expect(clicked).toEqual([])
    expect(finished[0][1]).toBe(false)
  })

  it('undecided, unconnected, recovery says var: continues like a confirmed evet', async () => {
    const { g } = graph({ hayirBagli: false })
    const { ex, clicked, recovered } = executor('undecided', async () => 'var')
    await run(g, ex)
    expect(recovered).toHaveLength(1)
    expect(clicked).toEqual(['EVET'])
  })

  it('recovery that cannot decide (stop) is not treated as yok silently: the run stops', async () => {
    const { g } = graph({ hayirBagli: false })
    const { ex, clicked } = executor(false, async () => 'stop')
    await expect(run(g, ex)).rejects.toBeInstanceOf(ConditionHaltError)
    expect(clicked).toEqual([])
  })
})

describe('recovery in condition mode', () => {
  const cond = { ...createNode('condition', 0, 0), id: 'cond', text: 'Blender yazıyor' }
  const request: RecoveryRequest = { graph: { nodes: [cond], edges: [] }, node: cond, live: cond, error: new ConditionUndecidedError('karar yok'), stepNo: 2, ahead: {}, vars: {} }
  const call = (name: string, args: Record<string, unknown> = {}): ToolMessage => ({ role: 'assistant', content: null, tool_calls: [{ id: `c-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })

  function harness(answers: ToolMessage[]) {
    const execute = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ ok: true, outcome: 'tamam', message: 'Ekran okundu.' }))
    const reports: RecoveryReport[] = []
    const turns: ToolMessage[][] = []
    const deps = { settings: { ...DEFAULT_RECOVERY, enabled: true, model: 'fixture/model' }, shouldStop: () => false, log: vi.fn(),
      makeExecute: () => execute, recentLog: [], previousReports: [], saveReport: (r: RecoveryReport) => reports.push(structuredClone(r)),
      turn: vi.fn(async ({ messages }: { messages: ToolMessage[] }) => { turns.push(structuredClone(messages)); return answers.shift() ?? call('recovery_stop', { probableCause: 'x', evidence: 'x', summary: 'x' }) }) }
    return { execute, deps, reports, turns }
  }

  it('answers var only after reading the screen, and never clicks', async () => {
    const h = harness([
      call('recovery_condition', { answer: 'var', evidence: 'Ekranda Blender penceresi', summary: 'Blender açık' }),
      call('screen_read'),
      call('recovery_condition', { answer: 'var', evidence: 'Ekranda Blender penceresi', summary: 'Blender açık' }),
    ])
    const result = await runRecovery(request, h.deps)
    expect(result.decision).toBe('var')
    expect(result.report?.result).toBe('completed')
    expect(result.report?.completionBasis).toBe('model-observed')
    expect(h.execute.mock.calls.map(([name]) => name)).toEqual(['screen.read'])
    // The first premature answer was refused and told to the model, not accepted.
    const refused = JSON.stringify(h.turns[1])
    expect(refused).toContain('screen_read ile güncel ekranı gör')
  })

  it('answers yok when the screen does not show the condition', async () => {
    const h = harness([call('screen_read'), call('recovery_condition', { answer: 'yok', evidence: 'Blender yok', summary: 'Blender görünmüyor' })])
    const result = await runRecovery(request, h.deps)
    expect(result.decision).toBe('yok')
    expect(result.report?.result).toBe('failed')
  })

  it('cannot click or type: action tools are not offered and a call to them is refused', async () => {
    const h = harness([call('act_click', { target: 'Blender' }), call('screen_read'), call('recovery_condition', { answer: 'yok', evidence: 'e', summary: 's' })])
    const result = await runRecovery(request, h.deps)
    expect(h.execute.mock.calls.map(([name]) => name)).toEqual(['screen.read'])
    expect(result.decision).toBe('yok')
    expect(JSON.stringify(h.turns[1])).toContain('Bu araç için yetki yok')
  })
})
