import { useEffect, useState } from 'react'

export type Theme = 'aero' | 'xp'
export const THEME_KEY = 'nubbo-interface-theme'
export const AERO_PALETTE_KEY = 'nubbo-aero-palette'
export const AERO_PALETTES = ['lilac', 'sky', 'mint', 'peach'] as const
export type AeroPalette = typeof AERO_PALETTES[number]

export function readAeroPalette(): AeroPalette {
  try {
    const value = localStorage.getItem(AERO_PALETTE_KEY)
    return AERO_PALETTES.find(palette => palette === value) ?? 'lilac'
  } catch { return 'lilac' }
}

export function nextAeroPalette(current: AeroPalette): AeroPalette {
  return AERO_PALETTES[(AERO_PALETTES.indexOf(current) + 1) % AERO_PALETTES.length]
}

export function readTheme(): Theme {
  try { return localStorage.getItem(THEME_KEY) === 'xp' ? 'xp' : 'aero' }
  catch { return 'aero' }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.dataset.aeroPalette = readAeroPalette()
}

export function selectInterface(next: Theme) {
  const visible = document.documentElement.dataset.aeroPalette
  const current = AERO_PALETTES.find(palette => palette === visible) ?? readAeroPalette()
  const palette = next === 'aero' ? nextAeroPalette(current) : current
  try {
    localStorage.setItem(THEME_KEY, next)
    localStorage.setItem(AERO_PALETTE_KEY, palette)
  } catch { /* still works without storage */ }
  document.documentElement.dataset.theme = next
  document.documentElement.dataset.aeroPalette = palette
}

/** Run before React mounts, including in the separate HUD window. */
export function initializeTheme() {
  applyTheme(readTheme())
  window.addEventListener('storage', event => {
    if (event.key === THEME_KEY || event.key === AERO_PALETTE_KEY || event.key === null) applyTheme(readTheme())
  })
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme)
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === THEME_KEY || event.key === null) setTheme(readTheme())
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  const selectTheme = (next: Theme) => {
    selectInterface(next)
    setTheme(next)
  }
  return [theme, selectTheme] as const
}
