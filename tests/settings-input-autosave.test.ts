import { act, createElement, useState } from 'react'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type AppSettings } from '../electron/graph-types'
import { FIND_STAGES } from '../electron/llm-flow'
import LlmPanel from '../src/components/LlmPanel'
import NumberDraft from '../src/components/NumberDraft'
import LocalChat from '../src/components/LocalChat'
let mounted: ReactTestRenderer | undefined
afterEach(() => { if (mounted) act(() => mounted!.unmount()); mounted = undefined; vi.unstubAllGlobals() })

it('valid numbers commit while typing; clearing or incomplete numbers preserve the previous valid setting', () => {
  const commit = vi.fn()
  act(() => { mounted = create(createElement(NumberDraft, { value: 512, min: 10, max: 1000, onCommit: commit })) })
  const input = () => mounted!.root.findByType('input')
  act(() => input().props.onChange({ target: { value: '' } }))
  act(() => input().props.onChange({ target: { value: '1' } }))
  expect(commit).not.toHaveBeenCalled()
  act(() => input().props.onChange({ target: { value: '128' } }))
  expect(commit).toHaveBeenCalledWith(128)
})
it('typing a Yaz list prompt immediately updates its own setting without contaminating Tıkla', () => {
  const draft = vi.fn()
  function Fixture() {
    const [settings, setSettings] = useState<AppSettings>({ ...DEFAULT_SETTINGS, llmPrompts: { list: 'click instructions' } })
    return createElement(LlmPanel, { settings, onSave: () => {}, onDraft: patch => { draft(patch); setSettings(s => ({ ...s, ...patch })) } })
  }
  act(() => { mounted = create(createElement(Fixture)) })
  const title = FIND_STAGES.find(stage => stage.id === 'list')!.title + ' promptu'
  act(() => mounted!.root.findByProps({ id: 'method-tab-type' }).props.onClick())
  // Previously saved shared custom instructions remain compatible until independently edited.
  expect(mounted!.root.findByProps({ 'aria-label': title }).props.value).toBe('click instructions')
  act(() => mounted!.root.findByProps({ 'aria-label': title }).props.onChange({ target: { value: 'type instructions\n' } }))
  expect(draft).toHaveBeenLastCalledWith({ llmPrompts: { list: 'click instructions', typeList: 'type instructions\n' } })
  act(() => mounted!.root.findByProps({ id: 'method-tab-click' }).props.onClick())
  expect(mounted!.root.findByProps({ 'aria-label': title }).props.value).toBe('click instructions')
})
it('live local chat waits for settings to be saved before it sends its request', async () => {
  let finish!: (ok: boolean) => void
  const before = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
  const chat = vi.fn(async () => ({ ok: true, reply: 'ok', model: 'local:owl', target: 'local', ms: 1, gpu: '' }))
  vi.stubGlobal('window', { xpAgent: { localChat: chat } })
  act(() => { mounted = create(createElement(LocalChat, { settings: DEFAULT_SETTINGS, models: [], onBeforeSend: before })) })
  act(() => mounted!.root.findByProps({ id: 'local-chat-input' }).props.onChange({ target: { value: 'hello' } }))
  await act(async () => { mounted!.root.findByProps({ className: 'xp-btn primary' }).props.onClick() })
  expect(chat).not.toHaveBeenCalled()
  await act(async () => { finish(true) })
  expect(chat).toHaveBeenCalledOnce()
})
