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
  pickScreenBox: (box: { x: number; y: number; w: number; h: number }) => Promise<Locator | null>
  captureAfter: (ms: number) => Promise<Locator | null>
  runAgent: (graph: AgentGraph, startId?: string, packagePath?: string[]) => Promise<{ ok: boolean; stopped?: boolean }>
  stopAgent: () => Promise<boolean>
  openLogs: () => Promise<string>
  testOpenRouter: () => Promise<string>
  listModels: () => Promise<ModelInfo[]>
  testVision: () => Promise<{ model: string; text: string }>
  onAgentLog: (cb: (payload: unknown) => void) => () => void
  onAgentStep: (cb: (payload: unknown) => void) => () => void
  onAgentPatch: (cb: (payload: unknown) => void) => () => void
  pickFolder: (extensions: string[]) => Promise<{ folder: string; files: string[] } | null>
  listDir: (dir: string) => Promise<string[] | null>
  pickDir: () => Promise<string | null>
}

declare global {
  interface Window {
    xpAgent?: XpAgentApi
  }
}
