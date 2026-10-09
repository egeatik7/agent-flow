import { describe, expect, it, vi } from 'vitest'
import { setWindowTheme, supportsAcrylic } from '../electron/window-theme'

describe('native Aero backdrop', () => {
  it.each([
    ['win32', '10.0.22621', true],
    ['win32', '10.0.26100', true],
    ['win32', '10.0.22000', false],
    ['win32', '10.0.19045', false],
    ['linux', '6.8.0', false],
  ])('gates %s %s', (platform, release, supported) => {
    expect(supportsAcrylic(platform, release)).toBe(supported)
  })
  it('never calls native effects on unsupported desktops', () => {
    const win = { setBackgroundMaterial: vi.fn(), setBackgroundColor: vi.fn() }
    expect(setWindowTheme(win, 'aero', false)).toBe(false)
    expect(win.setBackgroundMaterial).not.toHaveBeenCalled()
    expect(win.setBackgroundColor).not.toHaveBeenCalled()
  })
  it('enables Aero and fully resets the backdrop for XP', () => {
    const win = { setBackgroundMaterial: vi.fn(), setBackgroundColor: vi.fn() }
    expect(setWindowTheme(win, 'aero', true)).toBe(true)
    expect(win.setBackgroundMaterial).toHaveBeenLastCalledWith('acrylic')
    expect(win.setBackgroundColor).toHaveBeenLastCalledWith('#00000000')
    expect(setWindowTheme(win, 'xp', true)).toBe(false)
    expect(win.setBackgroundMaterial).toHaveBeenLastCalledWith('none')
    expect(win.setBackgroundColor).toHaveBeenLastCalledWith('#ece9d8')
  })
  it('falls back to opaque when the compositor rejects Acrylic', () => {
    const win = { setBackgroundMaterial: vi.fn((material: string) => { if (material === 'acrylic') throw Error('unavailable') }), setBackgroundColor: vi.fn() }
    expect(setWindowTheme(win, 'aero', true)).toBe(false)
    expect(win.setBackgroundMaterial).toHaveBeenLastCalledWith('none')
    expect(win.setBackgroundColor).toHaveBeenLastCalledWith('#ece9d8')
  })
})
