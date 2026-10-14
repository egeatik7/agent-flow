// @vitest-environment jsdom
import { act, createElement, type RefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CanvasSearchHit } from '../src/lib/canvas-search'
import CanvasFind from '../src/components/CanvasFind'
import { createNode } from '../electron/graph-types'

let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const press = async (target: EventTarget, key: string, ctrlKey = false) => {
  const event = new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true, cancelable: true })
  await act(async () => { target.dispatchEvent(event) })
  return event
}
async function mount() {
  const a = { ...createNode('click', 500, 0), id: 'a', prompt: 'Save As' }
  const b = { ...createNode('click', 0, 0), id: 'b', prompt: 'Save As' }
  const onNavigate = vi.fn((_hit: CanvasSearchHit) => true)
  const pointerRef = { current: { x: 50, y: 50 } } as RefObject<{ x: number; y: number } | null>
  const canvasRef = { current: host }
  host.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600 } as DOMRect)
  const props = { graph: { nodes: [a, b], edges: [] }, scopeKey: 'canvas-one', canvasRef, pointerRef, onNavigate }
  await act(async () => root.render(createElement(CanvasFind, props)))
  return props
}
async function type(value: string) {
  const input = host.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return input
}
it('only opens Ctrl+F over the canvas, and leaves other text fields alone', async () => {
  const p = await mount()
  p.pointerRef.current!.x = 900
  expect((await press(window, 'f', true)).defaultPrevented).toBe(false)
  expect(host.querySelector('form')).toBeNull()
  p.pointerRef.current!.x = 50
  const outside = document.createElement('input'); document.body.append(outside)
  expect((await press(outside, 'f', true)).defaultPrevented).toBe(false)
  outside.remove()
  expect((await press(window, 'f', true)).defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(host.querySelector('input'))
})
it('does not search as you type; Enter/Ara submit, both keyboard arrows navigate and wrap', async () => {
  const p = await mount(); await press(window, 'f', true)
  const input = await type('Save As')
  expect(p.onNavigate).not.toHaveBeenCalled()
  await press(input, 'Enter')
  expect(p.onNavigate.mock.calls[0][0].nodeId).toBe('b')
  expect(host.textContent).toContain('1 / 2')
  await press(input, 'ArrowRight'); expect(p.onNavigate.mock.calls[1][0].nodeId).toBe('a')
  await press(input, 'ArrowRight'); expect(p.onNavigate.mock.calls[2][0].nodeId).toBe('b')
  await press(input, 'ArrowLeft'); expect(p.onNavigate.mock.calls[3][0].nodeId).toBe('a')
  await type('missing'); expect(p.onNavigate).toHaveBeenCalledTimes(4)
  expect(host.textContent).toContain('Yeni metin için Enter / Ara')
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(host.textContent).toContain('Sonuç bulunamadı.')
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Sonraki sonuç"]')!.disabled).toBe(true)
  await press(input, 'Escape'); expect(host.querySelector('form')).toBeNull()
})
it('keeps results across package navigation but clears them on changing canvas tabs', async () => {
  const p = await mount(); await press(window, 'f', true); await type('a')
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await act(async () => root.render(createElement(CanvasFind, { ...p, graph: { ...p.graph } })))
  expect(host.textContent).toContain('1 / 2')
  await act(async () => root.render(createElement(CanvasFind, { ...p, scopeKey: 'canvas-two' })))
  expect(host.querySelector('form')).toBeNull()
})
