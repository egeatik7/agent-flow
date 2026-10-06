export * from '../electron/graph-types'
export {
  FIND_STAGES,
  EXTRA_PROMPTS,
  DEFAULT_PROMPTS,
  activeFindOrder,
  type FindStageId,
  type PromptId,
  type LlmPrompts,
} from '../electron/llm-flow'
export type { ScanResult, ScreenItem } from '../electron/matcher'
export type { ToolResult, ToolSpec, ToolOutcome, NodeRef, LoopRef } from '../electron/tools'
import type { AgentGraph, AppSettings, CanvasBook, Locator, LogLevel } from '../electron/graph-types'
import type { ScanResult } from '../electron/matcher'
import type { ToolResult, ToolSpec } from '../electron/tools'

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
  bootReady?: () => void
  getSettings: () => Promise<AppSettings>
  saveSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  getGraph: () => Promise<AgentGraph>
  saveGraph: (graph: AgentGraph) => Promise<boolean>
  getCanvases: () => Promise<CanvasBook>
  saveCanvases: (book: CanvasBook) => Promise<boolean>
  listWindows: () => Promise<{ title: string; handle: string }[]>
  scanScreen: (windowTitle?: string, ramp?: { lo: number; hi: number }) => Promise<ScanResult>
  matchChrome: (rect: { x: number; y: number; w: number; h: number }) => Promise<{ text: string; type: string } | null>
  pickScreenBox: (box: { x: number; y: number; w: number; h: number }) => Promise<Locator | null>
  captureAfter: (ms: number) => Promise<Locator | null>
  runAgent: (graph: AgentGraph, startId?: string, packagePath?: string[]) => Promise<{ ok: boolean; stopped?: boolean; failed?: number }>
  stopAgent: () => Promise<boolean>
  callTool: (name: string, args?: unknown) => Promise<ToolResult>
  toolList: () => Promise<ToolSpec[]>
  toolEndpoint: () => Promise<{ port: number; file: string; startedAt: number } | null>
  openLogs: () => Promise<string>
  testOpenRouter: () => Promise<string>
  listModels: () => Promise<ModelInfo[]>
  testVision: () => Promise<{ model: string; text: string }>
  onAgentLog: (cb: (payload: unknown) => void) => () => void
  onAgentStep: (cb: (payload: unknown) => void) => () => void
  onAgentPatch: (cb: (payload: unknown) => void) => () => void
  onHud?: (cb: (payload: unknown) => void) => () => void
  onHudLoop?: (cb: (payload: unknown) => void) => () => void
  onHudMethod?: (cb: (payload: unknown) => void) => () => void
  pickFolder: (extensions: string[]) => Promise<{ folder: string; files: string[] } | null>
  listDir: (dir: string) => Promise<string[] | null>
  pickDir: () => Promise<string | null>
}

declare global {
  interface Window {
    xpAgent?: XpAgentApi
  }
}
