// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { createNode, type CanvasBook } from '../electron/graph-types'

let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  vi.useFakeTimers()
  localStorage.clear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(700)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals() })
const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const button = (text: string, selector = 'button') => [...host.querySelectorAll(selector)].find(el => el.textContent === text)!
const blank = async () => {
  const el = host.querySelector('.canvas-scroll')!
  await act(async () => {
    el.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 10, clientY: 10, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 10, clientY: 10, bubbles: true }))
  })
}
function seed() {
  const leaf = { ...createNode('type', 4000, 2000), id: 'deep-leaf', title: 'Deep leaf', text: 'Hello' }
  const inner = { ...createNode('package', 250, 0), id: 'inner', title: 'Inner package', inner: { nodes: [leaf], edges: [] } }
  const loop = { ...createNode('loop', 0, 0), id: 'loop', title: 'Repeat', members: ['inner'] }
  const pack = { ...createNode('package', 0, 0), id: 'outer', title: 'Outer package', inner: { nodes: [loop, inner], edges: [] } }
  const graph = { nodes: [createNode('start', 0, 0), pack], edges: [] }
  const book: CanvasBook = { activeId: '', tabs: [], library: { canvases: [{ id: 'saved', name: 'Saved work', updatedAt: 1, graph }],
    automations: [{ id: 'automation', name: 'My automation', updatedAt: 1, entries: [{ id: 'entry', canvasId: 'saved' }] }] } }
  localStorage.setItem('xp-agent-canvases', JSON.stringify(book))
}
describe('XP workspace real DOM interactions', () => {
  it('shows one package scope, supports click/dual click and navigates back, forward and out without selection', async () => {
    seed(); await act(async () => root.render(createElement(App)))
    expect(host.querySelectorAll('.welcome-card')).toHaveLength(3)
    expect(host.querySelectorAll('.canvas-tab')).toHaveLength(0)
    expect(host.querySelector('.theme-picker')).toBeNull()
    expect(host.querySelector('.library-brand .nubbo-logo')).not.toBeNull()
    await click(host.querySelectorAll('.welcome-card')[0]); await click(button('Aç', '.workspace-picker button'))
    await blank()
    const enter = async (title: string) => {
      await click(host.querySelector(`.navigator-node[title^="${title} —"]`)!)
      await act(async () => { vi.advanceTimersByTime(301) })
    }
    expect(host.querySelectorAll('.navigator-node')).toHaveLength(2)
    await enter('Outer package')
    expect(host.querySelectorAll('.navigator-node')).toHaveLength(3)
    expect(host.querySelector('.navigator-node[title^="Deep leaf —"]')).toBeNull()
    await enter('Inner package')
    expect(host.querySelectorAll('.navigator-node')).toHaveLength(2)
    expect(host.querySelectorAll('.agent-node.selected')).toHaveLength(0)
    await click(host.querySelector('.navigator-node[title^="Deep leaf —"]')!)
    const node = host.querySelector('[data-node-id="deep-leaf"]') as HTMLElement
    expect(node.classList.contains('selected')).toBe(false)
    const stage = host.querySelector('.canvas-inner') as HTMLElement
    const x = 350 - (4000 + parseFloat(node.style.width) / 2), y = 250 - (2000 + parseFloat(node.style.height) / 2)
    expect(stage.style.transform).toBe(`translate(${x}px, ${y}px) scale(1)`)
    await act(async () => { host.querySelector('.navigator-node[title^="Deep leaf —"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 })) })
    expect(node.classList.contains('selected')).toBe(true)
    expect(host.querySelector('.node-inspector')).not.toBeNull()
    expect(host.querySelectorAll('.navigator-node')).toHaveLength(2)
    await blank(); expect(host.querySelector('.node-inspector')).toBeNull()
    expect(button('Expand All')).toBeUndefined(); expect(button('Collapse All')).toBeUndefined(); expect(button('Tuval hiyerarşisi')).toBeUndefined()
    await click(host.querySelector('button[aria-label="Dışarı"]')!)
    expect(host.querySelectorAll('.navigator-node')).toHaveLength(3)
    expect(host.querySelectorAll('.agent-node.selected')).toHaveLength(0)
    await click(host.querySelector('button[aria-label="Geri"]')!)
    expect(host.querySelector('[data-node-id="deep-leaf"]')).not.toBeNull()
    expect(host.querySelectorAll('.agent-node.selected')).toHaveLength(0)
    await click(host.querySelector('button[aria-label="İleri"]')!)
    expect(host.querySelectorAll('.navigator-node')).toHaveLength(3)
    await click(button('Tuvaller', '.tabs button'))
    expect((host.querySelector('.canvas-tab-content') as HTMLElement).style.display).not.toBe('none')
    expect(host.querySelector('.canvas-tab-content')!.lastElementChild?.className).toBe('library-brand')
  })
  it('double clicking a package opens its settings instead of entering or hitting a child row', async () => {
    seed(); await act(async () => root.render(createElement(App)))
    await click(host.querySelectorAll('.welcome-card')[0]); await click(button('Aç', '.workspace-picker button')); await blank()
    const row = host.querySelector('.navigator-node[title^="Outer package —"]')!
    await act(async () => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }))
      vi.advanceTimersByTime(301)
    })
    expect(host.querySelectorAll('.navigator-node')).toHaveLength(2)
    expect(host.querySelector('[data-node-id="outer"].selected')).not.toBeNull()
    expect(host.querySelector('.node-inspector')).not.toBeNull()
  })
  it('opens an automation from the welcome picker and creates a new canvas from its card', async () => {
    seed(); await act(async () => root.render(createElement(App)))
    await click(host.querySelectorAll('.welcome-card')[1]); await click(button('Aç', '.workspace-picker button'))
    expect(host.querySelectorAll('.canvas-tab')).toHaveLength(1)
    expect(host.querySelector('.canvas-tab-name')?.textContent ?? host.querySelector('.canvas-tab')?.textContent).toContain('Saved work')
    // A fresh startup leaves stored catalog entries, and no working tabs.
    await act(async () => { root.unmount(); root = createRoot(host); root.render(createElement(App)) })
    expect(host.querySelectorAll('.canvas-tab')).toHaveLength(0)
    await click(host.querySelectorAll('.welcome-card')[2])
    expect(host.querySelectorAll('.canvas-tab')).toHaveLength(1)
    expect(host.querySelector('.agent-node.kind-start')).not.toBeNull()
  })
})
