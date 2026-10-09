// @vitest-environment jsdom
import { act, createElement, Fragment, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TemplateInput from '../src/components/TemplateInput'
import HelpManual from '../src/manual/HelpManual'
import { createNode, type AgentGraph } from '../electron/graph-types'
import { atomicRange, editorSelection, rawText, replaceRange, restoreSelection, templateParts } from '../src/lib/template-editor'
import { findTip } from '../src/manual/tips'
const node = createNode('type', 200, 100)
const loop = { ...createNode('loop', 100, 100), members: [node.id], items: ['C:\\Images\\bir.png', 'D:\\Files\\iki.jpg'], startIndex: 1 }
const graph: AgentGraph = { nodes: [loop, node], edges: [] }
let mounted: Root | undefined
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(() => { act(() => mounted?.unmount()); mounted = undefined; document.body.replaceChildren(); vi.unstubAllGlobals(); vi.useRealTimers() })
function mount(value: string, multiline = false, manual = false) {
  const box = document.createElement('div'); document.body.append(box)
  const changed = vi.fn(); let props = { graph, disabled: false }
  function Host() {
    const [raw, update] = useState(value)
    const editor = createElement(TemplateInput, { ...props, value: raw, nodeId: node.id, label: 'Metin', multiline, onChange: next => { changed(next); update(next) } })
    return manual ? createElement(Fragment, null, editor, createElement(HelpManual)) : editor
  }
  mounted = createRoot(box); act(() => mounted!.render(createElement(Host)))
  const editor = box.querySelector<HTMLElement>('[role=textbox]')!
  const select = (start: number, end = start) => { editor.focus(); restoreSelection(editor, { start, end }) }
  const button = (token: string) => [...box.querySelectorAll<HTMLButtonElement>('.var-chips button')].find(b => b.textContent === token)!
  const click = (el: HTMLElement) => act(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  const key = (key: string, options: KeyboardEventInit = {}) => act(() => { editor.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })) })
  const clipboard = (type: string, text = '') => {
    const data = { getData: vi.fn(() => text), setData: vi.fn() }, event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: data }); act(() => editor.dispatchEvent(event)); return data
  }
  return { editor, box, changed, select, button, click, key, clipboard,
    rerender: (patch: Partial<typeof props>) => { props = { ...props, ...patch }; act(() => mounted!.render(createElement(Host))) } }
}
describe('inline variables / raw template editing', () => {
  it('inserts at the cursor and retains its new position', () => {
    const h = mount('prefix suffix'); h.select(7); h.click(h.button('{{öğe}}'))
    expect(h.changed).toHaveBeenLastCalledWith('prefix {{öğe}}suffix'); expect(rawText(h.editor)).toBe('prefix {{öğe}}suffix')
    expect(editorSelection(h.editor)).toEqual({ start: 14, end: 14 }); expect(h.box.querySelector('.template-token-value')?.textContent).toBe('D:\\Files\\iki.jpg')
  })
  it('replaces the selected text without adding spaces', () => {
    const h = mount('A/old.glb'); h.select(2, 5); h.click(h.button('{{öğe.isim}}')); expect(rawText(h.editor)).toBe('A/{{öğe.isim}}.glb')
  })
  it('removes only the second duplicate chip', () => {
    const h = mount('x{{öğe}} y{{öğe}}z'); h.click(h.box.querySelectorAll<HTMLElement>('.template-token-remove')[1])
    expect(rawText(h.editor)).toBe('x{{öğe}} yz'); expect(editorSelection(h.editor)).toEqual({ start: 10, end: 10 })
  })
  it('Backspace/Delete remove adjacent tokens atomically', () => {
    const h = mount('a{{sıra}}{{toplam}}z'); h.select(9); h.key('Backspace'); expect(rawText(h.editor)).toBe('a{{toplam}}z')
    h.select(1); h.key('Delete'); expect(rawText(h.editor)).toBe('az')
  })
  it('copy/cut use raw template strings', () => {
    const h = mount('a{{öğe}}z'); h.select(1, 8)
    expect(h.clipboard('copy').setData).toHaveBeenCalledWith('text/plain', '{{öğe}}')
    expect(h.clipboard('cut').setData).toHaveBeenCalledWith('text/plain', '{{öğe}}'); expect(rawText(h.editor)).toBe('az')
  })
  it('pastes literal text at selection and supports ASCII aliases', () => {
    const h = mount('az'); h.select(1); h.clipboard('paste', '<img> {{oge.isim}}')
    expect(rawText(h.editor)).toBe('a<img> {{oge.isim}}z'); expect(h.editor.querySelector('img')).toBeNull()
    expect(h.box.querySelector('.template-token-value')?.textContent).toBe('iki')
  })
  it('typed unknown tokens and unfinished syntax survive serialization', () => {
    const h = mount(''); h.editor.textContent = '{{ sıra }} {{custom}} {{'; act(() => h.editor.dispatchEvent(new Event('input', { bubbles: true })))
    expect(rawText(h.editor)).toBe('{{ sıra }} {{custom}} {{')
    expect([...h.box.querySelectorAll('.template-token-value')].map(el => el.textContent)).toEqual(['2', '{{custom}} · Bilinmeyen değişken'])
  })
  it('preview updates without modifying the template or cursor', () => {
    const h = mount('a{{öğe}}z'); h.select(8); h.rerender({ graph: { nodes: [{ ...loop, startIndex: 0 }, node], edges: [] } })
    expect(h.box.querySelector('.template-token-value')?.textContent).toBe('C:\\Images\\bir.png'); expect(rawText(h.editor)).toBe('a{{öğe}}z')
    expect(editorSelection(h.editor)).toEqual({ start: 8, end: 8 }); expect(h.changed).not.toHaveBeenCalled()
  })
  it('El kitabı gives the complete long value for both chip and button', () => {
    const path = 'C:\\' + 'very-long-folder\\'.repeat(35) + 'file.png'
    const h = mount('{{öğe}}'); h.rerender({ graph: { nodes: [{ ...loop, items: [path], startIndex: 0 }, node], edges: [] } })
    for (const el of [h.box.querySelector('.template-token-value')!, h.button('{{öğe}}')]) {
      const tip = findTip(el)?.tip; expect(tip?.text).toContain(path); expect(tip?.text).toContain('işaretli öğe 1/1'); expect(tip?.text).toContain('Akışta {{öğe}} saklanır.')
    }
  })
  it('an open El kitabı refreshes when the pointer is stationary', async () => {
    vi.useFakeTimers(); const h = mount('{{öğe}}', false, true), button = h.button('{{öğe}}')
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => button })
    act(() => { button.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, clientX: 20, clientY: 20 })); vi.advanceTimersByTime(700) })
    expect(document.querySelector('.xpas-manual-text')?.textContent).toContain('D:\\Files\\iki.jpg')
    await act(async () => { h.rerender({ graph: { nodes: [{ ...loop, startIndex: 0 }, node], edges: [] } }); await Promise.resolve() })
    expect(document.querySelector('.xpas-manual-text')?.textContent).toContain('C:\\Images\\bir.png'); expect(document.querySelector('.xpas-manual-text')?.textContent).not.toContain('D:\\Files\\iki.jpg')
  })
  it('supports undo/redo', () => {
    const h = mount('ab'); h.select(1); h.click(h.button('{{sıra}}')); h.key('z', { ctrlKey: true }); expect(rawText(h.editor)).toBe('ab')
    h.key('y', { ctrlKey: true }); expect(rawText(h.editor)).toBe('a{{sıra}}b')
  })
  it('preserves multiline newlines without HTML blocks', () => {
    const h = mount('ab', true); h.select(1); h.key('Enter'); h.clipboard('paste', 'x\r\ny'); expect(rawText(h.editor)).toBe('a\nx\nyb'); expect(h.editor.querySelector('div')).toBeNull()
  })
  it('a locked canvas disables editing and token actions', () => {
    const h = mount('{{öğe}}'); h.rerender({ disabled: true }); expect(h.editor.getAttribute('contenteditable')).toBe('false'); expect(h.button('{{öğe}}').disabled).toBe(true)
    h.click(h.box.querySelector('.template-token-remove')!); h.clipboard('paste', 'bad'); expect(rawText(h.editor)).toBe('{{öğe}}'); expect(h.changed).not.toHaveBeenCalled()
  })
  it('does not delete half a Unicode surrogate pair', () => {
    const h = mount('A😀B'); h.select(3); h.key('Backspace'); expect(rawText(h.editor)).toBe('AB')
  })
})
describe('raw ranges', () => {
  it('losslessly tokenizes raw text', () => {
    const raw = 'D:\\{{ oge.isim }}\\{{öge}} {{missing}}\n{{ unfinished'; expect(templateParts(raw).map(part => part.text).join('')).toBe(raw)
  })
  it('expands partial selections and clamps the cursor', () => {
    expect(atomicRange('a{{öğe}}b', { start: 2, end: 4 })).toEqual({ start: 1, end: 8 }); expect(replaceRange('ab', { start: 99, end: 99 }, 'x').value).toBe('abx')
  })
})
