/**
 * Tek ekranda döngünün durumu: "hangi örneğe bağlıyım, hangi build, dal temiz mi, son senaryolar
 * ne dedi, ekran boş mu". Bu oturumda aynı bilgileri her seferinde yeniden türetmek zaman kaybı ve
 * yanlış okuma üretti (boş ayrıştırma, eski jeton, damgasız build); burası tek doğru kaynak.
 *
 * Kullanım: node scripts/dev-status.cjs [profil]
 * Salt okunur: hiçbir koşu başlatmaz, ekrana dokunmaz.
 */
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const profile = (process.argv[2] || 'test').trim()
const line = (s) => console.log(s)

function sh(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', cwd: root, ...opts }).trim()
  } catch (e) {
    return String(e.stdout || e.message || '').trim()
  }
}

line(`── döngü durumu · profil “${profile}” ─────────────────────`)

const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
const sha = sh('git', ['rev-parse', '--short', 'HEAD'])
const dirty = sh('git', ['status', '--porcelain']).length > 0
const ahead = sh('git', ['rev-list', '--count', 'main..HEAD']) || '?'
line(`  dal           : ${branch} · ${sha}${dirty ? ' · KİRLİ (commit edilmemiş değişiklik var)' : ' · temiz'}`)
line(`  main'e göre   : ${ahead} commit ileride · main'e merge edilmedi`)

const runDir = profile === 'test' ? path.join(process.env.APPDATA, 'xp-agent-studio-test') : path.join(process.env.APPDATA, 'xp-agent-studio')
const epFile = path.join(runDir, 'tool-endpoint.json')
if (!fs.existsSync(epFile)) line('  uç nokta     : yok (örnek kapalı)')
else {
  const ep = JSON.parse(fs.readFileSync(epFile, 'utf8'))
  let alive = false
  try {
    process.kill(ep.pid, 0)
    alive = true
  } catch {
    alive = false
  }
  line(`  uç nokta     : port ${ep.port} · pid ${ep.pid} ${alive ? '(yaşıyor)' : '(ÖLÜ — jeton eski oturumdan)'} · sürüm ${ep.version || '?'} · build ${ep.build || 'damgasız'} · profil ${ep.profile || '?'}`)
  if ((ep.build || '') !== sha) line(`  UYARI        : jetonun damgası “${ep.build || ''}”, dalınki “${sha}” — eski build olabilir.`)
}

const idle = (() => {
  try {
    return JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'dev-idle.cjs'), '--json'], { encoding: 'utf8' })).idleMs
  } catch (e) {
    try {
      return JSON.parse(String(e.stdout || '{}')).idleMs ?? -1
    } catch {
      return -1
    }
  }
})()
line(`  ekran        : son girdiden ${idle < 0 ? '?' : Math.round(idle / 1000)} sn ${idle >= 60000 ? '(boş)' : '(KULLANILIYOR — koşu başlatılmaz)'}`)

const art = path.join(root, 'test-artifacts')
if (fs.existsSync(art)) {
  const dirs = fs
    .readdirSync(art)
    .filter((d) => !d.startsWith('fixture'))
    .map((d) => ({ d, t: fs.statSync(path.join(art, d)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(0, 5)
  line('  son senaryolar:')
  for (const { d } of dirs) {
    let verdict = '?'
    try {
      const r = JSON.parse(fs.readFileSync(path.join(art, d, 'result.json'), 'utf8'))
      verdict = r.refused === 'screen-busy' ? 'başlatılmadı (ekran meşgul)' : r.passed ? 'GEÇTİ' : 'KALDI'
    } catch {
      /* sonuç dosyası yok */
    }
    line(`    ${d} → ${verdict}`)
  }
}
line('────────────────────────────────────────────────')
