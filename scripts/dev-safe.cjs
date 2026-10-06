/**
 * Masaüstüne dokunan her koşu için TEK kapı.
 *
 * Bu döngü motoru çağırır, motor da gerçek fareyi ve klavyeyi kullanır. İnsan o sırada bilgisayarda
 * bir şey yapıyorsa koşu onun odağını ve tıklamasını çalar — bu bir kez yaşandı ve bir daha
 * olmaması için kural koda gömüldü: koşu ancak son girdiden yeterince süre geçtiyse başlar.
 *
 * Kullanım:
 *   node scripts/dev-safe.cjs [--need 60000] [--yes] -- <komut> [argümanlar]
 *
 * Örnek:
 *   node scripts/dev-safe.cjs -- node scripts/nubbo-cli.cjs from --start --debug --fast
 *
 * --yes verilirse ekran meşgulken de koşar (bilerek, açıkça istendiğinde).
 */
const { spawnSync, execFileSync } = require('child_process')
const path = require('path')

const argv = process.argv.slice(2)
const sep = argv.indexOf('--')
if (sep < 0 || sep === argv.length - 1) {
  console.error('Kullanım: node scripts/dev-safe.cjs [--need ms] [--yes] -- <komut> [argümanlar]')
  process.exit(2)
}
const opts = argv.slice(0, sep)
const cmd = argv.slice(sep + 1)
const needIdx = opts.indexOf('--need')
const need = needIdx >= 0 ? Number(opts[needIdx + 1]) : 60000
const force = opts.includes('--yes')

function idleMs() {
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'dev-idle.cjs'), '--json'], { encoding: 'utf8' })
    return JSON.parse(out).idleMs
  } catch (e) {
    try {
      return JSON.parse(String(e.stdout || '{}')).idleMs ?? -1
    } catch {
      return -1
    }
  }
}

const idle = idleMs()
const free = idle >= need
if (!free && !force) {
  console.error(`✗ Masaüstü koşusu BAŞLATILMADI: son girdiden ${idle < 0 ? '?' : Math.round(idle / 1000)} sn geçti, ${Math.round(need / 1000)} sn gerekiyor.`)
  console.error('  İnsanın faresini ve klavyesini çalmamak için bekleniyor. Bilerek istiyorsan --yes ekle.')
  process.exit(4)
}
console.log(`▶ masaüstü koşusu başlıyor (son girdiden ${idle < 0 ? '?' : Math.round(idle / 1000)} sn${force && !free ? ' · --yes ile zorlandı' : ''})`)
console.log(`  ${cmd.join(' ')}`)
const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', env: process.env, cwd: process.cwd() })
console.log(`■ bitti (çıkış ${r.status ?? 'sinyal'})`)
process.exit(r.status ?? 1)
