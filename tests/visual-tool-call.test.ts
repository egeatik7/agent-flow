import { expect, it, vi, afterEach } from 'vitest'
import { visualToolCall } from '../electron/visual-tool-call'
import { bekleyenOlcumleriBekle } from '../electron/local-context-probe'
import { chooseVisualTarget, setLocalEndpoint, setStopCheck } from '../electron/openrouter'
const tool = (args: unknown) => JSON.stringify({ name: 'computer_use', arguments: args })
const move = tool({ action: 'mouse_move', coordinate: [66, 137] })
afterEach(async () => { await bekleyenOlcumleriBekle(); vi.unstubAllGlobals(); setLocalEndpoint(''); setStopCheck(() => false) })

it('reads the same wire object with a single tool_call wrapper or as complete JSON', () => {
  const expected = { name: 'computer_use', arguments: { action: 'mouse_move', coordinate: [66, 137] }, reason: '' }
  expect(visualToolCall(`<tool_call>${move}</tool_call>`)).toEqual(expected)
  expect(visualToolCall(move)).toEqual(expected)
  expect(visualToolCall(`Action: Locate User Perspective\n<tool_call>${move}</tool_call>`)).toEqual({ ...expected, reason: 'Locate User Perspective' })
  expect(expected).not.toHaveProperty('intent')
})
it('missing is failure without a point, never task completion', () => {
  expect(visualToolCall(tool({ action: 'terminate', status: 'failure' })).arguments).toEqual({ action: 'terminate', status: 'failure' })
  expect(() => visualToolCall(tool({ action: 'terminate', status: 'success' }))).toThrow()
  expect(() => visualToolCall(tool({ action: 'terminate', status: 'failure', coordinate: [1, 2] }))).toThrow()
})
it.each(['left_click', 'double_click', 'right_click', 'type', 'key', 'scroll', 'wait', 'dismiss'])('rejects %s instead of dispatching an input', action => {
  expect(() => visualToolCall(tool({ action, coordinate: [66, 137] }))).toThrow()
})
it.each([[], [1], [1, 2, 3], ['66', 137], [null, 137], [-1, 20], [1000, 20], [20, 1000]].map(coordinate => ({ coordinate })))('rejects invalid or ambiguous point $coordinate', ({ coordinate }) => {
  expect(() => visualToolCall(tool({ action: 'mouse_move', coordinate }))).toThrow()
})
it('rejects duplicate and escaped duplicate nested keys, extra fields, multiple calls and malformed wrappers', () => {
  const bad = [
    '{"name":"computer_use","arguments":{"action":"mouse_move","coordinate":[66,137],"coordinate":[484,477]}}',
    '{"name":"computer_use","arguments":{"action":"mouse_move","coordinate":[66,137],"\\u0063oordinate":[484,477]}}',
    tool({ action: 'mouse_move', coordinate: [66, 137], strconv: 210 }),
    JSON.stringify({ name: 'computer_use', arguments: { action: 'mouse_move', coordinate: [66, 137] }, intent: 'target' }),
    `<tool_call>${move}</tool_call><tool_call>${move}</tool_call>`,
    `<tool_call>${move}`, `prefix <tool_call>${move}</tool_call>`,
  ]
  for (const raw of bad) expect(() => visualToolCall(raw)).toThrow()
})
it('sends the native wrapper contract to a local GUI-Owl and does not force json_object over XML', async () => {
  const bodies: any[] = []
  setLocalEndpoint('http://localhost:11434/v1', 1000, true)
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (!String(url).endsWith('/chat/completions')) return { ok: false, status: 404, json: async () => ({}) }
    bodies.push(JSON.parse(init.body))
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: `<tool_call>${move}</tool_call>` }, finish_reason: 'stop' }] }) }
  }))
  const result = await chooseVisualTarget({ apiKey: '', model: 'local:gui-owl-1.5-8b:latest', goal: 'User Perspective', screen: { data: 'fixture', w: 1400, h: 788 }, allowDismiss: true })
  expect(result).toMatchObject({ name: 'computer_use', arguments: { action: 'mouse_move', coordinate: [66, 137] } })
  expect(result).not.toHaveProperty('intent')
  expect(bodies).toHaveLength(1)
  expect(bodies[0]).not.toHaveProperty('response_format')
  expect(JSON.stringify(bodies[0].messages)).toContain('<tool_call>')
  expect(JSON.stringify(bodies[0].messages)).not.toContain('target|dismiss|missing')
})
