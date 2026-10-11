const fs = require('node:fs')
const path = require('node:path')
function assertScenarioFile(file, roots) {
  const absolute = path.resolve(file)
  const root = roots.map(r => path.resolve(r)).find(r => {
    const relative = path.relative(r, absolute)
    return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
  })
  if (!root) throw new Error(`Senaryo dosyası izinli test kökünün dışında: ${file}`)
  let current = root
  // Reject junctions/symlinks on the root or any path component, including the file.
  for (const component of ['', ...path.relative(root, absolute).split(path.sep)]) {
    if (component) current = path.join(current, component)
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Senaryo yolu sembolik bağlantı içeriyor: ${file}`) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  // Also reject aliased ancestors of the approved root.
  for (let parent = path.dirname(root); parent !== path.dirname(parent); parent = path.dirname(parent)) {
    try { if (fs.lstatSync(parent).isSymbolicLink()) throw new Error(`Test kökü sembolik bağlantı içeriyor: ${root}`) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  if (fs.existsSync(absolute) && !fs.lstatSync(absolute).isFile()) throw new Error(`Senaryo beklentisi normal dosya olmalı: ${file}`)
  return absolute
}
module.exports = { assertScenarioFile }
