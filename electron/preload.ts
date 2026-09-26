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
  getA11yTree: (windowTitle?: string) => ipcRenderer.invoke('a11y:tree', windowTitle),

  startRecord: () => ipcRenderer.invoke('record:start'),
  stopRecord: () => ipcRenderer.invoke('record:stop'),
  captureAfter: (ms: number) => ipcRenderer.invoke('record:captureAfter', ms),

  runAgent: (graph: unknown, startId?: string) => ipcRenderer.invoke('agent:run', graph, startId),
  stopAgent: () => ipcRenderer.invoke('agent:stop'),

  testOpenRouter: () => ipcRenderer.invoke('openrouter:test'),
  listModels: () => ipcRenderer.invoke('openrouter:models'),

  onRecordEvent: on('record:event'),
  onAgentLog: on('agent:log'),
  onAgentStep: on('agent:step'),
})
