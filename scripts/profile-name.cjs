/** Same profile directory contract as electron/profile.ts; covered together by regression tests. */
function profileDirName(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return 'xp-agent-studio'
  const clean = raw.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '')
  return clean ? `xp-agent-studio-${clean}` : 'xp-agent-studio-gecersiz-profil'
}
module.exports = { profileDirName }
