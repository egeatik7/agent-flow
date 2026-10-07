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
const { spawnSync, execFileSync } = require('child_process')

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
/**
 * Kapatmadan önce sürecin gerçekten bizim örnek olduğunu doğrular.
 *
 * Jeton dosyası eski olabilir ve o PID bu arada başka bir programa verilmiş olabilir; o zaman
 * "taskkill /PID" yanlış süreci kapatır. Bu yüzden süreç adı ve çalıştırılabilir yolu kontrol edilir.
 */
function pidLooksLikeOurStub(pid) {
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}" -ErrorAction SilentlyContinue; if ($p) { $par = Get-CimInstance Win32_Process -Filter "ProcessId = $($p.ParentProcessId)" -ErrorAction SilentlyContinue; $b = (Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue).MainWindowTitle; "$($p.Name)|$($p.ExecutablePath)|$(if ($par) { $par.ExecutablePath } else { '' })|$b" }`,
      ],
      { encoding: 'utf8' }
    ).trim()
    if (!out) return { ok: false, why: 'süreç yok' }
    const [name, exePath, parentPath, baslik] = out.split('|')
    // Kimlik ne adla ne de tek başına yolla doğrulanabilir: portable exe kendini geçici bir klasöre
    // açıp oradan çalışıyor ("…\Temp\<rastgele>\Nubbo Agent Studio.exe"), ürün adıyla görünüyor ve
    // masaüstündeki kopyanın yolu yalnızca BAŞLATICI stub'ın yolu. Bu yüzden sürecin kendisi ya da
    // ebeveyni bizim kopya olmalı. Aksi hâlde hiçbir şey kapatılmaz: yanlış süreci öldürmektense
    // eski örneği kapatmamak yeğdir (uyarı yazılır).
    const beklenen = exe.toLowerCase()
    const kendi = exePath ? path.resolve(String(exePath)).toLowerCase() : ''
    const ebeveyn = parentPath ? path.resolve(String(parentPath)).toLowerCase() : ''
    if (kendi && kendi === beklenen) return { ok: true, why: `yol uyuşuyor (süreç adı “${name}”)` }
    if (ebeveyn && ebeveyn === beklenen) return { ok: true, why: `ebeveyn yol uyuşuyor (portable açılım: “${name}”)` }
    // Ölçüldü: portable exe'de stub çıktıktan sonra ebeveyn ölür ve sürecin kendi yolu geçici bir
    // klasördür; o zaman ne ad ne yol ne ebeveyn uyuşur ve eski örnek HİÇ kapatılamaz — iki örnek
    // yan yana kalır, jeton hangisine denk gelirse ona bağlanılır. Kalan tek güvenilir işaret,
    // pencerenin profil damgasıdır: test örneğinin başlığında "test profili" yazar, sahibinin
    // gerçek uygulamasında yazmaz.
    if (baslik && /test profili/i.test(baslik)) return { ok: true, why: `pencere başlığı test profili (“${baslik}”)` }
    if (!kendi && !ebeveyn) return { ok: false, why: `yol okunamadı; ad “${name}” tek başına yeterli değil` }
    return { ok: false, why: `ne yol ne ebeveyn bizim kopya (kendi “${kendi || '-'}”, ebeveyn “${ebeveyn || '-'}”)` }
  } catch (e) {
    return { ok: false, why: `kimlik okunamadı: ${e && e.message ? e.message : String(e)}` }
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
    // Only kill it if the process really is our stub: a stale token means the pid may belong to
    // something else by now, and killing that would be someone else's program.
    const id = pidLooksLikeOurStub(before.pid)
    if (id.ok) {
      const killed = killTree(before.pid)
      // The stub that started it is the parent; it goes too, or a second window appears.
      console.log(`  eski örnek: pid ${before.pid} (${before.app || '?'} / ${before.build || 'damgasız'}) ${killed ? 'kapatıldı' : 'kapatılamadı'} · ${id.why}`)
    } else {
      console.log(`  eski örnek: pid ${before.pid} KAPATILMADI (${id.why}) — jeton eski olabilir.`)
    }
  } else {
    console.log('  eski örnek yok')
  }
  // Any leftover app process of this exe would start a second instance on the same profile.
  // İsimle toplu öldürme YOK. Bir kez "taskkill /IM Nubbo-test.exe" satırı vardı; kaldırıldı.
  // Ölçülen tehlike: portable exe kendini geçici klasöre açıyor ve süreç adı ürün adı oluyor, bu
  // yüzden isimle öldürmek, aynı ada/yola benzeyen BAŞKA bir örneği — sahibinin açık uygulamasını —
  // de götürebiliyor. Kapatma yalnız jetonun gösterdiği pid ile ve kimliği doğrulanarak yapılır.
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
    // Kapatma sonrası dosya hemen serbest kalmayabilir (EBUSY): kopya kısa aralıklarla tekrar
    // denenir. Ölçüldü: beş bataryalık bir turda ikinci yarı tam bu yüzden koşamamıştı.
      // Jeton eski ya da silinmişse kalan bir test örneği dosyayı kilitli tutabilir; kopya EBUSY ile
  // düşer. Kapatma ölçütü pencere damgasıdır: test örneğinin başlığında "test profili" yazar,
  // sahibinin gerçek uygulamasının başlığında yazmaz. Damga yoksa dokunulmaz.
  try {
    const bulunan = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', "Get-Process | Where-Object { $_.MainWindowTitle -like '*test profili*' } | ForEach-Object { $_.Id }"],
      { encoding: 'utf8' }
    )
    for (const ham of String(bulunan).split(/\r?\n/)) {
      const damgaPid = Number(String(ham).trim())
      if (Number.isFinite(damgaPid) && damgaPid > 0) {
        spawnSync('taskkill', ['/PID', String(damgaPid), '/T', '/F'], { stdio: 'ignore' })
        console.log(`  damgası doğrulanmış test örneği kapatıldı: pid ${damgaPid}`)
        await sleep(600)
      }
    }
  } catch {
    /* süpürme yapılamadı; kopya yine de denenir */
  }
  
  let kopyaHata = null
    for (let kopyaDenemesi = 0; kopyaDenemesi < 12; kopyaDenemesi++) {
      try {
        fs.copyFileSync(packed, exe)
        kopyaHata = null
        break
      } catch (e) {
        kopyaHata = e
        await sleep(500)
      }
    }
    if (kopyaHata) throw kopyaHata
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
      // Ölçüldü: uygulama açılırken ön planı alır ve arka plandaki bir süreç ondan ALAMAZ; canlı
      // senaryo ise fikstür penceresinin önde olmasını bekler (yoksa hedefi yanlış pencerede arar
      // ve haklı olarak bulamaz). Uygulama küçültülünce ön plan serbest kalır ve fikstür kendini öne
      // alabilir. Kapatılmaz, küçültülür: açık akış ve oturum kaybolmasın.
      // Pencere hemen hazır olmayabilir: /health cevap verdiğinde pencere henüz oluşmamışsa
      // küçültme boşa gider ve uygulama birazdan ön planı alır — canlı senaryo da hedefi kendi
      // penceresinde arar ve haklı olarak bulamaz. Canlı koşuların dalgalanmasının kökü buydu:
      // bu yüzden pencere görünene kadar kısa aralıklarla denenir.
      for (let i = 0; i < 10; i++) {
        try {
          const min = spawnSync(
            'powershell',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'dev-minimize.ps1'), '-Title', 'test profili'],
            { encoding: 'utf8' }
          )
          const son = String(min.stdout || '').trim().split('\n').filter(Boolean).pop() || ''
          if (/küçültüldü/.test(son)) {
            console.log(`  ${son.trim()}`)
            break
          }
          if (i === 9) console.log(`  (pencere küçültülemedi: ${son.trim()})`)
        } catch (e) {
          if (i === 9) console.log(`  (pencere küçültülemedi: ${e && e.message ? e.message : String(e)})`)
        }
        await sleep(1500)
      }
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
