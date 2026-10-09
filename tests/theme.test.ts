// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AERO_PALETTE_KEY, applyTheme, readAeroPalette, readTheme, selectInterface } from '../src/lib/theme'
afterEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); document.documentElement.removeAttribute('data-aero-palette'); vi.restoreAllMocks() })
describe('opaque Aero palette selection', () => {
  it('defaults to lilac and advances on every Aero press, preserving XP independently', () => {
    applyTheme(readTheme())
    expect(document.documentElement.dataset.aeroPalette).toBe('lilac')
    for (const palette of ['sky', 'mint', 'peach', 'lilac']) {
      selectInterface('aero'); expect(document.documentElement.dataset.aeroPalette).toBe(palette)
      expect(readAeroPalette()).toBe(palette)
    }
    selectInterface('xp'); expect(readTheme()).toBe('xp'); expect(readAeroPalette()).toBe('lilac')
    selectInterface('aero'); expect(readAeroPalette()).toBe('sky')
    applyTheme(readTheme()); expect(document.documentElement.dataset.aeroPalette).toBe('sky')
  })
  it('repairs invalid saved palette names and still cycles when storage is blocked', () => {
    localStorage.setItem(AERO_PALETTE_KEY, 'corrupt'); expect(readAeroPalette()).toBe('lilac')
    applyTheme('aero')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('blocked') })
    selectInterface('aero'); expect(document.documentElement.dataset.aeroPalette).toBe('sky')
    selectInterface('aero'); expect(document.documentElement.dataset.aeroPalette).toBe('mint')
  })
})
