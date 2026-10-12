import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkObservation, observeWithin, ObservationTimeoutError } from '../electron/observation-budget'
// Exercise the actual Worker class on Linux too, replacing only process creation/I/O.
const source = readFileSync(new URL('../electron/a11y-bridge.ts', import.meta.url), 'utf8')
const body = source.slice(source.indexOf('class Worker {'), source.indexOf('\nconst worker = new Worker()'))
const code = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const Worker = new Function('observeWithin', 'checkObservation', code + '\nreturn Worker')(observeWithin, checkObservation)
afterEach(() => vi.useRealTimers())
describe('Windows worker observation cancellation', () => {
  it('a cancelled queued observation never sends and does not let a successor bypass the active request', async () => {
    const worker = new Worker(); let finish!: (value: string) => void
    const sent: string[] = []
    worker.send = async (op: string) => { sent.push(op); return op === 'active' ? new Promise<string>(r => { finish = r }) : 'ok' }
    const active = worker.call('active'); await Promise.resolve(); await Promise.resolve()
    const controller = new AbortController()
    const cancelled = worker.call('cancelled', {}, 1000, controller.signal)
    const assertion = expect(cancelled).rejects.toBeInstanceOf(ObservationTimeoutError)
    const successor = worker.call('successor')
    controller.abort(new ObservationTimeoutError()); await assertion
    expect(sent).toEqual(['active'])
    finish('ok'); await active; await successor
    expect(sent).toEqual(['active', 'successor'])
  })
  it('cancels its own worker startup before any read request is sent', async () => {
    const worker = new Worker(), proc = { stdin: { write: vi.fn() }, kill: vi.fn() }
    worker.start = () => { worker.proc = proc; return new Promise<void>(() => {}) }
    const controller = new AbortController()
    const pending = worker.call('scan', {}, 180000, controller.signal)
    const assertion = expect(pending).rejects.toBeInstanceOf(ObservationTimeoutError)
    await vi.waitFor(() => expect(worker.proc).toBe(proc))
    controller.abort(new ObservationTimeoutError()); await assertion
    expect(proc.stdin.write).not.toHaveBeenCalled(); expect(proc.kill).toHaveBeenCalledTimes(1)
    expect(worker.proc).toBe(null)
  })
  it('cancelling an in-flight observation removes its pending call and kills that worker', async () => {
    vi.useFakeTimers()
    const worker = new Worker(), proc = { stdin: { write: vi.fn() }, kill: vi.fn() }
    worker.proc = proc; worker.ready = Promise.resolve()
    const controller = new AbortController()
    const pending = worker.call('scan', {}, 180000, controller.signal)
    const assertion = expect(pending).rejects.toBeInstanceOf(ObservationTimeoutError)
    await vi.advanceTimersByTimeAsync(0)
    expect(proc.stdin.write).toHaveBeenCalledTimes(1)
    controller.abort(new ObservationTimeoutError()); await assertion
    expect(proc.kill).toHaveBeenCalledTimes(1)
    expect(worker.pending.size).toBe(0); expect(worker.proc).toBe(null)
    expect(vi.getTimerCount()).toBe(0)
  })
})
