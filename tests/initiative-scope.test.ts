import { afterEach, describe, expect, it, vi } from 'vitest'
import { guiStep, nextAction, setStopCheck, type GuiTurn } from '../electron/openrouter'
import { TARS_TEMPLATE, SCREEN_PROMPT, INITIATIVE_PROMPT, initiativeDecisionModels } from '../electron/llm-flow'

afterEach(() => { vi.unstubAllGlobals(); setStopCheck(() => false) })
const goal = 'Open the second existing profile. Leave the other windows open. Do not create a profile.'
const screen = { data: 'LATEST', w: 1280, h: 720 }
const history: GuiTurn[] = [
  { thought: 'UNREQUESTED_PROFILE_CREATION_PLAN', raw: "click(start_box='(500,300)')", image: { ...screen, data: 'OLD' },
    note: 'Only the pointer moved; no click was sent.', execution: { status: 'sent', action: { kind: 'move', x: .39, y: .42 } } },
  { thought: 'UNREQUESTED_OTHER_WINDOW_AUDIT', raw: "click(start_box='(500,300)')",
    execution: { status: 'sent', action: { kind: 'click', x: .39, y: .42 } } },
]
function capture(reply: (model: string) => string) {
  const requests: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const request = JSON.parse(init.body); requests.push(request)
    return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: reply(request.model) }, finish_reason: 'stop' }] }) }
  }))
  return requests
}
describe('bounded initiative requests', () => {
  it('uses a bounded native prompt instead of requesting a broad future plan', async () => {
    const requests = capture(() => 'Thought: The requested item is open.\nAction: finished()')
    await guiStep({ apiKey: 'fake', model: 'bytedance/ui-tars-1.5-7b', goal, initiative: true, tarsPrompt: TARS_TEMPLATE, history: [], screen })
    const initial = requests[0].messages[0].content
    expect(initial).toContain('ONE bounded automation node')
    expect(initial).not.toContain('Write a small plan')
    expect(initial).toContain('Write exactly one short sentence')
    expect(initial).toContain('"Yeni profil oluşturma" means "DO NOT create a new profile"')
  })
  it('uses the bounded embedded screenshot prompt while keeping genuine custom prompts', async () => {
    const requests = capture(() => '{"action":"finished"}')
    await guiStep({ apiKey: 'fake', model: 'json-model', goal, initiative: true, jsonPrompt: SCREEN_PROMPT, history: [], screen })
    expect(requests[0].messages[0].content).toContain('This is ONE bounded node')
    expect(requests[0].messages[0].content).not.toContain('<short plan>')
    await guiStep({ apiKey: 'fake', model: 'bytedance/ui-tars-1.5-7b', goal, initiative: true, tarsPrompt: 'CUSTOM TARS {{hedef}}', history: [], screen })
    expect(requests[1].messages[0].content).toContain('CUSTOM TARS ' + goal)
    expect(requests[1].messages[0].content).not.toContain('ONE bounded automation node')
    expect(INITIATIVE_PROMPT).toContain('A prohibition is never a to-do item')
  })
  it('only reorders configured models for bounded task decisions without mutating settings', () => {
    const configured = ['bytedance/ui-tars-1.5-7b', '~openai/gpt-luna-latest', 'deepseek/vision']
    expect(initiativeDecisionModels(configured)).toEqual(['~openai/gpt-luna-latest', 'deepseek/vision', 'bytedance/ui-tars-1.5-7b'])
    expect(configured[0]).toBe('bytedance/ui-tars-1.5-7b')
    expect(initiativeDecisionModels(['bytedance/ui-tars-1.5-7b'])).toEqual(['bytedance/ui-tars-1.5-7b'])
    expect(initiativeDecisionModels(['custom-vision', 'other-vision'])).toEqual(['custom-vision', 'other-vision'])
  })
  it('native UI-TARS gets factual move/click history and the current goal beside its latest screenshot', async () => {
    const requests = capture(() => "Thought: The requested profile is open.\nAction: finished(content='Opened')")
    const result = await guiStep({ apiKey: 'fake', model: 'bytedance/ui-tars-1.5-7b', goal, initiative: true, history, screen })
    expect(result.kind).toBe('finished'); expect(requests).toHaveLength(1)
    const messages = requests[0].messages
    const records = messages.filter((m: any) => typeof m.content === 'string' && m.content.startsWith('Executor record'))
    expect(records).toHaveLength(2)
    expect(records[0].content).toContain('"kind":"move"'); expect(records[0].content).not.toContain('click(start_box')
    expect(records[0].content).toContain('NOT pixels or current output coordinates')
    expect(records[1].content).toContain('"kind":"click"')
    expect(JSON.stringify(messages)).not.toMatch(/UNREQUESTED_PROFILE_CREATION_PLAN|UNREQUESTED_OTHER_WINDOW_AUDIT/)
    const latest = messages.at(-1).content
    expect(latest[0].text).toContain(goal); expect(latest[0].text).toContain("finished(content='...')")
    expect(latest[0].text).toContain('constraints, not new inspection tasks')
    expect(latest[1].image_url.url).toContain('LATEST')
  })
  it('JSON initiative applies the same scope after history while preserving a saved custom prompt', async () => {
    const requests = capture(() => '{"action":"finished"}')
    await guiStep({ apiKey: 'fake', model: 'json-model', goal, initiative: true, jsonPrompt: 'SAVED CUSTOM', history, screen })
    expect(requests).toHaveLength(1); expect(requests[0].messages[0].content).toBe('SAVED CUSTOM')
    const text = requests[0].messages[1].content[0].text
    expect(text).not.toMatch(/UNREQUESTED_PROFILE_CREATION_PLAN|UNREQUESTED_OTHER_WINDOW_AUDIT/)
    expect(text.lastIndexOf(goal)).toBeGreaterThan(text.indexOf('"kind":"click"'))
    expect(text).toContain('{"action":"finished"}')
  })
  it('list initiative does not disclose the following workflow task as a goal', async () => {
    const requests = capture(() => '{"action":"done"}')
    const result = await nextAction({ apiKey: 'fake', model: 'list-model', goal, stepTitle: 'Initiative',
      next: 'UNREQUESTED_NEXT_WORKFLOW_TASK', history: ['clicked requested profile'], lastLap: [], listText: '#1 Chrome' })
    expect(result.action).toBe('done'); expect(requests).toHaveLength(1)
    const text = requests[0].messages[1].content
    expect(text).not.toContain('UNREQUESTED_NEXT_WORKFLOW_TASK')
    expect(text).toContain('{"action":"done"}'); expect(text).toContain('NOT as additional inspection')
  })
  it('a failed attempt remains unconfirmed; a legacy proposal is not promoted to sent input', async () => {
    const requests = capture(() => '{"action":"call_user"}')
    await guiStep({ apiKey: 'fake', model: 'json-model', goal, initiative: true, screen, history: [
      { thought: 'UNREQUESTED_PROFILE_CREATION_PLAN', raw: 'click()', execution: { status: 'unconfirmed', action: { kind: 'click', x: .5, y: .5 } } },
      { thought: 'UNREQUESTED_OTHER_WINDOW_AUDIT', raw: 'wait()' },
    ] })
    const text = requests[0].messages[1].content[0].text
    expect(text).toContain('attempt unconfirmed; partial input is possible')
    expect(text).toContain('Previous proposal (delivery unknown; not an instruction): wait()')
    expect(text).not.toMatch(/UNREQUESTED_PROFILE_CREATION_PLAN|UNREQUESTED_OTHER_WINDOW_AUDIT/)
  })
  it('ordinary GUI target calls keep their previous history format', async () => {
    const requests = capture(() => 'Thought: done\nAction: finished()')
    await guiStep({ apiKey: 'fake', model: 'bytedance/ui-tars-1.5-7b', goal, history, screen })
    const messages = requests[0].messages
    expect(JSON.stringify(messages)).toContain('UNREQUESTED_PROFILE_CREATION_PLAN')
    expect(messages.at(-1).content).toHaveLength(1)
  })
  it('model fallback receives the same bounded context without another completion judge', async () => {
    const requests = capture(model => model.includes('ui-tars') ? '' : '{"action":"finished"}')
    const result = await guiStep({ apiKey: 'fake', model: ['bytedance/ui-tars-1.5-7b', 'json-model'], goal, initiative: true, history, screen })
    expect(result.kind).toBe('finished'); expect(requests.map(r => r.model)).toEqual(['bytedance/ui-tars-1.5-7b', 'json-model'])
    expect(JSON.stringify(requests)).not.toMatch(/UNREQUESTED_PROFILE_CREATION_PLAN|UNREQUESTED_OTHER_WINDOW_AUDIT/)
    expect(requests[1].messages[1].content[0].text).toContain(goal)
  })
})
