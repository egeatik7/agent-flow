type ThemeWindow = {
  setBackgroundMaterial: (material: 'none' | 'acrylic') => void
  setBackgroundColor: (color: string) => void
}

/** DWM Acrylic is supported by Electron on Windows 11 22H2 (22621)+. */
export function supportsAcrylic(platform: string, release: string): boolean {
  const [major, , build] = release.split('.').map(Number)
  return platform === 'win32' && major >= 10 && build >= 22621
}

export function setWindowTheme(win: ThemeWindow, theme: 'aero' | 'xp', supported: boolean): boolean {
  if (!supported) return false
  try {
    win.setBackgroundMaterial(theme === 'aero' ? 'acrylic' : 'none')
    win.setBackgroundColor(theme === 'aero' ? '#00000000' : '#ece9d8')
    return theme === 'aero'
  } catch {
    // Keep the renderer opaque if the desktop compositor rejects the effect.
    try { win.setBackgroundMaterial('none') } catch { /* unsupported compositor */ }
    try { win.setBackgroundColor('#ece9d8') } catch { /* window may have closed */ }
    return false
  }
}
