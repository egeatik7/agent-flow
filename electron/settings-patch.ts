import type { AppSettings } from './graph-types'
import { recoverySettings, type RecoverySettings } from './recovery-settings'
export type SettingsPatch = Omit<Partial<AppSettings>, 'recovery'> & { recovery?: Partial<RecoverySettings> }
/** A model-only recovery save cannot reset its API key, permissions or task. */
export function mergeSettingsPatch(previous: AppSettings, patch: SettingsPatch): AppSettings {
  const { recovery, ...fields } = patch
  return { ...previous, ...fields, ...(recovery ? { recovery: recoverySettings({ ...recoverySettings(previous.recovery), ...recovery }) } : {}) }
}
