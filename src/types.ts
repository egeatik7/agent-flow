export * from '../electron/graph-types'
import type { A11yNode, AgentGraph, AppSettings, Locator, LogLevel } from '../electron/graph-types'

export type LogEntry = {
  id: string
  level: LogLevel
  message: string
  at: number
}

export type XpAgentApi = {
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  getSettings: () => Promise<AppSettings>
  saveSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  getGraph: () => Promise<AgentGraph>
  saveGraph: (graph: AgentGraph) => Promise<boolean>
  listWindows: () => Promise<{ title: string; handle: string }[]>
  getA11yTree: (windowTitle?: string) => Promise<A11yNode>
  startRecord: () => Promise<boolean>
  stopRecord: () => Promise<boolean>
  captureAfter: (ms: number) => Promise<Locator | null>
  runAgent: (graph: AgentGraph, startId?: string) => Promise<{ ok: boolean; stopped?: boolean }>
  stopAgent: () => Promise<boolean>
  testOpenRouter: () => Promise<string>
  listModels: () => Promise<string[]>
  onRecordEvent: (cb: (payload: unknown) => void) => () => void
  onAgentLog: (cb: (payload: unknown) => void) => () => void
  onAgentStep: (cb: (payload: unknown) => void) => () => void
}

declare global {
  interface Window {
    xpAgent?: XpAgentApi
  }
}
