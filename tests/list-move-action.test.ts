import { describe, it, expect } from 'vitest'
import { parseAgentAction } from '../electron/openrouter'

describe('numbered list action decoding', () => {
  it('decodes move with an observed item id instead of silently waiting', () => {
    expect(parseAgentAction('{"action":"move","id":7}')).toMatchObject({action:'move',id:7})
  })
  it('preserves existing click actions and unknown-action fallback', () => {
    expect(parseAgentAction('{"action":"click","id":7}').action).toBe('click')
    expect(parseAgentAction('{"action":"unknown","id":7}').action).toBe('wait')
  })
  it('does not introduce coordinate-only or click_current commands in the list interface', () => {
    expect(parseAgentAction('{"action":"move","x":100,"y":200}').id).toBeNull()
    expect(parseAgentAction('{"action":"click_current"}').action).toBe('wait')
  })
})
