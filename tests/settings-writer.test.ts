import { expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../electron/graph-types'
import { mergeSettingsPatch, type SettingsPatch } from '../electron/settings-patch'
import { SettingsWriter, settingsDelta } from '../src/lib/settings-writer'

it('starts saving immediately and coalesces only pending edits while a disk write is busy', async () => {
  let stored = structuredClone(DEFAULT_SETTINGS)
  const requests: SettingsPatch[] = [], complete: (() => void)[] = []
  const write = vi.fn((patch: SettingsPatch) => new Promise<typeof stored>(resolve => {
    requests.push(patch); complete.push(() => { stored = mergeSettingsPatch(stored, patch); resolve(stored) })
  }))
  const writer = new SettingsWriter(write, () => {}, () => {})
  void writer.enqueue({ model: 'A' })
  await Promise.resolve()
  expect(requests).toEqual([{ model: 'A' }])
  void writer.enqueue({ model: 'B', recovery: { task: 'task' } })
  void writer.enqueue({ model: 'C', recovery: { model: 'recovery-model' } })
  complete[0](); await Promise.resolve(); await Promise.resolve()
  expect(requests[1]).toEqual({ model: 'C', recovery: { task: 'task', model: 'recovery-model' } })
  complete[1](); expect(await writer.flush()).toBe(true)
  expect(stored).toMatchObject({ model: 'C', recovery: { task: 'task', model: 'recovery-model' } })
})
it('a failed recovery task is not marked saved by a subsequent successful model-only change', async () => {
  const status = vi.fn()
  const write = vi.fn().mockRejectedValueOnce(new Error('disk failure')).mockResolvedValue(DEFAULT_SETTINGS)
  const writer = new SettingsWriter(write, () => {}, status)
  await writer.enqueue({ recovery: { task: 'task' } })
  await writer.enqueue({ recovery: { model: 'B' } })
  expect(await writer.flush()).toBe(false)
  expect(status.mock.calls.at(-1)?.[1]).toEqual(['recovery.task'])
  await writer.enqueue({ recovery: { task: 'task' } })
  expect(await writer.flush()).toBe(true)
})
it('sends changed recovery fields without resetting permissions or retrying model revisions', () => {
  const before = structuredClone(DEFAULT_SETTINGS)
  const after = { ...before, modelRevision: 100, recovery: { ...before.recovery!, task: 'new task' } }
  expect(settingsDelta(before, after)).toEqual({ recovery: { task: 'new task' } })
})
