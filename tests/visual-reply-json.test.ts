import { describe, expect, it } from 'vitest'
import { visualReplyJson } from '../electron/visual-reply-json'
import { validateVisualTargetReply, validateVisualPointerReply, ModelRejected } from '../electron/openrouter'

const image = { data: 'fixture', w: 1400, h: 788 }
describe('recorded visual reply corruption', () => {
  it('keeps legitimate numeric points and a complete JSON fence', () => {
    expect(validateVisualTargetReply('```json\n{"intent":"target","x":66,"y":137}\n```', 'vision', image, false)).toMatchObject({ x: .066, y: .137 })
    expect(validateVisualPointerReply('{"decision":"adjust","x":193,"y":546}', 'vision', image)).toMatchObject({ x: .193, y: .546 })
  })
  it.each([
    '{"intent":"target","x":66,":[20, 137] }":"target","x":66,"y":137}',
    '{"intent":"target","x":172,"syncpoint":487}',
    '{"intent":"target","x":172,"sync":487,"y":487}',
    '{"intent":"target","x":193,"x":172,"y":546}',
    '{"intent":"target","x":193,"\\u0078":172,"y":546}',
    '{"intent":"target","intent":"missing","x":193,"y":546}',
    'prefix {"intent":"target","x":193,"y":546} suffix',
    '{"intent":"target","x":193,"y":546} {"intent":"target","x":172,"y":487}',
    '{"intent":"target","x":193,"y":546,"reason":5}',
  ])('does not derive a clickable point from ambiguous raw reply %s', raw => {
    expect(() => validateVisualTargetReply(raw, 'vision', image, false)).toThrow(ModelRejected)
  })
  it('does not accept an overwritten pointer decision', () => {
    expect(() => validateVisualPointerReply('{"decision":"uncertain","decision":"confirm"}', 'vision', image)).toThrow(ModelRejected)
  })
  it('recognizes escaped quotes/braces inside genuine reason text', () => {
    const reason = 'label "x":66, } { is visible'
    expect(visualReplyJson(JSON.stringify({ intent: 'target', x: 66, y: 137, reason }), ['intent', 'x', 'y', 'reason']).reason).toBe(reason)
  })
})
