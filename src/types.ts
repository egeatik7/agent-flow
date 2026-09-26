export type AppSettings = {
  apiKey: string
  model: string
  targetWindow: string
  maxTreeDepth: number
  stepDelayMs: number
}

export type AgentNode = {
  id: string
  title: string
  prompt: string
  x: number
  y: number
  recorded?: {
    name: string
    controlType: string
    automationId?: string
    path: string
  }
}

export type AgentGraph = {
  nodes: AgentNode[]
  edges: { id: string; from: string; to: string }[]
}

export type A11yNode = {
  id: string
  name: string
  controlType: string
  automationId?: string
  path: string
  children?: A11yNode[]
}

export type LogEntry = {
  id: string
  level: 'info' | 'error' | 'success'
  message: string
  at: number
}

export type StepStatus = 'idle' | 'running' | 'done' | 'error'

declare global {
  interface Window {
    xpAgent: {
      minimize: () => Promise<void>
      maximize: () => Promise<void>
      close: () => Promise<void>
      getSettings: () => Promise<AppSettings>
      saveSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
      getGraph: () => Promise<AgentGraph>
      saveGraph: (graph: AgentGraph) => Promise<boolean>
      listWindows: () => Promise<{ title: string; handle: string }[]>
      getA11yTree: (opts?: { windowTitle?: string }) => Promise<A11yNode>
      startRecord: () => Promise<boolean>
      stopRecord: () => Promise<boolean>
      captureNow: () => Promise<{
        kind: string
        at: number
        element: A11yNode
        suggestedPrompt: string
      } | null>
      runAgent: (graph: AgentGraph) => Promise<boolean>
      testOpenRouter: () => Promise<{ ok: boolean }>
      onRecordEvent: (cb: (payload: unknown) => void) => () => void
      onAgentLog: (cb: (payload: unknown) => void) => () => void
      onAgentStep: (cb: (payload: unknown) => void) => () => void
    }
  }
}

export {}
