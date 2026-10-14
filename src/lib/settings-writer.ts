import type { AppSettings } from '../types'
import type { SettingsPatch } from '../../electron/settings-patch'

export function settingsDelta(before: AppSettings, after: AppSettings): SettingsPatch {
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(after) as (keyof AppSettings)[]) {
    if (key === 'modelRevision' || JSON.stringify(before[key]) === JSON.stringify(after[key])) continue
    if (key === 'recovery' && after.recovery) {
      patch.recovery = Object.fromEntries(Object.entries(after.recovery).filter(([name, value]) => JSON.stringify(before.recovery?.[name as keyof NonNullable<AppSettings['recovery']>]) !== JSON.stringify(value)))
    } else patch[key] = after[key]
  }
  return patch as SettingsPatch
}

const patchKeys = (patch: SettingsPatch): string[] => Object.keys(patch).flatMap(key => key === 'recovery' ? Object.keys(patch.recovery ?? {}).map(name => `recovery.${name}`) : [key])

/** No debounce: write immediately; while IPC is busy keep only the latest pending values. */
export class SettingsWriter {
  private pending: SettingsPatch = {}
  private task: Promise<void> | null = null
  private failed = new Set<string>()
  constructor(private readonly write: (patch: SettingsPatch) => Promise<AppSettings>,
    private readonly saved: (settings: AppSettings, patch: SettingsPatch) => void,
    private readonly status: (pending: boolean, failedKeys: string[], error?: unknown) => void) {}
  enqueue(patch: SettingsPatch): Promise<void> {
    this.pending = { ...this.pending, ...structuredClone(patch), ...(patch.recovery ? { recovery: { ...this.pending.recovery, ...patch.recovery } } : {}) }
    this.status(true, [...this.failed])
    this.start()
    return this.task!
  }
  private start(): void {
    if (this.task || !Object.keys(this.pending).length) return
    this.task = Promise.resolve().then(() => this.drain()).finally(() => {
      this.task = null
      this.start() // Catch an edit arriving between drain completion and this finalizer.
    })
  }
  async flush(): Promise<boolean> {
    while (this.task) await this.task
    return this.failed.size === 0
  }
  private async drain(): Promise<void> {
    while (Object.keys(this.pending).length) {
      const patch = this.pending; this.pending = {}
      try {
        const settings = await this.write(patch)
        patchKeys(patch).forEach(key => this.failed.delete(key))
        this.saved(settings, patch)
        this.status(Object.keys(this.pending).length > 0, [...this.failed])
      } catch (error) {
        patchKeys(patch).forEach(key => this.failed.add(key))
        this.status(Object.keys(this.pending).length > 0, [...this.failed], error)
      }
    }
  }
}
