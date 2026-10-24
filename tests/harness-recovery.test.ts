import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { runRecovery } from '../electron/recovery'
import { testHarnessConnection } from '../electron/harness-recovery'
import { harnessSettings, recoverySettings, DEFAULT_RECOVERY } from '../electron/recovery-settings'
import { createNode } from '../electron/graph-types'
import type { RecoveryReport } from '../electron/recovery'
import { StoppedError } from '../electron/runner'

const command = path.resolve('tests/fixtures/harness-acp.cjs')
const target = { ...createNode('click', 0, 0), id: 'target', prompt: 'target' }
const helper = { ...createNode('key', 0, 0), id: 'helper', keys: 'enter' }
const request = { graph: { nodes: [target, helper], edges: [] }, node: target, live: target, vars: { oge: 'saved.glb' }, error: new Error('missing'), stepNo: 7, ahead: {} }
function setup(scenario = 'complete', fullControl = true) {
  const reports: RecoveryReport[] = []
  const turn = vi.fn(() => { throw new Error('BUILT-IN RECOVERY MUST NEVER RUN') })
  const execute = vi.fn(async (name: string) => name === 'screen.read'
    ? { ok: true, outcome: 'tamam', message: 'Fresh frame', data: { matched: true, image: { mime: 'image/png', data: 'Zml4dHVyZQ==' } } }
    : { ok: true, outcome: 'tamam', message: 'Action sent', data: { sent: true } })
  const settings = recoverySettings({ ...DEFAULT_RECOVERY, enabled: true, provider: 'harness', harness: harnessSettings({ command, args: [`--scenario=${scenario}`], fullControl }), allowedNodeIds: ['helper'] })
  return { reports, turn, execute, deps: { settings, shouldStop: () => false, log: vi.fn(), turn, makeExecute: () => execute, recentLog: ['fixture'], saveReport: (r: RecoveryReport) => { reports.push(structuredClone(r)) } } }
}
describe('exclusive Harness recovery via actual ACP process and HTTP MCP', () => {
  it('runs a helper node, observes, stores detailed report, and never calls built-in recovery or a late input', async () => {
    const h = setup(); const result = await runRecovery(request, h.deps)
    expect(result.decision).toBe('completed'); expect(h.turn).not.toHaveBeenCalled()
    expect(h.execute.mock.calls.map(c => c[0])).toEqual(['step.run', 'screen.read'])
    expect(result.report).toMatchObject({ provider: 'harness', harnessSessionId: 'fixture-recovery-session', result: 'completed' })
    expect(result.report!.details).toContain('Zaman çizelgesi')
  })
  it.each(['noframe', 'sent-retry'])('refuses unsafe terminal decision (%s)', async scenario => {
    const h = setup(scenario)
    const result = await runRecovery({ ...request, ...(scenario === 'sent-retry' ? { inputMayHaveBeenSent: true } : {}) }, h.deps)
    expect(result.decision).toBe('stop'); expect(h.turn).not.toHaveBeenCalled()
  })
  it('continues another model turn in the same session without the legacy maxCalls/timeout', async () => {
    const h = setup('continue'); h.deps.settings.maxCalls = 1; h.deps.settings.timeoutMs = 10
    const result = await runRecovery(request, h.deps)
    expect(result.decision).toBe('completed'); expect(result.report!.summary).toContain('turn 2'); expect(h.turn).not.toHaveBeenCalled()
  })
  it.each(['unsupported', 'nostatus', 'drop'])('stops closed on %s without another recovery agent', async scenario => {
    const h = setup(scenario); const result = await runRecovery(request, h.deps)
    expect(result.decision).toBe('failed'); expect(h.turn).not.toHaveBeenCalled()
    if (scenario === 'drop') expect(h.execute).toHaveBeenCalledTimes(1)
  })
  it('fails if selected program cannot launch and saves an explicit report', async () => {
    const h = setup(); h.deps.settings.harness!.command = '/missing/deepseek.exe'
    const result = await runRecovery(request, h.deps)
    expect(result.decision).toBe('failed'); expect(h.turn).not.toHaveBeenCalled(); expect(h.reports.at(-1)!.summary).toContain('Diğer kurtarma ajanı çağrılmadı')
  })
  it('node failure is a tool result within the same external agent', async () => {
    const h = setup('nodeerror'); h.execute.mockRejectedValueOnce(new Error('node failed'))
    const result = await runRecovery(request, h.deps)
    expect(result.decision).toBe('completed'); expect(result.report!.actions[0].outcome).toBe('hata'); expect(h.turn).not.toHaveBeenCalled()
  })
  it('Stop cancels a prompt with no automatic timeout and saves partial evidence', async () => {
    const h = setup('hang'); let stop = false
    const timer = setTimeout(() => { stop = true }, 250)
    try { await expect(runRecovery(request, { ...h.deps, shouldStop: () => stop })).rejects.toBeInstanceOf(StoppedError) }
    finally { clearTimeout(timer) }
    expect(h.reports.at(-1)!.result).toBe('stopped'); expect(h.turn).not.toHaveBeenCalled()
  })
  it('honors explicit finite external deadline', async () => {
    const h = setup('hang'); h.deps.settings.harness!.timeoutMs = 200
    expect((await runRecovery(request, h.deps)).decision).toBe('failed'); expect(h.reports.at(-1)!.summary).toContain('süresi doldu')
  })
  it('auto-answers Harness permission requests only for the selected full-control session', async () => {
    const h = setup('permission'); expect((await runRecovery(request, h.deps)).decision).toBe('completed')
  })
  it('connection test registers MCP without model prompt or desktop operations', async () => {
    expect((await testHarnessConnection(harnessSettings({ command, args: ['--scenario=complete'] }))).ok).toBe(true)
  })
  it('migrates old recovery settings to built-in and keeps explicit continuous external settings', () => {
    expect(recoverySettings(DEFAULT_RECOVERY).provider).toBe('nubbo')
    expect(harnessSettings().timeoutMs).toBe(0)
    expect(harnessSettings().fullControl).toBe(true)
  })
})
it('does not grant completion when saving its detailed report fails', async () => {
  const h = setup()
  const saveReport = (r: RecoveryReport) => { if (r.result === 'completed') throw new Error('disk full'); h.reports.push(structuredClone(r)) }
  const result = await runRecovery(request, { ...h.deps, saveReport })
  expect(result.decision).toBe('stop'); expect(h.turn).not.toHaveBeenCalled()
})
it('never accepts a mismatched window as current completion evidence', async () => {
  const h = setup()
  h.execute.mockImplementation(async () => ({ ok: true, outcome: 'tamam', message: 'wrong window', data: { matched: false, image: { mime: 'image/png', data: 'Zml4dHVyZQ==' } } }))
  expect((await runRecovery(request, h.deps)).decision).toBe('stop')
})

it('invalidates old evidence when a fresh screen read fails', async () => {
  const h = setup('failed-refresh')
  let frames = 0
  const original = h.execute.getMockImplementation()!
  h.execute.mockImplementation(async (name: string) => {
    if (name === 'screen.read' && ++frames === 2) throw new Error('capture failed')
    return original(name)
  })
  expect((await runRecovery(request, h.deps)).decision).toBe('stop')
})
it('does not reuse screen evidence after a later desktop action', async () => {
  const h = setup('stale-frame')
  expect((await runRecovery(request, h.deps)).decision).toBe('stop')
})
it('full-control off never automatically grants a Harness permission request', async () => {
  const h = setup('permission', false)
  expect((await runRecovery(request, h.deps)).decision).toBe('failed')
  expect(h.turn).not.toHaveBeenCalled()
})

it('waits a deferred external tool job without replaying it, then receives screen evidence', async () => {
  const h = setup()
  const original = h.execute.getMockImplementation()!
  h.execute.mockImplementation(async (name: string) => {
    if (name === 'step.run') await new Promise(resolve => setTimeout(resolve, 1750))
    return original(name)
  })
  const result = await runRecovery(request, h.deps)
  expect(result.decision).toBe('completed')
  expect(h.execute.mock.calls.map(c => c[0])).toEqual(['step.run', 'screen.read'])
}, 10000)

it('permits retry after the original node only moved the mouse and sent no input', async () => {
  const h = setup('move-only')
  const original = h.execute.getMockImplementation()!
  h.execute.mockImplementation(async (name: string) => name === 'step.run'
    ? { ok: true, outcome: 'tamam', message: 'move only', data: { sent: false } }
    : original(name))
  expect((await runRecovery(request, h.deps)).decision).toBe('retry')
})

it('returns after a durable terminal result even if the Harness prompt never settles', async () => {
  const h = setup('finished-hang'); h.deps.settings.harness!.timeoutMs = 1500
  expect((await runRecovery(request, h.deps)).decision).toBe('completed')
  expect(h.turn).not.toHaveBeenCalled()
})
it('allows an explicit whole-desktop read when the failed node window disappeared', async () => {
  const h = setup('all-screen')
  const node = { ...target, locator: { windowTitle: 'Closed Blender window', name: '', controlType: '', path: '' } }
  expect((await runRecovery({ ...request, node, live: node }, h.deps)).decision).toBe('completed')
  expect(h.execute).toHaveBeenCalledWith('screen.read', { windowTitle: '' })
})
it('records executor-admission failure and stops without falling back', async () => {
  const h = setup()
  const result = await runRecovery(request, { ...h.deps, makeExecute: () => { throw new Error('executor unavailable') } })
  expect(result.decision).toBe('failed')
  expect(h.reports.at(-1)!.summary).toContain('executor unavailable')
  expect(h.turn).not.toHaveBeenCalled()
})
it.skipIf(process.platform === 'win32')('kills the owned process group even after the Harness leader crashes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-harness-orphan-'))
  const file = path.join(dir, 'late-input.txt')
  const h = setup('orphan'); h.deps.settings.harness!.args.push('--orphan-file=' + file)
  try {
    expect((await runRecovery(request, h.deps)).decision).toBe('failed')
    expect(fs.existsSync(file + '.spawned')).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 1000))
    expect(fs.existsSync(file)).toBe(false)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

it('rejects an exit-code-zero GUI-like startup as failed and records launch mode/stage without secrets', async () => {
  const h = setup('exit-zero')
  const result = await runRecovery(request, h.deps)
  expect(result.decision).toBe('failed')
  expect(result.report!.summary).toContain('initialize')
  expect(result.report!.summary).toContain('ACP görevi tamamlanmadı')
  expect(result.report!.summary).not.toContain('fixture-secret')
  expect(result.report!.harnessLaunch).toMatchObject({ selectedCommand: command, mode: 'script' })
  expect(h.execute).not.toHaveBeenCalled(); expect(h.turn).not.toHaveBeenCalled()
})
it('does not report a successful connection when the server never discovers Nubbo tools', async () => {
  const config = harnessSettings({ command, args: ['--scenario=no-discovery'] })
  const result = await testHarnessConnection(config)
  expect(result.ok).toBe(false); expect(result.message).toContain('araç listesini keşfetmedi')
  const h = setup('no-discovery')
  expect((await runRecovery(request, h.deps)).decision).toBe('failed')
  expect(h.turn).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled()
})
it('tests and performs recovery using the same automatic writable workspace', async () => {
  const h = setup()
  const connection = await testHarnessConnection(h.deps.settings.harness!)
  expect(connection.ok).toBe(true)
  const result = await runRecovery(request, h.deps)
  expect(result.decision).toBe('completed')
  expect(connection.message).toContain(result.report!.harnessLaunch!.cwd)
  expect(result.report!.harnessLaunch!.cwd).not.toBe(path.dirname(command))
})
