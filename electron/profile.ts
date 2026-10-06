/**
 * Which profile this instance uses.
 *
 * The app keeps its flows, its logs and its local endpoint token under one folder. A second
 * instance must never share that folder: two writers on the same store is how a test run would
 * quietly change the flows a person is working on. A profile name puts an instance on its own
 * folder, so developing and testing Nubbo with Nubbo cannot reach the real one.
 *
 * This lives on its own, away from Electron, so the rule can be tested directly.
 */
export function profileDirName(profile: string | undefined): string {
  const clean = String(profile ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
  return clean ? `xp-agent-studio-${clean}` : 'xp-agent-studio'
}

/** True when this instance is not the person's own one. */
export function isTestProfile(profile: string | undefined): boolean {
  return String(profile ?? '').trim().length > 0
}

/**
 * Where electron-store keeps its file for this instance.
 *
 * `undefined` means "leave it exactly where it has always been": the real profile must not move,
 * or its flows would look lost after an update. A test profile gets its own folder inside its own
 * userData instead, because two writers on one store is how a test would edit real flows.
 */
export function storeCwd(profile: string | undefined, userData: string): string | undefined {
  return isTestProfile(profile) ? userData : undefined
}
