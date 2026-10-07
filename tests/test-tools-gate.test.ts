import { describe, it, expect } from 'vitest'
import { testToolsEnabled } from '../electron/profile'

describe('test-only developer tools', () => {
  it('never enables the ordinary user profile even with the launch flag', () => {
    for (const profile of [undefined, '', '   ']) expect(testToolsEnabled(profile, '1')).toBe(false)
  })
  it('requires the explicit flag even in an isolated test profile', () => {
    for (const flag of [undefined, '', 'true', '0']) expect(testToolsEnabled('test', flag)).toBe(false)
  })
  it('enables only an explicitly requested isolated test session', () => {
    expect(testToolsEnabled('test', '1')).toBe(true)
  })
})
