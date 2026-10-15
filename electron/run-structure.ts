import { NODE_SPECS, portLabel, type AgentGraph, type AgentNode } from './graph-types'
import { firstMember } from './groups'

export type StructureIssue = {
  severity: 'error' | 'warning'
  code: string
  path: string[]
  nodeId?: string
  node: string
  port?: string
  message: string
}
export type NamedStructureIssue = StructureIssue & { canvas: string }
export type StructureOptions = { startId?: string; packagePath?: string[]; requireEnd?: boolean }

/** Pure preflight. No normalization, graph mutation, desktop input or model request. */
export function inspectRunStructure(root: AgentGraph, options: StructureOptions = {}): StructureIssue[] {
  const issues: StructureIssue[] = []
  const stack = new Set<AgentGraph>()
  const add = (path: string[], node: AgentNode | undefined, severity: StructureIssue['severity'], code: string, message: string, port?: string) => {
    issues.push({ severity, code, path: [...path], nodeId: node?.id, node: node?.title || node?.id || 'Tuval', ...(port ? { port } : {}), message })
  }
  const visit = (graph: AgentGraph, path: string[], opts: StructureOptions, exit?: AgentNode['packageExit']): { reached: Set<string>; hasEnd: boolean } => {
    const reached = new Set<string>()
    let hasEnd = false
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      add(path, undefined, 'error', 'invalid-graph', 'Tuvalin düğüm veya bağlantı listesi bozuk.')
      return { reached, hasEnd }
    }
    if (stack.has(graph)) {
      add(path, undefined, 'error', 'recursive-package', 'Paket kendisini içeriyor; paket yapısı döngüsel.')
      return { reached, hasEnd }
    }
    stack.add(graph)
    const byId = new Map<string, AgentNode>()
    const owners = new Map<string, string>()
    const outgoing = new Map<string, typeof graph.edges>()
    let invalid = false
    const error = (node: AgentNode | undefined, code: string, message: string, port?: string) => {
      invalid = true; add(path, node, 'error', code, message, port)
    }
    for (const node of graph.nodes) {
      if (!node || typeof node.id !== 'string' || !node.id) { error(undefined, 'missing-id', 'Kimliği olmayan düğüm var.'); continue }
      if (byId.has(node.id)) error(node, 'duplicate-id', `Aynı düğüm kimliği birden fazla kullanılmış: ${node.id}.`)
      if (!NODE_SPECS[node.kind]) error(node, 'unsupported-kind', `Desteklenmeyen düğüm türü: ${node.kind}.`)
      byId.set(node.id, node)
    }
    for (const node of graph.nodes) {
      if (node?.kind !== 'loop') continue
      for (const id of node.members ?? []) {
        if (!byId.has(id)) { error(node, 'missing-member', `Döngünün içindeki kayıtlı düğüm bulunamadı: ${id}.`); continue }
        if (owners.has(id) && owners.get(id) !== node.id) error(byId.get(id), 'multiple-owners', 'Aynı düğüm iki ayrı döngünün doğrudan üyesi.')
        owners.set(id, node.id)
      }
    }
    for (const node of graph.nodes) {
      if (!node) continue
      const seen = new Set<string>([node.id])
      let owner = owners.get(node.id)
      while (owner) {
        if (seen.has(owner)) { error(node, 'recursive-loop', 'Döngü kutuları birbirini içeriyor.'); break }
        seen.add(owner); owner = owners.get(owner)
      }
    }
    const hasPort = (node: AgentNode, port: string) => NODE_SPECS[node.kind]?.outputs.some(p => p.key === port) || node.kind === 'ai' && port === 'fail'
    const outputs = (node: AgentNode) => {
      const regular = NODE_SPECS[node.kind].outputs
      return node.kind === 'ai' && ((outgoing.get(node.id) ?? []).some(e => e.fromPort === 'fail') || exit?.from === node.id && exit.fromPort === 'fail')
        ? [...regular, { key: 'fail', label: 'başarısız' }] : regular
    }
    const ports = new Set<string>()
    for (const edge of graph.edges) {
      const from = byId.get(edge?.from), to = byId.get(edge?.to)
      if (!from || !to) { error(from, 'dangling-edge', `Bağlantının ${!from ? 'başlangıç' : 'hedef'} düğümü bulunamadı (${!from ? edge?.from : edge?.to}).`, edge?.fromPort); continue }
      const validPort = hasPort(from, edge.fromPort)
      if (!validPort) { error(from, 'invalid-port', `“${edge.fromPort}” adlı çıkış bu düğümde yok.`, edge.fromPort); continue }
      const key = `${from.id}\0${edge.fromPort}`
      if (ports.has(key)) error(from, 'duplicate-port', `“${portLabel(from.kind, edge.fromPort)}” çıkışı birden fazla düğüme bağlı.`, edge.fromPort)
      ports.add(key)
      const edges = outgoing.get(from.id) ?? []; edges.push(edge); outgoing.set(from.id, edges)
    }
    if (invalid) { stack.delete(graph); return { reached, hasEnd } }
    const selectionPackage = opts.packagePath?.[0]
    const requested = selectionPackage || opts.startId
    const entry = requested ? byId.get(requested) : graph.nodes.find(n => n.kind === 'start') ?? graph.nodes.find(n => !graph.edges.some(e => e.to === n.id))
    if (!entry && (graph.nodes.length || requested)) error(undefined, 'missing-entry', requested ? `Başlangıç düğümü bulunamadı: ${requested}.` : 'Başlangıç node’u bulunamadı.')
    if (!graph.nodes.length && !exit) add(path, undefined, 'warning', 'empty-graph', 'Tuval/paket boş; hiçbir adım çalışmayacak.')
    if (selectionPackage && entry?.kind !== 'package') error(entry, 'invalid-package-path', 'Çalıştırılacak açık paket bu akışta yok.')
    const enterable = (id: string, scope?: string): AgentNode | undefined => {
      let node = byId.get(id)
      while (node) {
        const owner = owners.get(node.id)
        if (owner === scope) return node
        if (!owner) return undefined
        node = byId.get(owner)
      }
      return undefined
    }
    const visitedScope = new Set<string>()
    const selectedLoop = (id: string, loopId: string): boolean => {
      let owner = owners.get(id)
      while (owner) { if (owner === loopId) return true; owner = owners.get(owner) }
      return false
    }
    const walk = (first: AgentNode | undefined, scope?: string) => {
      const queue = first ? [first] : []
      while (queue.length) {
        const node = queue.shift()!
        const key = `${scope ?? ''}\0${node.id}`
        if (visitedScope.has(key)) continue
        visitedScope.add(key); reached.add(node.id)
        if (node.kind === 'end') { hasEnd = true; continue }
        if (node.kind === 'loop') {
          walk(firstMember(graph, node), node.id)
          if (entry && selectedLoop(entry.id, node.id)) walk(enterable(entry.id, node.id), node.id)
          if (!node.members?.length) add(path, node, 'warning', 'empty-loop', 'Döngü kutusu boş; içindeki iş çalışmayacak.')
        }
        if (node.kind === 'package') {
          const selected = selectionPackage === node.id
          const inner = node.inner ?? { nodes: [], edges: [] }
          visit(inner, [...path, node.title || node.id], selected ? { startId: opts.startId, packagePath: opts.packagePath?.slice(1) } : {}, node.packageExit)
        }
        for (const port of outputs(node)) {
          const edge = (outgoing.get(node.id) ?? []).find(e => e.fromPort === port.key)
          const isBoundary = exit?.from === node.id && exit.fromPort === port.key
          if (edge) {
            const next = enterable(edge.to, scope)
            if (next) queue.push(next)
            // A loop member may legitimately end its lap by leaving its scope.
          } else if (!isBoundary && (node.kind === 'condition' || scope === undefined && path.length === 0)) {
            add(path, node, 'warning', 'open-output', `“${port.label}” çıkışı bağlı değil; bu sonuçta ${scope ? 'döngü turu' : path.length ? 'paket' : 'akış'} burada biter.`, port.key)
          }
        }
      }
    }
    if (entry && !invalid) walk(enterable(entry.id))
    // Orphan loop members are never an intentional lap boundary: they are steps
    // the chosen loop entry cannot reach. Selected runs may skip earlier root steps.
    for (const node of graph.nodes) {
      if (reached.has(node.id) || node.kind === 'start' && requested) continue
      if (!requested || owners.has(node.id) && reached.has(owners.get(node.id)!)) {
        add(path, node, 'warning', 'unreachable-node', 'Bu düğüme çalıştırılacak bağlantı zincirinden ulaşılamıyor; çalışmayacak.')
      }
    }
    if (exit) {
      const node = byId.get(exit.from)
      if (!node) error(undefined, 'missing-package-exit', `Paketin kayıtlı çıkış düğümü bulunamadı: ${exit.from}.`)
      else if (!hasPort(node, exit.fromPort)) error(node, 'invalid-package-exit', `Paketin kayıtlı “${exit.fromPort}” çıkışı bu düğümde yok.`, exit.fromPort)
      else if (!reached.has(exit.from)) error(node, 'unreachable-package-exit', 'Paketin kayıtlı çıkışına bu başlangıçtan ulaşılamıyor; dış akışa devam edilemez.', exit.fromPort)
      // Prove early termination on ordinary branches without mistaking an
      // implicit loop-lap boundary for a broken package exit.
      if (entry && node && reached.has(exit.from)) {
        const seen = new Set<string>(), pending = [enterable(entry.id)]
        while (pending.length) {
          const current = pending.shift()
          if (!current || seen.has(current.id)) continue
          seen.add(current.id)
          if (current.kind === 'loop') continue // body/done reachability is checked above
          if (current.kind === 'end') {
            add(path, current, 'warning', 'early-package-end', 'Bu kol paketin kayıtlı çıkışına uğramadan Bitir node’unda sonlanabilir; dış akış devam etmeyebilir.')
            continue
          }
          for (const port of outputs(current)) {
            if (exit.from === current.id && exit.fromPort === port.key) continue
            const edge = (outgoing.get(current.id) ?? []).find(e => e.fromPort === port.key)
            if (edge) pending.push(enterable(edge.to))
            else if (current.kind !== 'condition') add(path, current, 'warning', 'early-package-end', 'Bu kol paketin kayıtlı çıkışına uğramadan sonlanıyor; dış akış devam etmeyebilir.', port.key)
          }
        }
      }
    }
    if (opts.requireEnd && !hasEnd) add(path, undefined, 'error', 'missing-end', 'Çalıştırılacak yoldan Bitir node’una ulaşılamıyor; sonraki tuvale geçilemez.')
    stack.delete(graph)
    return { reached, hasEnd }
  }
  visit(root, [], options)
  return issues
}

export function structureSummary(issues: StructureIssue[]): string {
  return issues.map(i => `${[...i.path, i.node].join(' › ')}${i.port ? ` [${i.port}]` : ''}: ${i.message}`).join('\n')
}
export class RunStructureError extends Error {
  constructor(readonly issues: StructureIssue[]) { super(`Çalıştırmadan önce akış yapısını düzelt:\n${structureSummary(issues)}`); this.name = 'RunStructureError' }
}
export function assertRunStructure(graph: AgentGraph, options: StructureOptions = {}): StructureIssue[] {
  const issues = inspectRunStructure(graph, options)
  const errors = issues.filter(i => i.severity === 'error')
  if (errors.length) throw new RunStructureError(errors)
  return issues
}
