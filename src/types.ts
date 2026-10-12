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

export type ModelInfo = { id: string; vision: boolean; pricing?: { promptPerM: number; completionPerM: number } }

/** Sohbet turunun nereye gittiği: yerel sunucu mu, OpenRouter mı. */
export type LocalChatTarget = 'local' | 'api'

/** `local:chat` yanıtı. `gpu` yalnız ölçülebilen VRAM metnini taşır; ölçülemezse boş kalır. */
export type LocalChatReply = {
  ok: boolean
  reply: string
  target: LocalChatTarget
  model: string
  ms: number
  gpu: string
  error?: string
}

export type XpAgentApi = {
  /** Empty for the person's own instance; the profile name for a test instance. */
  profile?: string
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  onCloseRequested?: (cb: (id: unknown) => void) => () => void
  finishClose?: (id: number, allow: boolean) => Promise<void>
  bootReady?: () => void
  getSettings: () => Promise<AppSettings>
  saveSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  getGraph: () => Promise<AgentGraph>
  saveGraph: (graph: AgentGraph) => Promise<boolean>
  libraryInfo?: () => Promise<{ directory: string }>
  viewerInfo?: () => Promise<import('../electron/viewer-types').ViewerInfo>
  manageViewer?: (action:'enable'|'disable'|'rotate') => Promise<import('../electron/viewer-types').ViewerInfo>
  manageLibrary?: (mode: 'open' | 'reveal' | 'reload') => Promise<{ directory: string; book?: CanvasBook } | null>
  zipLibraryAction?: (action: import('../electron/zip-library-api').ZipLibraryAction) => Promise<import('../electron/zip-library-api').ZipLibraryResult | null>
  getCanvases: () => Promise<CanvasBook>
  /** Saves only the working session. ZIP documents use zipLibraryAction. */
  saveCanvases: (book: CanvasBook) => Promise<boolean | { conflict: boolean }>
  listWindows: () => Promise<{ title: string; handle: string }[]>
  scanScreen: (windowTitle?: string, ramp?: { lo: number; hi: number }) => Promise<ScanResult>
  matchChrome: (rect: { x: number; y: number; w: number; h: number }) => Promise<{ text: string; type: string } | null>
  pickScreenBox: (box: { x: number; y: number; w: number; h: number }) => Promise<Locator | null>
  captureAfter: (ms: number) => Promise<Locator | null>
  runAgent: (
    graph: AgentGraph,
    startId?: string,
    packagePath?: string[],
    /** `derived`: this graph is a branch being tried, not the saved flow; do not store it. */
    opts?: { derived?: boolean; requireEnd?: boolean; canvasId?: string }
  ) => Promise<{ ok: boolean; stopped?: boolean; failed?: number; reachedEnd?: boolean }>
  stopAgent: () => Promise<boolean>
  callTool: (name: string, args?: unknown) => Promise<ToolResult>
  toolList: () => Promise<ToolSpec[]>
  toolEndpoint: () => Promise<{ port: number; file: string; startedAt: number } | null>
  toolEndpointOpen: () => Promise<string | null>
  openLogs: () => Promise<string>
  /** Döngü öğesi gibi bir yolun BULUNDUĞU klasörü açar ve öğeyi seçer. */
  showInFolder?: (path: string) => Promise<boolean>
  /** Öğeyi kabuğun varsayılanıyla açar: klasör → Gezgin, dosya → kendi uygulaması. */
  openPath?: (path: string) => Promise<boolean>
  onRecoveryReport?: (cb: (report: import('../electron/recovery').RecoveryReport) => void) => () => void
  onRecoveryStatus?: (cb: (status: { active: boolean; nodeTitle: string; message: string }) => void) => () => void
  recoveryReports?: () => Promise<import('../electron/recovery').RecoveryReport[]>
  removeRecoveryReport?: (id: string) => Promise<boolean>
  clearRecoveryReports?: () => Promise<boolean>
  copyRecoveryReportText?: (text: string) => Promise<boolean>
  onRecoveryReportsRemoved?: (cb: (ids: string[]) => void) => () => void
  openRecoveryReports?: () => Promise<string>
  testOpenRouter: () => Promise<string>
  listModels: () => Promise<ModelInfo[]>
  /** Yerel (OpenAI uyumlu) sunucunun model listesi; adres açık mı sınaması olarak da kullanılır. */
  listLocalModels?: (base?: string) => Promise<ModelInfo[]>
  /** Yerel Model sekmesindeki sohbet kutusu: tek mesaj, tek tur; cevabı kimin verdiği yanıtta yazar. */
  localChat?: (payload: { prompt: string; target?: LocalChatTarget; model?: string }) => Promise<LocalChatReply>
  /** Verilen mutlak yollardan diskte OLMAYANLARI döndürür (koşu öncesi döngü denetimi). */
  missingPaths?: (paths: string[]) => Promise<string[]>
  testVision: () => Promise<{ model: string; text: string }>
  onAgentLog: (cb: (payload: unknown) => void) => () => void
  onAgentStep: (cb: (payload: unknown) => void) => () => void
  onAgentEdge?: (cb: (payload: unknown) => void) => () => void
  onAgentPatch: (cb: (payload: unknown) => void) => () => void
  onHud?: (cb: (payload: unknown) => void) => () => void
  onHudLoop?: (cb: (payload: unknown) => void) => () => void
  onHudMethod?: (cb: (payload: unknown) => void) => () => void
  /** Zamanlayıcı adımı sürerken karttaki canlı geri sayım satırı. */
  onHudCountdown?: (cb: (payload: unknown) => void) => () => void
  pickFolder: (extensions: string[]) => Promise<{ folder: string; files: string[] } | null>
  listDir: (dir: string) => Promise<string[] | null>
  pickDir: () => Promise<string | null>
}

declare global {
  interface Window {
    xpAgent?: XpAgentApi
  }
}
