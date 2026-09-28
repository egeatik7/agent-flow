// electron-builder skips editing the Windows exe on non-Windows hosts (no rcedit/wine).
// Write the app icon into the packed exe with resedit so the taskbar and Alt+Tab show it too.
const fs = require('fs')
const path = require('path')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const ResEdit = await import('resedit')
  const { NtExecutable, NtExecutableResource, Resource, Data } = ResEdit
  const exeName = `${context.packager.appInfo.productFilename}.exe`
  const exePath = path.join(context.appOutDir, exeName)
  const iconPath = path.join(context.packager.projectDir, 'resources', 'icon.ico')
  const exe = NtExecutable.from(fs.readFileSync(exePath))
  const res = NtExecutableResource.from(exe)
  const iconFile = Data.IconFile.from(fs.readFileSync(iconPath))
  const groups = Resource.IconGroupEntry.fromEntries(res.entries)
  const lang = groups[0]?.lang ?? 1033
  const id = groups[0]?.id ?? 1
  Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    id,
    lang,
    iconFile.icons.map((i) => i.data)
  )
  res.outputResource(exe)
  fs.writeFileSync(exePath, Buffer.from(exe.generate()))
  console.log(`  • icon written into ${exeName}`)
}
