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
  /** Empty for the person's own instance; the profile name for a test instance. */
  profile: String(process.env.NUBBO_PROFILE ?? ''),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  onCloseRequested: on('window:close-requested'),
  finishClose: (id: number, allow: boolean) => ipcRenderer.invoke('window:finish-close', id, allow),
  bootReady: () => ipcRenderer.send('boot:ready'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (partial: unknown) => ipcRenderer.invoke('settings:save', partial),
  getGraph: () => ipcRenderer.invoke('graph:get'),
  saveGraph: (graph: unknown) => ipcRenderer.invoke('graph:save', graph),
  libraryInfo: () => ipcRenderer.invoke('library:info'),
  viewerInfo: () => ipcRenderer.invoke('viewer:info'),
  manageViewer: (action: string) => ipcRenderer.invoke('viewer:manage', action),
  manageLibrary: (mode: string) => ipcRenderer.invoke('library:manage', mode),
  zipLibraryAction: (action: unknown) => ipcRenderer.invoke('zip-library:action', action),
  getCanvases: () => ipcRenderer.invoke('canvases:get'),
  saveCanvases: (book: unknown) => ipcRenderer.invoke('canvases:save', book),

  listWindows: () => ipcRenderer.invoke('windows:list'),
  scanScreen: (windowTitle?: string, ramp?: { lo: number; hi: number }) => ipcRenderer.invoke('screen:scan', windowTitle, ramp),
  matchChrome: (rect: { x: number; y: number; w: number; h: number }) => ipcRenderer.invoke('chrome:match', rect),
  pickScreenBox: (box: unknown) => ipcRenderer.invoke('screen:pick', box),

  captureAfter: (ms: number) => ipcRenderer.invoke('capture:afterDelay', ms),

  runAgent: (graph: unknown, startId?: string, packagePath?: string[], opts?: { derived?: boolean; requireEnd?: boolean }) =>
    ipcRenderer.invoke('agent:run', graph, startId, packagePath, opts),
  stopAgent: () => ipcRenderer.invoke('agent:stop'),
  callTool: (name: string, args?: unknown) => ipcRenderer.invoke('tools:call', name, args, 'panel'),
  toolList: () => ipcRenderer.invoke('tools:list'),
  toolEndpoint: () => ipcRenderer.invoke('tools:endpoint'),
  toolEndpointOpen: () => ipcRenderer.invoke('tools:endpointOpen'),
  openLogs: () => ipcRenderer.invoke('logs:open'),
  showInFolder: (path: string) => ipcRenderer.invoke('shell:showItem', path),
  openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
  recoveryReports: () => ipcRenderer.invoke('recovery:reports'),
  removeRecoveryReport: (id: string) => ipcRenderer.invoke('recovery:removeReport', id),
  clearRecoveryReports: () => ipcRenderer.invoke('recovery:clearReports'),
  copyRecoveryReportText: (text: string) => ipcRenderer.invoke('recovery:copyText', text),
  onRecoveryReportsRemoved: on('recovery:removed'),
  openRecoveryReports: () => ipcRenderer.invoke('recovery:openReports'),

  testOpenRouter: () => ipcRenderer.invoke('openrouter:test'),
  listModels: () => ipcRenderer.invoke('openrouter:models'),
  listLocalModels: (base?: string) => ipcRenderer.invoke('local:models', base),
  localChat: (payload: { prompt: string; target?: 'local' | 'api'; model?: string }) => ipcRenderer.invoke('local:chat', payload),
  missingPaths: (paths: string[]) => ipcRenderer.invoke('paths:missing', paths),
  testVision: () => ipcRenderer.invoke('openrouter:testVision'),

  onAgentLog: on('agent:log'),
  onAgentStep: on('agent:step'),
  onAgentEdge: on('agent:edge'),
  onAgentPatch: on('agent:patch'),
  onAgentGraph: on('agent:graph'),
  replyAgentGraph: (answer: { ok: boolean; error?: string }) => ipcRenderer.send('agent:graph-applied', answer),
  onRecoveryReport: on('recovery:report'),
  onRecoveryStatus: on('recovery:status'),
  onHud: on('hud:status'),
  onHudLoop: on('hud:loop'),
  onHudMethod: on('hud:method'),
  onHudCountdown: on('hud:countdown'),
  onHudStages: on('hud:stages'),
  onHudContext: on('hud:context'),
  onHudMemory: on('hud:memory'),
  pickFolder: (extensions: string[]) => ipcRenderer.invoke('dialog:pickFolder', extensions),
  listDir: (dir: string) => ipcRenderer.invoke('dialog:listDir', dir),
  pickDir: () => ipcRenderer.invoke('dialog:pickDir'),
})
