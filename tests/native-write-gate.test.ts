import { expect, it } from 'vitest'
import { nativeWriteStarted } from '../electron/a11y-bridge'

it('a queued Stop stays not_sent and a real write becomes uncertain', () => {
  const stopped = new AbortController()
  stopped.abort()
  let marked = false
  expect(nativeWriteStarted(stopped.signal, () => { marked = true })).toBe(false)
  expect(marked).toBe(false)
  expect(nativeWriteStarted(undefined, () => { marked = true })).toBe(true)
  expect(marked).toBe(true)
})
