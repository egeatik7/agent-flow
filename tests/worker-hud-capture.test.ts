import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkObservation, observeWithin } from '../electron/observation-budget'

const source = readFileSync(new URL('../electron/a11y-bridge.ts', import.meta.url), 'utf8')
const body = source.slice(source.indexOf('class Worker {'), source.indexOf('\nconst worker = new Worker()'))
const code = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
class Proc extends EventEmitter {
  stdout = Object.assign(new EventEmitter(), { setEncoding() {} })
  stderr = Object.assign(new EventEmitter(), { setEncoding() {} })
  requests: { id: string; op: string; payload: Record<string, unknown> }[] = []
  stdin = Object.assign(new EventEmitter(), { write: (line: string) => {
    const [id, op, b64] = line.trim().split('\t')
    this.requests.push({ id, op, payload: JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) })
    return true
  } })
  kill = vi.fn(() => { this.emit('exit'); return true })
  say(line: string) { this.stdout.emit('data', line + '\n') }
  answer(id: string, ok = true) { this.say(id + '\t' + Buffer.from(JSON.stringify({ ok, data: true, error: 'capture failed' })).toString('base64')) }
}
function fixture() {
  vi.useFakeTimers()
  const procs: Proc[] = [], release = vi.fn(), begin = vi.fn(() => release), inputLog = vi.fn()
  let handle = '10'
  const Worker = new Function('observeWithin', 'checkObservation', 'spawn', 'fs', 'path', 'scriptDir', 'psArgs', 'friendly', 'captureHud', 'hudHandle', 'inputLogger',
    code + '\nreturn Worker')(observeWithin, checkObservation, () => { const p = new Proc(); procs.push(p); return p }, { existsSync: () => true }, { join: () => '/fake' }, () => '', () => [], (s: string) => s, begin, () => handle, inputLog)
  const worker = new Worker()
  return { worker, procs, begin, release, inputLog, handle: (v: string) => { handle = v } }
}
const flush = async () => { for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0) }
afterEach(() => vi.useRealTimers())
describe('actual worker capture protocol', () => {
  it('takes the visibility lease at dispatch and restores immediately after frame capture, before slow OCR ends', async () => {
    const h = fixture(), result = h.worker.call('scan', { hudCapture: true }, 1000)
    await flush(); h.procs[0].say('READY'); await flush()
    expect(h.begin).toHaveBeenCalledTimes(1)
    const request = h.procs[0].requests[0]
    expect(request.payload.hudCaptureManaged).toBe(true)
    expect(request.payload.hudHwnd).toBe('10')
    h.procs[0].say('HUD_CAPTURED\t' + request.id)
    expect(h.release).toHaveBeenCalledTimes(1)
    expect(h.worker.pending.size).toBe(1)
    h.procs[0].answer(request.id); await result
    expect(h.release).toHaveBeenCalledTimes(1)
  })
  it('queued capture neither hides the card early nor uses the HWND saved while queued', async () => {
    const h = fixture(), first = h.worker.call('keys', {}, 1000)
    await flush(); h.procs[0].say('READY'); await flush()
    const second = h.worker.call('scan', { hudCapture: true }, 1000)
    await flush(); expect(h.begin).not.toHaveBeenCalled()
    h.handle('20'); h.procs[0].answer(h.procs[0].requests[0].id); await first; await flush()
    expect(h.procs[0].requests[1].payload.hudHwnd).toBe('20')
    h.procs[0].answer(h.procs[0].requests[1].id); await second
    expect(h.release).toHaveBeenCalledTimes(1)
  })
  it.each(['error', 'timeout', 'exit'] as const)('releases the lease on %s even when no capture notification arrives', async kind => {
    const h = fixture(), result = h.worker.call('scan', { hudCapture: true }, 1000)
    const rejected = expect(result).rejects.toThrow()
    await flush(); h.procs[0].say('READY'); await flush()
    if (kind === 'error') h.procs[0].answer(h.procs[0].requests[0].id, false)
    if (kind === 'timeout') await vi.advanceTimersByTimeAsync(1001)
    if (kind === 'exit') h.procs[0].kill()
    await rejected
    expect(h.release).toHaveBeenCalledTimes(1)
  })
  it('unmatched capture and keyboard telemetry cannot release or log another request', async () => {
    const h = fixture(), result = h.worker.call('scan', { hudCapture: true }, 1000)
    await flush(); h.procs[0].say('READY'); await flush()
    h.procs[0].say('HUD_CAPTURED\t999')
    h.procs[0].say('INPUT_STATE\t' + Buffer.from(JSON.stringify({ id: '999' })).toString('base64'))
    expect(h.release).not.toHaveBeenCalled(); expect(h.inputLog).not.toHaveBeenCalled()
    h.procs[0].answer(h.procs[0].requests[0].id); await result
  })
  it('a card restore exception does not turn a valid frame into an automation failure', async () => {
    const h = fixture(); h.release.mockImplementation(() => { throw new Error('window closed') })
    const result = h.worker.call('scan', { hudCapture: true }, 1000)
    await flush(); h.procs[0].say('READY'); await flush()
    const id = h.procs[0].requests[0].id
    expect(() => h.procs[0].say('HUD_CAPTURED\t' + id)).not.toThrow()
    h.procs[0].answer(id); await expect(result).resolves.toBe(true)
    expect(h.release).toHaveBeenCalledTimes(1)
  })
  it('a keyboard diagnostic logger failure cannot break a dispatched command', async () => {
    const h = fixture(); h.inputLog.mockImplementation(() => { throw new Error('log unavailable') })
    const result = h.worker.call('keys', {}, 1000)
    await flush(); h.procs[0].say('READY'); await flush()
    const id = h.procs[0].requests[0].id
    expect(() => h.procs[0].say('INPUT_STATE\t' + Buffer.from(JSON.stringify({ id })).toString('base64'))).not.toThrow()
    h.procs[0].answer(id); await expect(result).resolves.toBe(true)
  })
})
