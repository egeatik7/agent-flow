import { expect, it, vi } from 'vitest'
const fixtures = vi.hoisted(() => ({ pages: [] as any[] }))
vi.mock('playwright-core', () => ({ chromium: { connectOverCDP: async () => ({ isConnected: () => true, on: () => {}, contexts: () => [{ pages: () => fixtures.pages }] }) } }))
import { userChromeItems, matchUserChrome } from '../electron/browser'
const page = (title: string, text: string, visible: boolean, focus = true) => ({
  isClosed: () => false, title: async () => title,
  evaluate: async (script: string) => script.includes('document.hasFocus()') ? visible && focus
    : script.includes('INTERACTIVE') ? { out: [{ text, type: 'Button', x: 100, y: 100, w: 80, h: 30 }], vw: 1000, vh: 800 }
    : { sx: 0, sy: 0, dpr: 1, top: 100 },
})
it('only the foreground visible tab supplies target coordinates, including duplicate titles', async () => {
  fixtures.pages = [page('Same', 'Safe', true), page('Same', 'Delete All', false), page('Other window', 'Inactive', true, false)]
  expect((await userChromeItems())!.items.map(i => i.text)).toEqual(['Safe'])
  expect((await userChromeItems('Same - Google Chrome'))!.items.map(i => i.text)).toEqual(['Safe'])
  expect(await matchUserChrome({ x: 100, y: 200, w: 80, h: 30 })).toEqual({ text: 'Safe', type: 'Button' })
})
it('focus-check failure supplies no speculative targets', async () => {
  fixtures.pages = [{ ...page('Tab', 'Unsafe', true), evaluate: async () => { throw Error('tab gone') } }]
  expect(await userChromeItems()).toBeNull()
})
it('tab switched during collection discards stale coordinates', async () => {
  const p = page('Tab', 'Old', true), evaluate = p.evaluate
  let checks = 0
  p.evaluate = async script => script.includes('document.hasFocus()') ? ++checks === 1 : evaluate(script)
  fixtures.pages = [p]
  expect(await userChromeItems()).toBeNull()
})
