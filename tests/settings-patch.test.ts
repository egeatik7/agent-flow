import { expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../electron/graph-types'
import { DEFAULT_RECOVERY } from '../electron/recovery-settings'
import { mergeSettingsPatch } from '../electron/settings-patch'
it('saving only recovery models preserves the secret, permissions, prompt and enabled state', () => {
  const previous = { ...DEFAULT_SETTINGS, recovery: { ...DEFAULT_RECOVERY, enabled: true, apiKey: 'fixture-secret', allowCode: true, instructions: 'custom instructions' } }
  const next = mergeSettingsPatch(previous, { recovery: { model: 'B', backups: [] } })
  expect(next.recovery).toMatchObject({ enabled: true, apiKey: 'fixture-secret', allowCode: true, instructions: 'custom instructions', model: 'B', backups: [] })
  expect(previous.recovery.model).toBe(DEFAULT_RECOVERY.model)
})
