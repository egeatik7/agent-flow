export type KeyPreset = { label: string; keys: string; append?: boolean }

export const KEY_PRESETS: KeyPreset[] = [
  { label: 'Enter', keys: 'enter' },
  { label: 'Tab', keys: 'tab' },
  { label: 'Esc', keys: 'esc' },
  { label: 'Ctrl+A', keys: 'ctrl+a' },
  { label: 'Ctrl+C', keys: 'ctrl+c' },
  { label: 'Ctrl+V', keys: 'ctrl+v' },
  { label: 'Ctrl+S', keys: 'ctrl+s' },
  { label: 'Alt+F4', keys: 'alt+f4' },
  { label: 'Win', keys: 'win+', append: true },
  { label: 'Win+R', keys: 'win+r' },
  { label: 'Win+D', keys: 'win+d' },
  { label: 'Win+E', keys: 'win+e' },
  { label: 'Win+Tab', keys: 'win+tab' },
  { label: 'F5', keys: 'f5' },
  { label: '↓', keys: 'down' },
  { label: '↑', keys: 'up' },
]

// Continue a draft modifier prefix, otherwise start a fresh Windows shortcut.
// Never append "win+" to a completed chord or combine it with legacy SendKeys.
export function winPrefix(current: string | undefined): string {
  const draft = (current ?? '').trim().toLowerCase()
  if (!/^(?:(?:ctrl|control|shift|alt|win|lwin|rwin|meta|cmd|super)\s*\+\s*)+$/.test(draft)) return 'win+'
  const mods = draft.split('+').map((part) => part.trim()).filter(Boolean)
  if (mods.some((mod) => ['win', 'lwin', 'rwin', 'meta', 'cmd', 'super'].includes(mod))) return mods.join('+') + '+'
  return mods.join('+') + '+win+'
}
