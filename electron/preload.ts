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
  getCanvases: () => ipcRenderer.invoke('canvases:get'),
  saveCanvases: (book: unknown) => ipcRenderer.invoke('canvases:save', book),

  listWindows: () => ipcRenderer.invoke('windows:list'),
  scanScreen: (windowTitle?: string, ramp?: { lo: number; hi: number }) => ipcRenderer.invoke('screen:scan', windowTitle, ramp),
  matchChrome: (rect: { x: number; y: number; w: number; h: number }) => ipcRenderer.invoke('chrome:match', rect),
  pickScreenBox: (box: unknown) => ipcRenderer.invoke('screen:pick', box),

  captureAfter: (ms: number) => ipcRenderer.invoke('capture:afterDelay', ms),

  runAgent: (graph: unknown, startId?: string, packagePath?: string[]) => ipcRenderer.invoke('agent:run', graph, startId, packagePath),
  stopAgent: () => ipcRenderer.invoke('agent:stop'),
  openLogs: () => ipcRenderer.invoke('logs:open'),

  testOpenRouter: () => ipcRenderer.invoke('openrouter:test'),
  listModels: () => ipcRenderer.invoke('openrouter:models'),
  testVision: () => ipcRenderer.invoke('openrouter:testVision'),

  onAgentLog: on('agent:log'),
  onAgentStep: on('agent:step'),
  onAgentPatch: on('agent:patch'),
  onHud: on('hud:status'),
  onHudLoop: on('hud:loop'),
  onHudMethod: on('hud:method'),
  pickFolder: (extensions: string[]) => ipcRenderer.invoke('dialog:pickFolder', extensions),
  listDir: (dir: string) => ipcRenderer.invoke('dialog:listDir', dir),
  pickDir: () => ipcRenderer.invoke('dialog:pickDir'),
})
