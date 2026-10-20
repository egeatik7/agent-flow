import type { CheckpointDetail, CheckpointInfo, CheckpointLap, CheckpointOutput } from '../../electron/checkpoint-types'

export type CheckpointTreeNode = { key: string; kind: 'run' | 'loop' | 'lap' | 'unassigned' | 'checkpoint'; title: string; subtitle?: string;
  runId: string; runStatus?: CheckpointInfo['status']; children: CheckpointTreeNode[]; lap?: CheckpointLap; checkpoint?: CheckpointInfo; count: number; lapKeys: Set<string>; checkpointIds: string[] }
export function checkpointTree(rows: CheckpointInfo[]): CheckpointTreeNode[] {
  const runs = new Map<string, CheckpointInfo[]>()
  for (const row of rows) { const list = runs.get(row.runId) ?? []; list.push(row); runs.set(row.runId, list) }
  return [...runs].map(([runId, records]) => {
    records.sort((a, b) => a.ordinal - b.ordinal || a.at - b.at)
    const first = records[0]
    const recordById = new Map(records.map(row => [row.id, row]))
    const laps = new Map(records.flatMap(r => r.activity ?? []).map(lap => [lap.key, lap]))
    const root: CheckpointTreeNode = { key: `run:${runId}`, kind: 'run', title: first.canvasName, subtitle: new Date(first.at).toLocaleString('tr-TR'), runId,
      children: [], runStatus: records[records.length - 1].status, checkpoint: records.find(r => r.lapPath?.length === 0), count: 0, lapKeys: new Set(), checkpointIds: records.map(r => r.id) }
    const lapNodes = new Map<string, CheckpointTreeNode>()
    const valid = (lap: CheckpointLap) => {
      const seen = new Set([lap.key]); let p = lap.parentKey
      while (p) { if (seen.has(p) || !laps.has(p)) return false; seen.add(p); p = laps.get(p)!.parentKey }
      return Number.isInteger(lap.index) && lap.index >= 0 && lap.index < lap.total
    }
    for (const lap of laps.values()) if (valid(lap)) lapNodes.set(lap.key, { key: `lap:${runId}:${lap.key}`, kind: 'lap', title: `${lap.index + 1}/${lap.total} · ${lap.item}`,
      runId, children: [], lap, checkpoint: recordById.get(lap.checkpointId ?? ''), count: 0, lapKeys: new Set([lap.key]), checkpointIds: [] })
    const groups = new Map<string, CheckpointTreeNode>()
    for (const lapNode of lapNodes.values()) {
      const lap = lapNode.lap!, parent = lap.parentKey ? lapNodes.get(lap.parentKey)! : root
      const groupKey = JSON.stringify([runId, lap.parentKey, lap.visitId])
      let group = groups.get(groupKey)
      if (!group) { group = { key: `loop:${groupKey}`, kind: 'loop', title: lap.title, runId, children: [], count: 0, lapKeys: new Set(), checkpointIds: [] }; groups.set(groupKey, group); parent.children.push(group) }
      group.children.push(lapNode)
    }
    const other: CheckpointTreeNode = { key: `other:${runId}`, kind: 'unassigned', title: 'Tuval / turla eşleştirilemeyen çıktılar', runId, children: [], count: 0, lapKeys: new Set(), checkpointIds: [] }
    for (const row of records) {
      if (row.lapPath === undefined) {
        // Legacy snapshots are not read/guessed from labels just to manufacture a tree.
        root.children.push({ key: `cp:${row.id}`, kind: 'checkpoint', title: row.label, subtitle: 'Eski kayıt · tur ilişkisi kayıtlı değil', runId, children: [], checkpoint: row, count: row.outputCount, lapKeys: new Set(), checkpointIds: [row.id] })
        continue
      }
      if (row.lapPath.length && !row.lapPath.some(key => lapNodes.has(key))) root.children.push({ key: `cp:${row.id}`, kind: 'checkpoint', title: row.label,
        subtitle: 'Tur bilgisi eksik · kayıtlı başlangıç kullanılabilir', runId, children: [], checkpoint: row, count: 0, lapKeys: new Set(), checkpointIds: [row.id] })
      let unassigned = 0
      for (const [key, count] of Object.entries(row.outputScopes ?? {})) {
        const lap = lapNodes.get(key)
        if (lap) { lap.count += count; lap.checkpointIds.push(row.id) } else unassigned += count
      }
      // A partially written/older metadata summary must not hide observed records.
      unassigned += Math.max(0, row.outputCount - Object.values(row.outputScopes ?? {}).reduce((a, b) => a + b, 0))
      if (unassigned) { other.count += unassigned; other.checkpointIds.push(row.id) }
    }
    if (other.count) root.children.push(other)
    const sum = (node: CheckpointTreeNode) => {
      for (const child of node.children) {
        sum(child); node.count += child.count
        for (const key of child.lapKeys) node.lapKeys.add(key)
        node.checkpointIds.push(...child.checkpointIds)
      }
      node.checkpointIds = [...new Set(node.checkpointIds)]
    }
    sum(root)
    // Root total is the recorded observation count, never a guessed completion count.
    root.count = records.reduce((n, r) => n + r.outputCount, 0)
    return root
  })
}
export function treeFind(nodes: CheckpointTreeNode[], key: string): CheckpointTreeNode | undefined {
  for (const node of nodes) { if (node.key === key) return node; const found = treeFind(node.children, key); if (found) return found }
}
export function treeTrail(nodes: CheckpointTreeNode[], key: string): string[] {
  for (const node of nodes) { if (node.key === key) return [key]; const trail = treeTrail(node.children, key); if (trail.length) return [node.key, ...trail] }
  return []
}
export function treeAttention(nodes: CheckpointTreeNode[]): CheckpointTreeNode | undefined {
  const all: CheckpointTreeNode[] = []
  const walk = (ns: CheckpointTreeNode[]) => { for (const n of ns) { if (n.lap) all.push(n); walk(n.children) } }; walk(nodes)
  return all.filter(n => n.lap!.status === 'running').sort((a, b) => treeTrail(nodes, b.key).length - treeTrail(nodes, a.key).length)[0]
    ?? all.filter(n => ['failed', 'stopped', 'interrupted', 'incomplete'].includes(n.lap!.status)).sort((a, b) => b.lap!.at - a.lap!.at)[0]
}
export function treeOutputs(node: CheckpointTreeNode, details: CheckpointDetail[], knownLapKeys: Set<string>): CheckpointOutput[] {
  const result = new Map<string, CheckpointOutput>()
  for (const detail of details) for (const output of detail.outputs) {
    if (node.kind === 'lap' || node.kind === 'loop') { if (!output.lapKey || !node.lapKeys.has(output.lapKey)) continue }
    if (node.kind === 'unassigned' && output.lapKey && knownLapKeys.has(output.lapKey)) continue
    const key = output.path.replace(/\\/g, '/').toLowerCase(), old = result.get(key)
    if (!old || output.lastSeen >= old.lastSeen) result.set(key, { ...output, firstSeen: Math.min(old?.firstSeen ?? output.firstSeen, output.firstSeen) })
  }
  return [...result.values()].sort((a, b) => b.lastSeen - a.lastSeen || a.path.localeCompare(b.path))
}
