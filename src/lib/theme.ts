import { useEffect, useState } from 'react'

export type Theme = 'aero' | 'xp'
export const THEME_KEY = 'nubbo-interface-theme'
let nativeRequest = 0

export function readTheme(): Theme {
  try { return localStorage.getItem(THEME_KEY) === 'xp' ? 'xp' : 'aero' }
  catch { return 'aero' }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  // The HUD is already its own transparent window; only the main window requests DWM.
  if (document.documentElement.classList.contains('hud-root')) return
  const request = ++nativeRequest
  const native = window.xpAgent?.setWindowTheme
  if (!native) return
  void native(theme).then(enabled => {
    if (request === nativeRequest) document.documentElement.dataset.nativeGlass = enabled ? 'true' : 'false'
  }).catch(() => {
    if (request === nativeRequest) document.documentElement.dataset.nativeGlass = 'false'
  })
}

/** Run before React mounts, including in the separate HUD window. */
export function initializeTheme() {
  applyTheme(readTheme())
  window.addEventListener('storage', event => {
    if (event.key === THEME_KEY || event.key === null) applyTheme(readTheme())
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
    applyTheme(next)
    setTheme(next)
    try { localStorage.setItem(THEME_KEY, next) } catch { /* still works without storage */ }
  }
  return [theme, selectTheme] as const
}
