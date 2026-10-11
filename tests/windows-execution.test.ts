import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
const spawned = vi.hoisted(() => ({ calls: [] as any[], child: undefined as any }))
vi.mock('child_process', () => ({ spawn: (...args: any[]) => { spawned.calls.push(args); return spawned.child } }))
import { runPowerShell } from '../electron/windows-tools'
import { StoppedError } from '../electron/runner'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); spawned.calls.length = 0 })
function child() {
  const p = Object.assign(new EventEmitter(), { pid: 42, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
  spawned.child = p; return p
}
function win() { vi.spyOn(process, 'platform', 'get').mockReturnValue('win32') }

describe('PowerShell execution boundary', () => {
  it('passes code by UTF16 base64, retains cwd, and returns failure instead of success', async () => {
    win(); const p = child()
    const pending = runPowerShell("Write-Output 'Türkçe $x'; exit 7", 'C:\\Work', () => false)
    const [exe,args,opts] = spawned.calls[0]
    expect(exe).toBe('powershell.exe'); expect(args).toContain('-NoProfile'); expect(args).toContain('-NonInteractive')
    expect(Buffer.from(args.at(-1), 'base64').toString('utf16le')).toContain("Write-Output 'Türkçe $x'; exit 7")
    expect(opts.cwd).toBe('C:\\Work'); expect(opts.shell).toBeUndefined()
    p.stderr.write('failure'); p.emit('close',7)
    await expect(pending).resolves.toMatchObject({ ok: false, data: { exitCode: 7, stderr: 'failure' } })
  })
  it('cancels the process tree when the user stops', async () => {
    win(); vi.useFakeTimers(); child(); let stop = false
    const pending = runPowerShell('Start-Sleep 100', undefined, () => stop)
    const checked = expect(pending).rejects.toBeInstanceOf(StoppedError)
    stop = true; await vi.advanceTimersByTimeAsync(100); await checked
    expect(spawned.calls[1].slice(0,2)).toEqual(['taskkill.exe', ['/PID','42','/T','/F']])
  })
  it('bounds output and uses a fresh process on each call', async () => {
    win(); const p = child(); const pending = runPowerShell('echo ok', undefined, () => false)
    p.stdout.write('x'.repeat(60000));p.emit('close',0)
    const result = await pending; expect((result.data?.stdout as string).length).toBe(24000)
    const p2 = child(); const second = runPowerShell('echo second',undefined,()=>false);p2.emit('close',0);await second
    expect(spawned.calls).toHaveLength(2)
  })
})
