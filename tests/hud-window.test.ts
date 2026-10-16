import { describe, expect, it, vi } from 'vitest'
import { HudWindowController, type HudWindow } from '../electron/hud-window'

function fixture() {
  let visible = false, loading = false, running = true
  let loaded: (() => void) | undefined
  const w = {
    isDestroyed: () => false, isVisible: () => visible,
    hide: vi.fn(() => { visible = false }), showInactive: vi.fn(() => { visible = true }),
    webContents: { isLoading: () => loading, send: vi.fn(), once: vi.fn((_event: string, fn: () => void) => { loaded = fn }) },
  }
  let current: HudWindow | null = w
  const place = vi.fn()
  const c = new HudWindowController(() => current, () => running, place)
  return { c, w, place, load: () => { loading = true }, finish: () => { loading = false; loaded?.() }, stop: () => { running = false }, replace: (next: HudWindow | null) => { current = next } }
}

describe('card visibility has one owner', () => {
  it('repeated progress messages update content without showing or moving the visible card again', () => {
    const h = fixture()
    for (let i = 0; i < 100; i++) h.c.send('hud:status', { text: String(i) }, true)
    expect(h.w.showInactive).toHaveBeenCalledTimes(1)
    expect(h.place).toHaveBeenCalledTimes(1)
    expect(h.w.webContents.send).toHaveBeenCalledTimes(100)
  })
  it('updates during capture cannot reveal the card; release shows it once', () => {
    const h = fixture(); h.c.show()
    const release = h.c.capture()
    h.c.send('hud:status', { text: 'model' }, true)
    h.c.show()
    expect(h.w.isVisible()).toBe(false)
    release(); release()
    expect(h.w.showInactive).toHaveBeenCalledTimes(2)
  })
  it('overlapping captures wait for the final lease', () => {
    const h = fixture(); h.c.show()
    const a = h.c.capture(), b = h.c.capture()
    a(); expect(h.w.isVisible()).toBe(false)
    b(); expect(h.w.isVisible()).toBe(true)
  })
  it('Stop during capture cannot be undone by its finally callback', () => {
    const h = fixture(); h.c.show()
    const release = h.c.capture(); h.stop(); release()
    expect(h.w.isVisible()).toBe(false)
  })
  it('a scheduled hide during capture is respected on release', () => {
    const h = fixture(); h.c.show()
    const release = h.c.capture(); h.c.hide(); release()
    expect(h.w.isVisible()).toBe(false)
  })
  it('loading coalesces by channel and does not register one listener per tick', () => {
    const h = fixture(); h.load()
    for (let i = 0; i < 100; i++) h.c.send('hud:status', { text: String(i) }, true)
    h.c.send('hud:countdown', { text: '2 sn' }, false)
    expect(h.w.webContents.once).toHaveBeenCalledTimes(1)
    h.finish()
    expect(h.w.webContents.send.mock.calls).toEqual([['hud:status', { text: '99' }], ['hud:countdown', { text: '2 sn' }]])
    expect(h.w.showInactive).toHaveBeenCalledTimes(1)
  })
  it('show requested during load becomes visible after load without requiring another event', () => {
    const h = fixture(); h.load(); h.c.show(); h.finish()
    expect(h.w.isVisible()).toBe(true)
  })
  it('late load after Stop or hide does not resurrect the card', () => {
    const h = fixture(); h.load(); h.c.send('hud:status', { text: 'old' }, true)
    h.c.hide(); h.stop(); h.finish()
    expect(h.w.showInactive).not.toHaveBeenCalled()
    expect(h.w.webContents.send).not.toHaveBeenCalled()
  })
  it('a stale load/capture callback cannot operate on a replacement window', () => {
    const h = fixture(); h.load(); h.c.send('hud:status', {}, true)
    const release = h.c.capture(); h.c.reset(); h.replace(null); h.finish(); release()
    expect(h.w.webContents.send).not.toHaveBeenCalled()
    expect(h.w.showInactive).not.toHaveBeenCalled()
  })
})
