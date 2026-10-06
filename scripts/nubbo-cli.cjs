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
  preview | step | from | state | stop | screen
                                 Ekrana dokunan araçlar; Nubbo açık olmalı ve Ajan
                                 sekmesinde "Dışarı açık" işaretli olmalı.
             [--node <id>] [--window "<başlık>"] [--image] [--timeout <ms>] [--json]
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

function readGraph(file) {
  if (!file || typeof file !== 'string') {
    console.error('--file <akis.json> gerekli.')
    process.exit(3)
  }
  const raw = fs.readFileSync(file, 'utf8')
  return JSON.parse(raw)
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
      if (info && info.port && info.token) return { port: info.port, token: info.token, file }
    } catch {
      /* try the next one */
    }
  }
  return null
}

async function call(name, args) {
  const info = endpointFile()
  if (!info) {
    console.error('Nubbo açık değil ya da Ajan uç noktası kapalı. Ajan sekmesinden "Dışarı açık" işaretlenmeli.')
    process.exit(3)
  }
  let res
  try {
    res = await fetch(`http://127.0.0.1:${info.port}/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${info.token}` },
      body: JSON.stringify({ name, args }),
    })
  } catch (e) {
    console.error(`Uç noktaya ulaşılamadı: ${e.message}`)
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

  if (cmd === 'preview' || cmd === 'step' || cmd === 'from' || cmd === 'state' || cmd === 'stop' || cmd === 'screen') {
    const remote = { preview: 'target.preview', step: 'step.run', from: 'run.from', state: 'run.state', stop: 'run.stop', screen: 'screen.read' }
    const args = {}
    if (opts.node) args.nodeId = opts.node
    if (opts.window) args.windowTitle = opts.window
    if (opts.image) args.image = true
    if (opts.timeout) args.timeoutMs = Number(opts.timeout)
    const r = await call(remote[cmd], args)
    printResult(r, opts)
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
