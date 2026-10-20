import type { AgentGraph } from './graph-types'
import type { CheckpointLap, CheckpointLapStatus, CheckpointLoop } from './checkpoint-types'

export class CheckpointActivity {
  readonly laps = new Map<string, CheckpointLap>()
  private dirty = new Set<string>()
  path: string[] = []
  private titles = new Map<string, string>()
  graph(graph: AgentGraph) {
    const visit = (g: AgentGraph) => { for (const n of g.nodes) { this.titles.set(n.id, n.title); if (n.inner) visit(n.inner) } }
    visit(graph)
  }
  context(frames: CheckpointLoop[], status?: CheckpointLapStatus) {
    const next: string[] = []
    for (const frame of frames) {
      // New runs always provide visitId. Legacy frozen frames get a path-scoped identity.
      const visitId = frame.visitId ?? JSON.stringify([next, frame.id])
      const key = JSON.stringify([visitId, frame.index])
      next.push(key)
      if (!this.laps.has(key)) { this.laps.set(key, { key, parentKey: next[next.length - 2], visitId, loopId: frame.id,
        title: this.titles.get(frame.id) ?? frame.id, index: frame.index, total: frame.keys.length,
        item: frame.isList ? frame.keys[frame.index] ?? '' : String(frame.index + 1), at: Date.now(), status: 'running' }); this.dirty.add(key) }
    }
    this.path = next
    const lap = this.laps.get(next[next.length - 1])
    if (lap && status) { lap.status = status; lap.endedAt = Date.now(); this.dirty.add(lap.key) }
  }
  checkpoint(id: string) {
    const lap = this.laps.get(this.path[this.path.length - 1])
    if (lap && !lap.checkpointId) { lap.checkpointId = id; this.dirty.add(lap.key) }
  }
  finish(status: 'completed' | 'stopped' | 'failed') {
    // A run ending cleanly does not prove an open lap finished (e.g. an End node inside it).
    for (const lap of this.laps.values()) if (lap.status === 'running') {
      lap.status = status === 'completed' ? 'incomplete' : status; lap.endedAt = Date.now(); this.dirty.add(lap.key)
    }
    this.path = []
  }
  takeChanges() { const rows = [...this.dirty].map(key => ({ ...this.laps.get(key)! })); this.dirty.clear(); return rows }
  retryChanges(rows: CheckpointLap[]) { for (const row of rows) this.dirty.add(row.key) }
}
