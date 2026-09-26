import { contextBridge, ipcRenderer } from 'electron'

function on(channel: string) {
  return (cb: (payload: unknown) => void) => {
    const listener = (_: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

contextBridge.exposeInMainWorld('xpAgent', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (partial: unknown) => ipcRenderer.invoke('settings:save', partial),
  getGraph: () => ipcRenderer.invoke('graph:get'),
  saveGraph: (graph: unknown) => ipcRenderer.invoke('graph:save', graph),

  listWindows: () => ipcRenderer.invoke('windows:list'),
  scanScreen: (windowTitle?: string) => ipcRenderer.invoke('screen:scan', windowTitle),

  captureAfter: (ms: number) => ipcRenderer.invoke('capture:afterDelay', ms),

  runAgent: (graph: unknown, startId?: string) => ipcRenderer.invoke('agent:run', graph, startId),
  stopAgent: () => ipcRenderer.invoke('agent:stop'),

  testOpenRouter: () => ipcRenderer.invoke('openrouter:test'),
  listModels: () => ipcRenderer.invoke('openrouter:models'),
  testVision: () => ipcRenderer.invoke('openrouter:testVision'),

  onAgentLog: on('agent:log'),
  onAgentStep: on('agent:step'),
  onAgentAnchor: on('agent:anchor'),
  onAgentLoop: on('agent:loop'),
  pickFolder: (extensions: string[]) => ipcRenderer.invoke('dialog:pickFolder', extensions),
})
