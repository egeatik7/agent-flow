import { describe, expect, it } from 'vitest'
import { renameRetrying } from '../electron/zip-library-storage'

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException
  error.code = code
  return error
}

/** Fails with the given codes in order, then succeeds. Records every call and pause. */
function scripted(codes: string[], platform = 'win32') {
  const calls: Array<[string, string]> = []
  const pauses: number[] = []
  let next = 0
  return {
    calls,
    pauses,
    deps: {
      platform,
      rename: (a: string, b: string) => {
        calls.push([a, b])
        if (next < codes.length) throw errno(codes[next++])
      },
      pause: (ms: number) => { pauses.push(ms) },
    },
  }
}

describe('renameRetrying', () => {
  it('retries Windows lock errors and succeeds once the lock is released', () => {
    const s = scripted(['EPERM', 'EBUSY'])
    renameRetrying('tmp', 'final.zip', s.deps)
    expect(s.calls).toHaveLength(3)
    expect(s.calls.every(([a, b]) => a === 'tmp' && b === 'final.zip')).toBe(true)
    expect(s.pauses).toEqual([30, 60])
  })

  it('gives up after the last attempt and reports the real error', () => {
    const s = scripted(Array(30).fill('EPERM'))
    expect(() => renameRetrying('tmp', 'final.zip', s.deps)).toThrow('EPERM')
    expect(s.calls).toHaveLength(12)
    // Growing pauses, capped at 400 ms: 30, 60, 120, 240, 400, 400, ... (11 pauses for 12 attempts).
    expect(s.pauses).toEqual([30, 60, 120, 240, 400, 400, 400, 400, 400, 400, 400])
    expect(s.pauses.reduce((a, b) => a + b, 0)).toBe(3250)
  })

  it('does not retry on other platforms, even for lock codes', () => {
    const s = scripted(['EPERM'], 'linux')
    expect(() => renameRetrying('tmp', 'final.zip', s.deps)).toThrow('EPERM')
    expect(s.calls).toHaveLength(1)
    expect(s.pauses).toEqual([])
  })

  it('does not retry errors that are not lock errors', () => {
    const s = scripted(['ENOENT'])
    expect(() => renameRetrying('tmp', 'final.zip', s.deps)).toThrow('ENOENT')
    expect(s.calls).toHaveLength(1)
    expect(s.pauses).toEqual([])
  })
})
