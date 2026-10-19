import type { AgentGraph } from './graph-types'

export type CheckpointLoop = { id: string; keys: string[]; index: number; isList: boolean; outerVars: Record<string, string> }
export type CheckpointScope = { path: string[]; vars: Record<string, string> }
export type CheckpointCursor = {
  startId?: string
  packagePath: string[]
  loops: CheckpointLoop[]
  scopes: CheckpointScope[]
}
export type CheckpointSnapshot = { graph: AgentGraph; cursor: CheckpointCursor }
export type CheckpointOutput = { path: string; kind: 'file' | 'folder' | 'unknown'; change: 'created' | 'modified' | 'removed' | 'observed'; firstSeen: number; lastSeen: number; size: number; present?: boolean }
export type CheckpointInfo = {
  id: string; runId: string; ordinal: number; canvasId: string; canvasName: string
  label: string; at: number; endedAt?: number; outputCount: number
  status: 'running' | 'closed' | 'completed' | 'stopped' | 'failed' | 'interrupted'
  roots: string[]; issues: string[]; parentId?: string
}
export type CheckpointDetail = CheckpointInfo & { outputs: CheckpointOutput[] }
export type CheckpointMonitoring = { automatic: true; active: boolean; roots: string[]; issues: string[] }

/** Node IDs are unique within a canvas; resolve the exact package graph by identity. */
export function checkpointGraphPath(root: AgentGraph, graph: AgentGraph, path: string[] = []): string[] {
  if (root === graph) return path
  for (const n of root.nodes) {
    if (n.inner) {
      try { return checkpointGraphPath(n.inner, graph, [...path, n.id]) } catch { /* next package */ }
    }
  }
  throw new Error('Checkpoint: çalışan paket kök tuvalde bulunamadı.')
}
