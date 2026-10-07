/**
 * Derleme damgasını EXE'nin İÇİNE yazar.
 *
 * Neden: damga uzun süre açılış anındaki Git SHA'sından (NUBBO_BUILD) alınıyordu. Böylece eski bir
 * EXE, yeni koddan üretilmiş gibi damgalanabiliyordu — kanıt, neyi sınadığı konusunda yalan
 * söylüyordu. Damga artık **paketleme sırasında** dosyaya yazılır ve uygulama onu kendi içinden
 * okur; ortam değişkeni yalnızca yedek kalır (geliştirme koşuları için).
 *
 * Çıktı: resources/build.json  →  pakete extraResources ile build.json olarak girer.
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

const sha = git(['rev-parse', '--short', 'HEAD'])
const dirty = git(['status', '--porcelain']).length > 0
let version = ''
try {
  version = require(path.join(root, 'package.json')).version
} catch {
  version = ''
}

const stamp = {
  build: sha ? `${sha}${dirty ? '-dirty' : ''}` : '',
  sha,
  dirty,
  version,
  at: new Date().toISOString(),
}

const out = path.join(root, 'resources', 'build.json')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(stamp, null, 2) + '\n', 'utf8')
console.log(`  damga yazıldı: ${out} → build ${stamp.build || '(yok)'} · sürüm ${version || '?'}${dirty ? ' (ağaç kirli)' : ''}`)
