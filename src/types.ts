export * from '../electron/graph-types'
export type { ScanResult, ScreenItem } from '../electron/matcher'
import type { AgentGraph, AppSettings, Locator, LogLevel } from '../electron/graph-types'
import type { ScanResult } from '../electron/matcher'

export type LogEntry = {
  id: string
  level: LogLevel
  message: string
  at: number
}

export type ModelInfo = { id: string; vision: boolean }

export type XpAgentApi = {
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  getSettings: () => Promise<AppSettings>
  saveSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  getGraph: () => Promise<AgentGraph>
  saveGraph: (graph: AgentGraph) => Promise<boolean>
  listWindows: () => Promise<{ title: string; handle: string }[]>
  scanScreen: (windowTitle?: string) => Promise<ScanResult>
  startRecord: () => Promise<boolean>
  stopRecord: () => Promise<boolean>
  captureAfter: (ms: number) => Promise<Locator | null>
  runAgent: (graph: AgentGraph, startId?: string) => Promise<{ ok: boolean; stopped?: boolean }>
  stopAgent: () => Promise<boolean>
  testOpenRouter: () => Promise<string>
  listModels: () => Promise<ModelInfo[]>
  testVision: () => Promise<{ model: string; text: string }>
  onRecordEvent: (cb: (payload: unknown) => void) => () => void
  onAgentLog: (cb: (payload: unknown) => void) => () => void
  onAgentStep: (cb: (payload: unknown) => void) => () => void
  onAgentAnchor: (cb: (payload: unknown) => void) => () => void
}

declare global {
  interface Window {
    xpAgent?: XpAgentApi
  }
}
