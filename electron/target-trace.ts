import type { AgentNode, TargetMemo } from './graph-types'
import type { ScanResult, ScreenItem } from './matcher'
import type { FindStageId } from './llm-flow'

export type TargetRect = { x: number; y: number; w: number; h: number }
export type TargetResolution = {
  x: number
  y: number
  label: string
}

/** Developer diagnostics only. No API keys, model credentials or settings object. */
export type TargetTrace = {
  version: 1
  at: string
  nodeId: string
} & (
  | { kind: 'request'; node: AgentNode; order: FindStageId[]; readOnly: boolean; windowTitle: string; modelEnabled: boolean; memory?: TargetMemo[] }
  | { kind: 'observation'; source: FindStageId; scan?: ScanResult | null; value?: unknown }
  | { kind: 'model'; source: 'list' | 'chrome' | 'tars'; value: unknown }
  | { kind: 'resolved'; source: FindStageId; target: TargetResolution; rect?: TargetRect; item?: ScreenItem }
  | { kind: 'input'; point: { x: number; y: number }; mode: string; phase: 'sent' }
  | { kind: 'failure'; message: string }
)

export type TargetTraceData = TargetTrace extends infer E
  ? E extends TargetTrace ? Omit<E, 'version' | 'at' | 'nodeId'> : never
  : never
