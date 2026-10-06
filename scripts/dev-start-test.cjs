#!/usr/bin/env node
/**
 * One clean test instance, or nothing.
 *
 * The loop needs to be sure which build it is driving. Two instances on one profile overwrite each
 * other's token file, and then a run talks to the older build without anyone noticing - which
 * happened, and looked exactly like a bug in the tool being tested.
 *
 * So this: reads the profile's token, kills the process it names together with its process tree,
 * waits for the desktop to settle, starts the freshly built exe with the profile and the build
 * stamp, and only returns once /health answers. The caller never reuses a stale token.
 *
 * Usage: node scripts/dev-start-test.cjs [profile]   (default: test)
 */
const fs = require('fs')
const path = require('path')
const http = require('http')
const { spawnSync } = require('child_process')

const root = path.join(__dirname, '..')
const profile = (process.argv[2] || 'test').trim()
if (!profile) {
  console.error('Profil adı gerekli (gerçek profil bu betikle açılmaz).')
  process.exit(2)
}
const appDir = path.join(process.env.APPDATA || '', `xp-agent-studio-${profile}`)
const tokenFile = path.join(appDir, 'tool-endpoint.json')
const exe = path.join(process.env.USERPROFILE || '', 'Desktop', 'Nubbo-test.exe')

function readToken() {
  try {
    return JSON.parse(fs.readFileSync(tokenFile, 'utf8'))
  } catch {
    return null
  }
}
function killTree(pid) {
  if (!pid) return false
  const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  return r.status === 0
}
function health(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 3000 }, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.on('error', () => resolve(false))
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const before = readToken()
  if (before?.pid) {
    const killed = killTree(before.pid)
    // The stub that started it is the parent; it goes too, or a second window appears.
    console.log(`  eski örnek: pid ${before.pid} (${before.app || '?'} / ${before.build || 'damgasız'}) ${killed ? 'kapatıldı' : 'kapatılamadı'}`)
  } else {
    console.log('  eski örnek yok')
  }
  // Any leftover app process of this exe would start a second instance on the same profile.
  spawnSync('taskkill', ['/IM', 'Nubbo-test.exe', '/T', '/F'], { stdio: 'ignore' })
  if (fs.existsSync(tokenFile)) fs.rmSync(tokenFile, { force: true })
  await sleep(3000)

  // The stamp must describe the code that was actually built, not the last commit: building a dirty
  // tree and calling it "abc1234" makes the evidence lie about what was tested.
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim() || ''
  const dirty = (spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout || '').trim().length > 0
  const build = head ? `${head}${dirty ? '-dirty' : ''}` : ''
  // Copy the fresh build in here, after the kill and before the start: doing it in the caller's
  // script is how "the exe is in use" happens, and then a stale build gets tested by accident.
  const packed = path.join(root, 'release', 'Nubbo.exe')
  if (!process.argv.includes('--no-copy')) {
    if (!fs.existsSync(packed)) {
      console.error(`  paketlenmiş exe yok: ${packed} (önce npm run pack:win)`)
      process.exit(2)
    }
    fs.copyFileSync(packed, exe)
    console.log(`  exe kopyalandı: ${path.basename(packed)} → ${exe}`)
  }
  if (!fs.existsSync(exe)) {
    console.error(`  test exe yok: ${exe}`)
    process.exit(2)
  }
  const env = { ...process.env, NUBBO_PROFILE: profile, NUBBO_BUILD: build }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawnSync('cmd', ['/c', 'start', '', exe], { env, stdio: 'ignore' })
  void child
  console.log(`  yeni örnek başlatıldı: build ${build} · profil ${profile}`)

  for (let i = 1; i <= 24; i++) {
    await sleep(2500)
    const info = readToken()
    if (info?.port && (await health(info.port))) {
      console.log(`  ✓ hazır: port ${info.port} · pid ${info.pid} · sürüm ${info.app || '?'} · build ${info.build || '(damgasız)'} · profil ${info.profile || '?'}`)
      if ((info.build || '') !== build) console.log(`  UYARI: jetonun damgası “${info.build || ''}”, beklenen “${build}” — eski örnek olabilir.`)
      process.exit(0)
    }
  }
  console.error('  ✗ uç nokta açılmadı')
  process.exit(1)
}

main().catch((e) => {
  console.error(`hata: ${e.message}`)
  process.exit(1)
})
