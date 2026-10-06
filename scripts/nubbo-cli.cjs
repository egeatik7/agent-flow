#!/usr/bin/env node
/**
 * nubbo — the command line side of the tool layer (electron/tools.ts).
 *
 * Read-only tools that only need a flow file run standalone, so a flow can be inspected
 * without the app. Tools that touch the desktop need the running app; the local endpoint
 * comes in 1B, and until then they answer with a clear refusal instead of failing silently.
 *
 * Exit codes: 0 the tool answered, 2 refused, 3 the tool layer could not run.
 */
const fs = require('node:fs')
const path = require('node:path')

const dist = path.resolve(__dirname, '../dist-electron')

const USAGE = `nubbo <komut> [seçenekler]

  tools                          Araç kataloğu (hazır / sırada)
  flow     --file <akis.json>    Akışı oku: paket ağacı, döngüler, sayılar
             [--nodes]             Node listesini de yaz (id, tür, başlık, paket)
             [--kind <tur>]        Yalnız bu türdeki node'lar
             [--search <yazı>]     Başlık/komut/öğe içinde ara
             [--json]              Tam yapı
  package  --file <akis.json> --node <id>
                                 Bir paketin içini göster (aç, debug et)
  context  --file <akis.json> --node <id>
                                 Bir node'un paket yolunu ve kutu zincirini göster
  suggest  --file <akis.json>    Bir düzenleme planını denetle; ne değişeceğini yaz.
             --ops '<json>'        Planı doğrudan ver (işlem listesi)
             --ops-file <plan.json>  Planı dosyadan oku
             [--json]              Tam yapı
                                 Hiçbir şey yazmaz, akış dosyası değişmez.
  preview | step | from | state | report | stop | screen
                                 Ekrana dokunan araçlar; Nubbo açık olmalı ve Ajan
                                 sekmesinde "Dışarı açık" işaretli olmalı.
             [--node <id>] [--branch <id>] [--fast] [--debug] [--start] [--window "<başlık>"] [--image] [--timeout <ms>] [--json]
                                 --fast: yalnız ekran aşamaları (model çağrısı yok, çok daha hızlı)
                                 --debug: ilk hatalı adımda durur, o anın bağlamını saklar (report)
                                 --start: from için şart; akışı baştan çalıştırır (açık onay)

  branch list                    Açık branch'leri listele (uygulama açık olmalı)
  branch create --name "<ad>"    Kendi branch'ini aç (temel: açık tuval)
  branch diff --branch <id>      Temel tuvaline göre farkı göster (yazmaz)
  branch merge --branch <id> [--apply]
                                 Deneme herkese açık; --apply yalnız Nubbo
                                 penceresinden yapılır (CLI reddeder)
  branch drop --branch <id>      Tarifi sil (akışa dokunmaz)
  step --branch <id> --node <id> Branch'te tek adım (türetilmiş grafik)
  from --branch <id>             Branch'i çalıştır (kayıtlı akışa yazılmaz)
  edit --branch <id> --ops-file <plan.json>
                                 Branch'e düzenleme ekle (grup olarak; flow.undo ile geri)
  undo --branch <id>             Branch'teki son düzenlemeyi geri al
`

function parse(argv) {
  const opts = {}
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        opts[key] = next
        i++
      } else {
        opts[key] = true
      }
    } else {
      rest.push(a)
    }
  }
  return { opts, rest }
}

/**
 * Reads JSON the way Windows tools write it: Notepad and PowerShell save UTF-8 with a byte order
 * mark, and JSON.parse refuses the leading character with a confusing message.
 */
function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  return JSON.parse(raw)
}

function readGraph(file) {
  if (!file || typeof file !== 'string') {
    console.error('--file <akis.json> gerekli.')
    process.exit(3)
  }
  return readJson(file)
}

function toolContext(graph) {
  return {
    getGraph: () => graph,
    getSettings: () => ({}),
    log: () => {},
    isRunning: () => false,
    userStop: () => false,
    sendStep: () => {},
    permission: () => 'off',
    askApproval: async () => false,
    requestStop: () => {},
    startRun: async () => ({ ok: false }),
  }
}

/** Where the running app leaves its address and token. */
function endpointFile() {
  const base = process.env.APPDATA || ''
  const candidates = [
    path.join(base, 'xp-agent-studio', 'tool-endpoint.json'),
    path.join(base, 'Nubbo Agent Studio', 'tool-endpoint.json'),
  ]
  for (const file of candidates) {
    try {
      const info = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (info && info.port && info.token) return { port: info.port, token: info.token, pid: info.pid, file }
    } catch {
      /* try the next one */
    }
  }
  return null
}

/** A leftover token file from a closed app must not read as "the app is broken". */
function pidAlive(pid) {
  if (!pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

/** A tool that looks for a target can take minutes, so the client waits longer than it looks. */
const REQUEST_TIMEOUT_MS = 15 * 60_000

async function call(name, args) {
  const info = endpointFile()
  if (!info) {
    console.error('Nubbo açık değil ya da Ajan uç noktası kapalı. Ajan sekmesinden "Dışarı açık" işaretlenmeli.')
    process.exit(3)
  }
  if (!pidAlive(info.pid)) {
    console.error('Nubbo kapalı görünüyor (jeton dosyası önceki oturumdan kalmış). Uygulamayı aç.')
    process.exit(3)
  }
  let res
  try {
    res = await fetch(`http://127.0.0.1:${info.port}/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${info.token}` },
      body: JSON.stringify({ name, args }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (e) {
    const slow = e && (e.name === 'TimeoutError' || e.name === 'AbortError' || /fetch failed|timeout/i.test(String(e.message)))
    if (slow) {
      console.error(
        `Araç ${Math.round(REQUEST_TIMEOUT_MS / 60000)} dakikada bitmedi ve istemci vazgeçti. ` +
          'Uygulama çalışıyor olabilir ve adım hâlâ sürüyor: "state" ile durumu oku, gerekirse "stop" ile durdur. ' +
          'Bir sonraki denemede --fast kullan (yalnız ekran aşamaları, model çağrısı yok).'
      )
    } else {
      console.error(`Uç noktaya ulaşılamadı: ${e.message}`)
    }
    process.exit(3)
  }
  if (res.status === 401) {
    console.error('Jeton geçersiz; uygulama yeniden başlamış olabilir.')
    process.exit(3)
  }
  const body = await res.json().catch(() => null)
  if (!body) {
    console.error('Cevap okunamadı.')
    process.exit(3)
  }
  return body
}

function printResult(r, opts) {
  if (opts.json) {
    console.log(JSON.stringify(r, null, 2))
    return
  }
  console.log(r.message ?? '')
  if (r.target && r.target.found && typeof r.target.x === 'number') {
    console.log(`hedef: ${r.target.stage ?? '—'} · ${r.target.candidates ?? '—'} aday · (${Math.round(r.target.x)}, ${Math.round(r.target.y)})`)
  }
  if (r.loop) {
    console.log(`döngü: ${r.loop.title}${typeof r.loop.index === 'number' ? ` ${r.loop.index + 1}/${r.loop.total}` : ''}${r.loop.item ? ` · ${r.loop.item}` : ''}`)
  }
  if (r.data && r.data.steps) console.log(`adımlar: ${r.data.steps.done} tamam · ${r.data.steps.errors} hata`)
  if (Array.isArray(r.log) && r.log.length) {
    console.log('günlük:')
    for (const line of r.log.slice(-6)) console.log(`  ${line}`)
  }
}

/** A package path is a list of ids; draw it as titles once, so the tree is readable. */
function titleOf(data, id) {
  const pkg = (data.packages ?? []).find((p) => p.id === id)
  const node = (data.nodes ?? []).find((n) => n.id === id)
  return pkg?.title || node?.title || id
}

function pathLabel(data, ids) {
  return ids.length ? ids.map((id) => titleOf(data, id)).join(' › ') : 'kök'
}

function printFlow(data) {
  const nodes = data.nodes ?? []
  const loops = data.loops ?? []
  const packages = data.packages ?? []
  const kinds = nodes.reduce((m, n) => ((m[n.kind] = (m[n.kind] ?? 0) + 1), m), {})
  console.log(`Akış: ${nodes.length} node · ${packages.length} paket · ${loops.length} döngü · ${data.edges ?? 0} bağlantı`)
  console.log(`Türler: ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(', ')}`)

  if (packages.length) {
    console.log('\nPaketler (iç içe olanlar girintili):')
    for (const p of packages) {
      const inside = nodes.filter((n) => n.packagePath.includes(p.id))
      const inner = packages.filter((q) => q.packagePath.includes(p.id))
      const innerLoops = loops.filter((l) => l.packagePath.includes(p.id))
      console.log(
        `${'  '.repeat(p.packagePath.length + 1)}• ${p.title} [${p.id}] — ${inside.length} node, ${inner.length} alt paket, ${innerLoops.length} döngü` +
          (p.packagePath.length ? ` (${pathLabel(data, p.packagePath)} içinde)` : '')
      )
    }
  }

  if (loops.length) {
    console.log('\nDöngüler:')
    for (const l of loops) {
      console.log(
        `  • ${l.title} [${l.id}] — ${l.total} öğe · işaret ${(l.index ?? 0) + 1}${l.item ? ` (“${l.item}”)` : ''} · ${pathLabel(data, l.packagePath)}` +
          (l.folder ? `\n      klasör: ${l.folder}${l.templated ? ' (şablon: öğe listesi çalışırken klasörden doldurulur)' : ''}` : l.templated ? '\n      şablon: öğe listesi çalışırken doldurulur' : '') +
          (typeof l.count === 'number' ? `\n      sayım: ${l.count} tur` : '')
      )
      for (const m of l.members ?? []) {
        console.log(`      tur işi: ${m.kind.padEnd(8)} ${m.title} [${m.id}]`)
      }
    }
  }
}

function printNodes(data, opts) {
  const kind = typeof opts.kind === 'string' ? opts.kind : ''
  const needle = typeof opts.search === 'string' ? opts.search.toLocaleLowerCase('tr') : ''
  const rows = (data.nodes ?? []).filter((n) => {
    if (kind && n.kind !== kind) return false
    if (!needle) return true
    const hay = `${n.title} ${n.summary}`.toLocaleLowerCase('tr')
    return hay.includes(needle)
  })
  console.log(`\nNode'lar (${rows.length}):`)
  for (const n of rows) {
    const where = n.packagePath.length ? ` · ${pathLabel(data, n.packagePath)}` : ''
    console.log(`  ${n.kind.padEnd(9)} ${n.title} [${n.id}]${where}\n      ${n.summary}`)
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const { opts } = parse(rest)
  if (!cmd || cmd === 'help' || opts.help) {
    console.log(USAGE)
    process.exit(0)
  }

  let tools
  try {
    tools = require(path.join(dist, 'tools.js'))
  } catch (e) {
    console.error(`Araç katmanı yüklenemedi (önce "npm run build:main"): ${e.message}`)
    process.exit(3)
  }

  if (cmd === 'tools') {
    for (const t of tools.toolList()) {
      console.log(`${t.ready ? 'hazır ' : 'sırada'}  ${t.name.padEnd(15)} ${t.summary}${t.sendsInput ? '  · ekrana dokunur' : ''}`)
    }
    process.exit(0)
  }

  if (cmd === 'preview' || cmd === 'step' || cmd === 'from' || cmd === 'state' || cmd === 'report' || cmd === 'stop' || cmd === 'screen') {
    const remote = { preview: 'target.preview', step: 'step.run', from: 'run.from', state: 'run.state', report: 'run.report', stop: 'run.stop', screen: 'screen.read' }
    if (cmd === 'from' && !opts.node && !opts.start) {
      // A whole flow from the first step is never an accident.
      console.error('Baştan koşu için --start gerekir (akışın tamamı ilk adımdan çalışır). Tek node için: --node <id>.')
      process.exit(2)
    }
    const args = {}
    if (opts.node) args.nodeId = opts.node
    if (opts.branch) args.branchId = opts.branch
    if (opts.fast) args.fast = true
    if (opts.start) args.fromStart = true
    if (opts.debug) args.debug = true
    if (opts.window) args.windowTitle = opts.window
    if (opts.image) args.image = true
    if (opts.timeout) args.timeoutMs = Number(opts.timeout)
    const r = await call(remote[cmd], args)
    printResult(r, opts)
    process.exit(r && r.ok === false ? 2 : 0)
  }

  if (cmd === 'suggest') {
    const graph = readGraph(opts.file)
    let ops
    try {
      if (typeof opts['ops-file'] === 'string') ops = readJson(opts['ops-file'])
      else if (typeof opts.ops === 'string') ops = JSON.parse(opts.ops.replace(/^\uFEFF/, ''))
    } catch (e) {
      console.error(`Plan okunamadı (JSON olmalı): ${e.message}`)
      process.exit(3)
    }
    const r = await tools.callTool('flow.suggest', ops === undefined ? { graph } : { graph, ops }, toolContext(graph))
    if (opts.json) {
      console.log(JSON.stringify(r, null, 2))
      process.exit(r && r.ok === false ? 2 : 0)
    }
    console.log(r.message)
    for (const line of (r.data && r.data.lines) || []) console.log(`  ${line}`)
    if (r.data && r.data.diff) {
      const d = r.data.diff
      for (const n of d.addedNodes) console.log(`  + ${n.title} (${n.kind})`)
      for (const n of d.changedNodes) console.log(`  ~ ${n.title}: ${n.fields.join(', ')}`)
    }
    process.exit(r && r.ok === false ? 2 : 0)
  }

  if (cmd === 'branch') {
    const sub = rest.find((a) => !a.startsWith('--')) || ''
    const remote = { list: 'branch.list', create: 'branch.create', diff: 'branch.diff', merge: 'branch.merge', drop: 'branch.drop' }
    const name = remote[sub]
    if (!name) {
      console.error('branch alt komutları: list · create --name "<ad>" · diff --branch <id> · merge --branch <id> [--apply] · drop --branch <id>')
      process.exit(3)
    }
    const args = {}
    if (sub === 'create' && opts.name) args.name = opts.name
    if (sub !== 'list' && sub !== 'create') args.branchId = opts.branch
    if (sub === 'merge' && opts.apply) args.apply = true
    const r = await call(name, args)
    if (opts.json) {
      // Only the object goes out, so the answer can be piped into another tool.
      console.log(JSON.stringify(r, null, 2))
      process.exit(r && r.ok === false ? 2 : 0)
    }
    console.log(r.message)
    const rows = (r.data && r.data.branches) || []
    for (const b of rows) {
      console.log(`  ${b.branchId}  “${b.name}” · ${b.groups} düzenleme · ${b.ops} işlem · ${(b.size / 1024).toFixed(1)} KB${b.baseChanged ? ' · temeli değişmiş' : ''}${b.failed && b.failed.length ? ` · ${b.failed.length} grup uymuyor` : ''}`)
    }
    for (const line of (r.data && r.data.lines) || []) console.log(`  ${line}`)
    if (r.data && r.data.diff) console.log(`  fark: ${r.data.diff.summary}`)
    process.exit(r && r.ok === false ? 2 : 0)
  }

  if (cmd === 'edit' || cmd === 'undo') {
    let ops
    if (cmd === 'edit') {
      try {
        if (typeof opts['ops-file'] === 'string') ops = readJson(opts['ops-file'])
        else if (typeof opts.ops === 'string') ops = JSON.parse(opts.ops.replace(/^\uFEFF/, ''))
      } catch (e) {
        console.error(`Plan okunamadı (JSON olmalı): ${e.message}`)
        process.exit(3)
      }
      if (!Array.isArray(ops)) {
        console.error('--ops-file <plan.json> gerekli (işlem listesi).')
        process.exit(3)
      }
    }
    const args = { branchId: opts.branch }
    if (cmd === 'edit') args.ops = ops
    const r = await call(cmd === 'edit' ? 'flow.edit' : 'flow.undo', args)
    if (opts.json) {
      console.log(JSON.stringify(r, null, 2))
      process.exit(r && r.ok === false ? 2 : 0)
    }
    printResult(r, opts)
    for (const line of (r.data && r.data.lines) || []) console.log(`  ${line}`)
    process.exit(r && r.ok === false ? 2 : 0)
  }

  if (cmd === 'context') {
    const graph = readGraph(opts.file)
    const id = typeof opts.node === 'string' ? opts.node : ''
    const r = await tools.callTool('flow.context', { graph, nodeId: id }, toolContext(graph))
    if (!r.ok) {
      console.error(r.message)
      process.exit(3)
    }
    console.log(r.message)
    for (const l of r.loopChain ?? []) {
      const vars = l.vars ? Object.entries(l.vars).map(([k, v]) => `${k}=${v}`).join(' ') : ''
      console.log(
        `  kutu: ${l.title} [${l.id}] · öğe ${(l.index ?? 0) + 1}/${l.total}${l.item ? ` (“${l.item}”)` : ''}` +
          (l.folder ? `\n      klasör: ${l.folder}${l.templated ? ' (şablon)' : ''}` : '')
      )
      if (vars) console.log(`      ${vars}`)
    }
    process.exit(0)
  }

  if (cmd === 'flow') {
    const graph = readGraph(opts.file)
    const r = await tools.callTool('flow.read', { graph }, toolContext(graph))
    if (opts.json) {
      console.log(JSON.stringify(r, null, 2))
    } else {
      printFlow(r.data ?? {})
      if (opts.nodes || opts.kind || opts.search) printNodes(r.data ?? {}, opts)
    }
    process.exit(r.ok ? 0 : 3)
  }

  if (cmd === 'package') {
    const graph = readGraph(opts.file)
    const id = typeof opts.node === 'string' ? opts.node : ''
    const r = await tools.callTool('flow.read', { graph }, toolContext(graph))
    const data = r.data ?? {}
    const pkg = (data.packages ?? []).find((p) => p.id === id || p.title === id)
    if (!pkg) {
      console.error(`Paket bulunamadı: ${id}`)
      process.exit(3)
    }
    const inside = (data.nodes ?? []).filter((n) => n.packagePath.includes(pkg.id))
    const loops = (data.loops ?? []).filter((l) => l.packagePath.includes(pkg.id))
    console.log(`Paket: ${pkg.title} [${pkg.id}] — ${pkg.packagePath.length ? pathLabel(data, pkg.packagePath) + ' içinde' : 'kök seviyesinde'}`)
    console.log(`İçinde ${inside.length} node, ${loops.length} döngü:`)
    for (const n of inside) {
      const depth = n.packagePath.length - pkg.packagePath.length - 1
      console.log(`  ${'  '.repeat(Math.max(0, depth))}${n.kind.padEnd(9)} ${n.title} [${n.id}]\n      ${n.summary}`)
    }
    for (const l of loops) {
      console.log(`  DÖNGÜ ${l.title} — ${l.total} öğe · işaret ${(l.index ?? 0) + 1}${l.item ? ` (“${l.item}”)` : ''}`)
    }
    process.exit(0)
  }

  console.error(`Bilinmeyen komut: ${cmd}`)
  console.log(USAGE)
  process.exit(3)
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : String(e))
  process.exit(3)
})
