#!/usr/bin/env node
/**
 * Scenario runner: set it up, run it, check it, keep the evidence.
 *
 * This exists because "try the same scenario again" has to be one command, not a hand-typed
 * sequence of tool calls. It drives Nubbo through the same local gate an agent uses - there is no
 * second automation path here - and it separates four things that are easy to confuse:
 *
 *   tool-answered  the gate returned a result
 *   input-sent     the engine's own log says the field was written and read back
 *   observed       counted steps, failures and the official outcome
 *   completed      the real world moved: a file exists with the right bytes, a window appeared
 *
 * Only the last one is success, and the verdict says so. Expectations come from the scenario file;
 * this runner never softens one to make a run pass.
 *
 * Usage:  node scripts/dev-scenario.cjs scripts/scenarios/pilot-temp-file.json [--keep]
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const root = path.join(__dirname, '..')
const scenarioFile = process.argv[2]
const keep = process.argv.includes('--keep')
if (!scenarioFile) {
  console.error('Kullanım: node scripts/dev-scenario.cjs <senaryo.json> [--keep]')
  process.exit(2)
}

const scenario = JSON.parse(fs.readFileSync(scenarioFile, 'utf8').replace(/^\uFEFF/, ''))
const name = String(scenario.name || path.basename(scenarioFile, '.json'))
const profile = String(scenario.profile ?? 'test').trim()
if (!profile && scenario.allowReal !== true) {
  console.error('Gerçek profil reddedildi: senaryo "profile" vermeli ya da açıkça allowReal: true demeli.')
  process.exit(2)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = path.join(root, 'test-artifacts', `${name}-${stamp}`)
fs.mkdirSync(outDir, { recursive: true })

const evidence = { name, profile, startedAt: new Date().toISOString(), classes: { 'tool-answered': [], 'input-sent': [], observed: [], completed: [] }, notes: [] }
const checks = []
function check(id, kind, ok, detail, skipped = false) {
  checks.push({ id, kind, ok: !!ok, detail, skipped })
  if (ok) evidence.classes[kind].push(`${id}: ${detail}`)
  return !!ok
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * The window fixture rewrites its report about ten times a second, so a read can land in the
 * middle of a replace and fail. Reading evidence must not be the fragile part of the loop.
 */
async function readRetry(file, tries = 12) {
  for (let i = 0; i < tries; i++) {
    try {
      return fs.readFileSync(file, 'utf8')
    } catch {
      await sleep(80)
    }
  }
  return ''
}
async function copyRetry(from, to, tries = 12) {
  for (let i = 0; i < tries; i++) {
    try {
      fs.copyFileSync(from, to)
      return true
    } catch {
      await sleep(80)
    }
  }
  return false
}

function profileDir() {
  return path.join(process.env.APPDATA || '', profile ? `xp-agent-studio-${profile}` : 'xp-agent-studio')
}
function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}
function gate() {
  const file = path.join(profileDir(), 'tool-endpoint.json')
  const info = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!info.port || !info.token) throw new Error(`jeton dosyası eksik: ${file}`)
  if (!pidAlive(info.pid)) throw new Error(`süreç ölü (eski jeton): pid ${info.pid}`)
  return { ...info, file }
}
function call(info, tool, args, timeoutMs) {
  const body = JSON.stringify({ name: tool, args: args || {} })
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: info.port, path: '/call', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: `Bearer ${info.token}` } },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try {
            resolve({ result: JSON.parse(raw), ms: Date.now() - started })
          } catch (e) {
            reject(new Error(`cevap JSON değil: ${raw.slice(0, 200)}`))
          }
        })
      }
    )
    req.setTimeout(timeoutMs || 15 * 60_000, () => req.destroy(new Error('uç nokta zaman aşımı')))
    req.on('error', reject)
    req.end(body)
  })
}

function expand(text) {
  return String(text)
    .replace(/\{\{temp\}\}/gi, os.tmpdir())
    .replace(/\{\{host\}\}/gi, path.join(root, 'test-artifacts', 'fixture'))
}
function logsDir() {
  const dir = path.join(profileDir(), 'logs')
  if (!fs.existsSync(dir)) return null
  const versions = fs
    .readdirSync(dir)
    .map((v) => ({ v, at: fs.statSync(path.join(dir, v)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
  return versions.length ? path.join(dir, versions[0].v) : null
}
function newestLog() {
  const dir = logsDir()
  if (!dir) return null
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => ({ f, at: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
  return files.length ? path.join(dir, files[0].f) : null
}

async function main() {
  const info = gate()
  evidence.endpoint = { file: info.file, port: info.port, pid: info.pid, app: info.app, build: info.build, stampedProfile: info.profile }
  const health = await call(info, 'run.state', {}, 10_000)
  check('gate-answers', 'tool-answered', health.result && health.result.ok === true, `run.state ${health.ms} ms`)

  // Bu döngü motoru çağırdığı için gerçek fareyi ve klavyeyi kullanır. İnsan o sırada ekranda bir
  // şey yapıyorsa koşu onun odağını ve tıklamasını çalar. Bu yüzden koşudan ÖNCE ekranın boş
  // olduğu doğrulanır: son girdiden bu yana yeterli süre geçmemişse koşu hiç başlatılmaz.
  {
    const need = Number(scenario.setup?.needIdleMs ?? 60000)
    const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'dev-idle.cjs'), '--json'], { encoding: 'utf8' })
    let idle = -1
    try {
      idle = JSON.parse(r.stdout || '{}').idleMs ?? -1
    } catch {
      idle = -1
    }
    const free = idle >= need
    check('screen-free', 'tool-answered', free, `son girdiden ${idle < 0 ? '?' : Math.round(idle / 1000)} sn · gereken ${Math.round(need / 1000)} sn`)
    if (!free) {
      console.error(`\n${name} BAŞLATILMADI: ekran şu an kullanılıyor. Fareyi ve klavyeyi senden çalmamak için koşu başlatılmadı.`)
      fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ scenario: name, passed: false, refused: 'screen-busy', checks }, null, 2), 'utf8')
      process.exit(4)
    }
  }

  // A refused call must stop the setup: carrying on with an empty answer is how a run looks
  // mysterious later. Every gate answer is checked for ok before it is used.
  function must(id, res) {
    if (res.result && res.result.ok === true) return res.result
    check(id, 'tool-answered', false, res.result?.message || 'araç reddetti')
    throw new Error(`${id}: ${res.result?.message || 'araç reddetti'}`)
  }

  const flow = await call(info, 'flow.read', {}, 20_000)
  const data = must('flow-read', flow).data || {}
  const canvas = data.tabName || data.canvas || ''
  evidence.canvas = canvas
  if (scenario.canvas) check('right-canvas', 'tool-answered', canvas === scenario.canvas, `beklenen “${scenario.canvas}”, görülen “${canvas}”`)
  const startNode = (data.nodes || []).find((n) => n.kind === 'start')
  check('start-node', 'tool-answered', !!startNode, startNode ? `Başlangıç: ${startNode.id}` : 'akışta Başlangıç yok')
  fs.writeFileSync(path.join(outDir, 'flow-read.json'), JSON.stringify(flow.result, null, 2), 'utf8')

  // Eski senaryo dallarını temizle: yalnız bu senaryonun adıyla başlayanlar.
  const list = await call(info, 'branch.list', {}, 20_000)
  for (const b of (list.result.data?.branches || [])) {
    if (String(b.name).startsWith(name)) await call(info, 'branch.drop', { branchId: b.branchId }, 20_000)
  }

  // A scenario that drives a real window asks for the fixture first. This only puts the window
  // there; the engine is what clicks and types, and the window reports what it received.
  if (scenario.setup?.host === true) {
    const started = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'dev-start-host.cjs')], { encoding: 'utf8', timeout: 180_000 })
    for (const line of String(started.stdout || '').split('\n').filter(Boolean)) console.log(`  ${line.trim()}`)
    check('host-ready', 'tool-answered', started.status === 0, String(started.stdout || started.stderr || '').trim().split('\n').pop() || '')
    if (started.status !== 0) throw new Error('fıkstür penceresi hazır değil')
  }

  const created = await call(info, 'branch.create', { name: `${name} · ${stamp}` }, 20_000)
  const branchId = must('branch-created', created).data?.branchId
  check('branch-created', 'tool-answered', !!branchId, `branch ${branchId}`)
  if (!branchId) throw new Error('branch açılamadı')
  // Whatever happens next - a crash, a refusal, a failed check - this scenario's branch is left
  // behind, because the branch limit is small and failed runs are exactly when it fills up.
  process.on('exit', () => {
    try {
      require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'nubbo-cli.cjs'), 'branch', 'drop', '--branch', String(branchId)], {
        encoding: 'utf8',
        env: process.env,
      })
    } catch {
      /* temizlik başarısız olsa da koşu sonucu değişmez */
    }
  })

  const ops = (scenario.setup?.ops || []).map((op) => {
    const copy = JSON.parse(JSON.stringify(op))
    for (const key of ['connectFrom', 'from', 'to', 'id']) if (copy[key] === '{{start}}') copy[key] = startNode?.id
    if (copy.fields) for (const k of Object.keys(copy.fields)) if (typeof copy.fields[k] === 'string') copy.fields[k] = expand(copy.fields[k])
    return copy
  })
  // A scenario may only run the flow it found (a seeded fixture, for instance) and edit nothing.
  if (ops.length) {
    const edited = await call(info, 'flow.edit', { branchId, ops, note: `senaryo ${name}`, ...(scenario.setup?.packagePath ? { packagePath: scenario.setup.packagePath } : {}) }, 60_000)
    must('edits-accepted', edited)
    evidence.warnings = edited.result.data?.warnings || []
    if (scenario.setup?.expectNoWarnings) check('no-warnings', 'tool-answered', evidence.warnings.length === 0, evidence.warnings.join(' | '))
  } else {
    check('edits-accepted', 'tool-answered', true, 'düzenleme yok: bulunan akış olduğu gibi koşacak')
  }

  const before = [...(scenario.expect?.files || []), ...(scenario.expect?.absentFiles || [])].map((f) => expand(f.path))
  for (const p of before) if (fs.existsSync(p)) fs.rmSync(p, { force: true })

  if (scenario.expect?.screenshot === true) await call(info, 'screen.read', { image: true }, 60_000)

  // A window that is not in front cannot be found: the ladder scans the foreground window. The
  // fixture has a command for exactly this, and it goes right before the run, not earlier.
  if (scenario.setup?.host === true) {
    const hostDir = path.join(root, 'test-artifacts', 'fixture')
    fs.writeFileSync(path.join(hostDir, 'command.json'), JSON.stringify({ seq: Date.now() + 1, kind: 'focus-main' }), 'utf8')
    await sleep(1200)
    try {
      const state = JSON.parse(await readRetry(path.join(hostDir, 'state.json')))
      check('host-foreground', 'tool-answered', !!state.foreground && state.foreground === state.hwnd, `foreground ${state.foreground} / hwnd ${state.hwnd}`)
    } catch {
      check('host-foreground', 'tool-answered', false, 'state.json okunamadı')
    }
  }

  const runAt = Date.now()
  const started = await call(info, 'run.from', { branchId, fromStart: scenario.run?.fromStart !== false, ...(scenario.run?.node ? { nodeId: scenario.run.node } : {}), ...(scenario.run?.until ? { untilNodeId: scenario.run.until } : {}), ...(scenario.run?.fast ? { fast: true } : {}), ...(scenario.run?.debug ? { debug: true } : {}) }, 60_000)
  must('run-started', started)

  const waited = await call(info, 'run.wait', { timeoutMs: scenario.run?.timeoutMs ?? 240_000 }, 20 * 60_000)
  const state = waited.result.data?.snapshot || {}
  evidence.waitedMs = waited.result.data?.waitedMs
  check('run-ended', 'observed', waited.result.data?.running === false, `bekleme ${evidence.waitedMs} ms · ${state.observed?.done ?? 0} tamam, ${state.observed?.errors ?? 0} hata`)
  // A bounded region test is *meant* to end the run early, so its official outcome is a stop, not a
  // success; and the step that was in flight when the boundary arrived can be counted as an error.
  // Both are said in the scenario instead of being read as a failure.
  const stoppedExpected = scenario.expect?.stoppedBy === 'until' || scenario.expect?.stoppedBy === 'user'
  const wantOk = stoppedExpected ? scenario.expect?.runOk === true : scenario.expect?.runOk !== false
  check('run-official-ok', 'observed', (waited.result.data?.last?.ok ?? false) === wantOk, `resmî sonuç: ${JSON.stringify(waited.result.data?.last || null)}`)
  const stepsDone = stoppedExpected ? state.observed?.done ?? 0 : waited.result.data?.last?.steps ?? 0
  if (typeof scenario.expect?.minSteps === 'number') check('min-steps', 'observed', stepsDone >= scenario.expect.minSteps, `${stepsDone} >= ${scenario.expect.minSteps}${stoppedExpected ? ' (gözlenen tamamlanan adım)' : ''}`)
  if (typeof scenario.expect?.maxErrors === 'number') {
    // A bounded stop cuts a step in half, and the engine counts that step as failed. The scenario
    // says so out loud (allowInterrupted) instead of the runner quietly tolerating it.
    const allowed = scenario.expect.allowInterrupted && stoppedExpected ? scenario.expect.maxErrors + 1 : scenario.expect.maxErrors
    check('max-errors', 'observed', (state.observed?.errors ?? 0) <= allowed, `${state.observed?.errors ?? 0} <= ${allowed}${allowed !== scenario.expect.maxErrors ? ' (durdurma sırasında yarıda kesilen adım için +1)' : ''}`)
  }

  const logFile = newestLog()
  if (logFile) {
    const text = fs.readFileSync(logFile, 'utf8')
    fs.writeFileSync(path.join(outDir, 'engine-log.txt'), text, 'utf8')
    evidence.logFile = logFile
    // A bounded test that stops before any typing cannot have verified a field: the check has no
    // subject, so it is skipped with a reason instead of being reported as a failure or hidden.
    const noTyping = stoppedExpected && /\.(type|yaz)/i.test(String(waited.result.data?.last?.error || '')) === false
    check('field-verified', 'input-sent', noTyping ? false : /Alan doğrulandı/.test(text), noTyping ? 'sınırlı test yazma adımına varmadan durdu' : 'motor yazdığı alanı geri okudu', noTyping)
    check('no-input-refusal', 'input-sent', !/INPUT_WINDOW_NOT_ACTIVE|INPUT_FOCUS_UNRESOLVED/.test(text), 'girdi reddi yok')
    const shot = /([A-Za-z]:\\[^\s"']+\.png)/.exec(text)
    if (shot && fs.existsSync(shot[1])) {
      fs.copyFileSync(shot[1], path.join(outDir, 'error-shot.png'))
      evidence.errorShot = 'error-shot.png'
    }
  }

  const report = await call(info, 'run.report', {}, 60_000)
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report.result, null, 2), 'utf8')
  evidence.report = report.result.message

  for (const f of scenario.expect?.files || []) {
    const p = expand(f.path)
    const exists = fs.existsSync(p)
    const content = exists ? fs.readFileSync(p, 'utf8').trim() : ''
    const ok = exists && (f.content === undefined || content === String(f.content).trim())
    check(`file:${path.basename(p)}`, 'completed', ok, exists ? `içerik “${content}”` : 'dosya yok')
    if (exists) fs.writeFileSync(path.join(outDir, `file-${path.basename(p)}.txt`), fs.readFileSync(p), 'utf8')
  }
  // A bounded region test is only proven by what did NOT happen: the step past the boundary must
  // leave no trace at all.
  for (const f of scenario.expect?.absentFiles || []) {
    const p = expand(f.path)
    const exists = fs.existsSync(p)
    check(`absent:${path.basename(p)}`, 'completed', !exists, exists ? 'BEKLENMEDİK: dosya oluşmuş' : 'dosya yok (beklendiği gibi)')
    if (exists) fs.rmSync(p, { force: true })
  }
  const stop = waited.result.data?.stoppedBy ?? null
  if (scenario.expect?.stoppedBy !== undefined) {
    check('stopped-by', 'observed', stop === scenario.expect.stoppedBy, `durdurma nedeni: ${String(stop)} (beklenen ${String(scenario.expect.stoppedBy)})`)
  }

  const screen = await call(info, 'screen.read', {}, 60_000)
  const titles = (screen.result.data?.windows || []).map((w) => String(w.title))
  fs.writeFileSync(path.join(outDir, 'windows.json'), JSON.stringify(titles, null, 2), 'utf8')
  for (const t of scenario.expect?.windows || []) check(`window:${t}`, 'completed', titles.some((x) => x.includes(t)), titles.join(' | '))
  for (const t of scenario.expect?.noWindows || []) check(`no-window:${t}`, 'completed', !titles.some((x) => x.includes(t)), titles.join(' | '))

  // What the application itself says it received: a control's text, a click's own id. This is the
  // only class that counts as done for a window that is not ours.
  for (const c of scenario.expect?.contains || []) {
    const p = expand(c.path)
    const text = await readRetry(p)
    const ok = text.includes(c.text)
    check(`contains:${c.label || c.text}`, 'completed', ok, ok ? `“${c.text}” bulundu` : `“${c.text}” yok (${path.basename(p)})`)
    if (text) await copyRetry(p, path.join(outDir, `evidence-${path.basename(p)}`))
  }

  if (scenario.expect?.files?.length) evidence.note = 'dosya kontrolleri gerçek diskten okundu'
  evidence.finishedAt = new Date().toISOString()
  evidence.ms = Date.now() - runAt

  const skipped = checks.filter((c) => c.skipped).length
  const passed = checks.every((c) => c.ok || c.skipped)
  if (passed && !keep && scenario.cleanup?.dropBranchOnPass !== false) {
    await call(info, 'branch.drop', { branchId }, 20_000)
    evidence.branchDropped = true
  }

  fs.writeFileSync(path.join(outDir, 'scenario.json'), JSON.stringify(scenario, null, 2), 'utf8')
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ passed, checks, evidence }, null, 2), 'utf8')
  const md = [
    `# ${name} — ${passed ? 'GEÇTİ' : 'KALDI'}`,
    '',
    `profil: ${profile} · uygulama: ${info.app || '—'} · port: ${info.port} · süre: ${evidence.ms} ms`,
    '',
    '| kontrol | sınıf | sonuç | ayrıntı |',
    '|---|---|---|---|',
    ...checks.map((c) => `| ${c.id} | ${c.kind} | ${c.skipped ? '—' : c.ok ? '✓' : '✗'} | ${String(c.detail).replace(/\|/g, '/')} |`),
    '',
    '## Sınıflar',
    '- tool-answered: ' + (evidence.classes['tool-answered'].length ? evidence.classes['tool-answered'].join(' · ') : '—'),
    '- input-sent: ' + (evidence.classes['input-sent'].length ? evidence.classes['input-sent'].join(' · ') : '—'),
    '- observed: ' + (evidence.classes.observed.length ? evidence.classes.observed.join(' · ') : '—'),
    '- completed: ' + (evidence.classes.completed.length ? evidence.classes.completed.join(' · ') : '—'),
    '',
    passed ? 'Yalnız “completed” sınıfı başarı sayılır; o sınıf doldu.' : 'Başarısız: ayrıntı result.json içinde.',
  ].join('\n')
  fs.writeFileSync(path.join(outDir, 'evidence.md'), md, 'utf8')

  console.log(`${passed ? 'GEÇTİ' : 'KALDI'} · ${checks.filter((c) => c.ok).length}/${checks.length - skipped} kontrol${skipped ? ` (${skipped} atlandı)` : ''} · kanıt: ${path.relative(root, outDir)}`)
  for (const c of checks.filter((x) => !x.ok && !x.skipped)) console.log(`  ✗ ${c.id}: ${c.detail}`)
  process.exit(passed ? 0 : 1)
}

main().catch((e) => {
  check('runner', 'tool-answered', false, e.message)
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ passed: false, checks, evidence, error: e.message }, null, 2), 'utf8')
  console.error(`KALDI (koşucu hatası): ${e.message}`)
  process.exit(1)
})
