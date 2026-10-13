import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LlmPanel from '../src/components/LlmPanel'
import { DEFAULT_SETTINGS } from '../electron/graph-types'
import { normalizePrompts, DEFAULT_PROMPTS } from '../electron/llm-flow'
import { runYap } from '../electron/yap'
import { createNode } from '../electron/graph-types'

let mounted: ReactTestRenderer | undefined
afterEach(() => { if (mounted) act(() => mounted!.unmount()); mounted = undefined })
function mount() {
  const onSave = vi.fn()
  act(() => { mounted = create(createElement(LlmPanel, { settings: structuredClone(DEFAULT_SETTINGS), onSave })) })
  return { onSave, root: mounted!.root }
}
function select(id: string) {
  act(() => mounted!.root.findByProps({ id: `method-tab-${id}` }).props.onClick())
}
function edit(label: string, value: string) {
  act(() => mounted!.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } }))
}
describe('node methods and editable runtime prompts', () => {
  it('saves and resets the click-only visual pointer prompt without changing other prompts', () => {
    const { onSave, root } = mount()
    edit('Görsel konum doğrulama — önce fareyi taşı', 'MY_POINTER')
    select('condition'); expect(root.findAllByProps({ 'aria-label': 'Görsel konum doğrulama — önce fareyi taşı' })).toHaveLength(0)
    select('click'); expect(root.findByProps({ 'aria-label': 'Görsel konum doğrulama — önce fareyi taşı' }).props.value).toBe('MY_POINTER')
    act(() => root.findAllByType('button').find(b => b.children.includes('Kaydet'))!.props.onClick())
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ llmPrompts: { visualPointer: 'MY_POINTER' } }))
    const textarea = root.findByProps({ 'aria-label': 'Görsel konum doğrulama — önce fareyi taşı' })
    act(() => textarea.parent!.findByType('button').props.onClick())
    expect(root.findByProps({ 'aria-label': 'Görsel konum doğrulama — önce fareyi taşı' }).props.value).toBe(DEFAULT_PROMPTS.visualPointer)
  })
  it('preserves condition drafts across node tabs and saves distinct stage keys', () => {
    const { onSave, root } = mount()
    select('condition')
    edit('1. UIA — koşul değerlendirmesi', 'MY_UIA')
    edit('2. Windows + ONNX OCR — koşul değerlendirmesi', 'MY_OCR')
    select('ai'); edit('Yap — araç kullanan ajan', 'MY_YAP')
    select('condition')
    expect(root.findByProps({ 'aria-label': '1. UIA — koşul değerlendirmesi' }).props.value).toBe('MY_UIA')
    act(() => root.findAllByType('button').find(b => b.children.includes('Kaydet'))!.props.onClick())
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ llmPrompts: { conditionUia: 'MY_UIA', conditionOcr: 'MY_OCR', yap: 'MY_YAP' } }))
  })
  it('prompt reset affects only the selected prompt, preserving other node drafts', () => {
    const { root } = mount()
    select('condition'); edit('1. UIA — koşul değerlendirmesi', 'UIA'); edit('2. Windows + ONNX OCR — koşul değerlendirmesi', 'OCR')
    act(() => root.findAllByType('button').find(b => b.children.includes('Sıfırla'))!.props.onClick())
    expect(root.findByProps({ 'aria-label': '1. UIA — koşul değerlendirmesi' }).props.value).toBe(DEFAULT_PROMPTS.conditionUia)
    expect(root.findByProps({ 'aria-label': '2. Windows + ONNX OCR — koşul değerlendirmesi' }).props.value).toBe('OCR')
  })
  it('local-only nodes have no fake prompt editors; selected node uses its own accessible tab', () => {
    const { root } = mount()
    for (const id of ['key', 'wait', 'loop', 'package', 'start', 'end']) {
      select(id)
      expect(root.findAllByType('textarea')).toHaveLength(0)
      expect(root.findByProps({ id: `method-tab-${id}` }).props['aria-selected']).toBe(true)
      expect(root.findByProps({ role: 'tabpanel' }).props['aria-labelledby']).toBe(`method-tab-${id}`)
    }
  })
  it('normalization preserves new custom prompt keys and drops unknown settings', () => {
    expect(normalizePrompts({ conditionUia: 'UIA', conditionOcr: 'OCR', yap: 'Sen bir ajanısın. Sadece JSON üret.', random: 'bad' })).toEqual({ conditionUia: 'UIA', conditionOcr: 'OCR', yap: 'Sen bir ajanısın. Sadece JSON üret.' })
  })
  it('Yap sends the configured system prompt to the actual model turn', async () => {
    const seen: unknown[] = []; let turn = 0
    await runYap(createNode('ai', 0, 0), {}, {
      system: 'MY_REAL_SYSTEM_PROMPT', shouldStop: () => false, log: () => {},
      makeExecute: () => async () => ({ ok: true, outcome: 'tamam', message: 'observed' }),
      turn: async ({ messages }) => {
        seen.push(structuredClone(messages))
        return { role: 'assistant', content: null, tool_calls: [{ id: `call${turn}`, type: 'function', function: ++turn === 1 ? { name: 'screen_read', arguments: '{}' } : { name: 'task_complete', arguments: '{"summary":"done"}' } }] }
      },
    })
    expect((seen[0] as { content: string }[])[0].content).toBe('MY_REAL_SYSTEM_PROMPT')
  })
})
