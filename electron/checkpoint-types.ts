import type { AgentGraph } from './graph-types'

export type CheckpointLoop = { id: string; keys: string[]; index: number; isList: boolean; outerVars: Record<string, string>; visitId?: string }
export type CheckpointLapStatus = 'running' | 'completed' | 'incomplete' | 'failed' | 'stopped' | 'interrupted'
export type CheckpointLap = { key: string; parentKey?: string; visitId: string; loopId: string; title: string; index: number; total: number; item: string; at: number; endedAt?: number; status: CheckpointLapStatus; checkpointId?: string }
export type CheckpointScope = { path: string[]; vars: Record<string, string> }
export type CheckpointCursor = {
  files?: import('./file-contract').FileRunContext
  startId?: string
  packagePath: string[]
  loops: CheckpointLoop[]
  scopes: CheckpointScope[]
}
export type CheckpointSnapshot = { graph: AgentGraph; cursor: CheckpointCursor }
export type CheckpointOutput = { path: string; kind: 'file' | 'folder' | 'unknown'; change: 'created' | 'modified' | 'removed' | 'observed'; firstSeen: number; lastSeen: number; size: number; present?: boolean; /** Active lap when the filesystem event arrived; temporal evidence, not producer attribution. */ lapKey?: string }
export type CheckpointInfo = {
  id: string; runId: string; ordinal: number; canvasId: string; canvasName: string
  label: string; at: number; endedAt?: number; outputCount: number
  status: 'running' | 'closed' | 'completed' | 'stopped' | 'failed' | 'interrupted'
  roots: string[]; issues: string[]; parentId?: string
  /** Optional v2 observation metadata. Old records remain readable without inferred ancestry. */
  lapPath?: string[]; outputScopes?: Record<string, number>
  /** Run activity attached once per run by list(); stored separately from snapshots. */
  activity?: CheckpointLap[]
}
export type CheckpointDetail = CheckpointInfo & { outputs: CheckpointOutput[] }
/**
 * İzleme durumu. Kökler ARTIK AKIŞTAN gelir (`flowRoots`); tüm disk izleme isteğe bağlıdır.
 * `source`: köklerin nereden geldiğini söyler — 'akis' yalnız akış klasörleri, 'disk' tüm diskler,
 * 'karisik' ikisi, 'yok' hiçbiri (bu durum koşuyu DURDURMAZ; yalnız çıktı listesi sınırlı kalır).
 */
export type CheckpointMonitoring = {
  automatic: true
  active: boolean
  roots: string[]
  issues: string[]
  /** Akışta yazılı olduğu için izlenen klasörler. */
  flowRoots: string[]
  /** Henüz oluşmamış klasörler; oluşunca izlemeye alınır. */
  pendingRoots: string[]
  /** Tüm disk izleme açık mı (opt-in, varsayılan kapalı). */
  wideWatch: boolean
  source: 'akis' | 'disk' | 'karisik' | 'yok'
  /** Akışta yol bulundu ama kullanılamadı (göreli, sistem klasörü vb.) sayısı. */
  skippedPaths: number
}

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
