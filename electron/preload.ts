import { contextBridge, ipcRenderer } from 'electron'

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

const api = {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (partial: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:save', partial),

  getGraph: (): Promise<AgentGraph> => ipcRenderer.invoke('graph:get'),
  saveGraph: (graph: AgentGraph): Promise<boolean> =>
    ipcRenderer.invoke('graph:save', graph),

  listWindows: (): Promise<{ title: string; handle: string }[]> =>
    ipcRenderer.invoke('windows:list'),
  getA11yTree: (opts?: { windowTitle?: string }) =>
    ipcRenderer.invoke('a11y:tree', opts),

  startRecord: () => ipcRenderer.invoke('record:start'),
  stopRecord: () => ipcRenderer.invoke('record:stop'),
  captureNow: () => ipcRenderer.invoke('record:captureNow'),

  runAgent: (graph: AgentGraph) => ipcRenderer.invoke('agent:run', graph),
  testOpenRouter: () => ipcRenderer.invoke('agent:testOpenRouter'),

  onRecordEvent: (cb: (payload: unknown) => void) => {
    const listener = (_: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on('record:event', listener)
    return () => ipcRenderer.removeListener('record:event', listener)
  },
  onAgentLog: (cb: (payload: unknown) => void) => {
    const listener = (_: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on('agent:log', listener)
    return () => ipcRenderer.removeListener('agent:log', listener)
  },
  onAgentStep: (cb: (payload: unknown) => void) => {
    const listener = (_: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on('agent:step', listener)
    return () => ipcRenderer.removeListener('agent:step', listener)
  },
}

contextBridge.exposeInMainWorld('xpAgent', api)

export type XpAgentApi = typeof api
