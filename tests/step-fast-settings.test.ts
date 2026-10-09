import { describe, expect, it, vi } from 'vitest'
import { createNode, DEFAULT_SETTINGS, type AppSettings } from '../electron/graph-types'
import { callTool, withFastFind, type ToolContext } from '../electron/tools'

const seen = vi.hoisted(() => ({ settings: null as AppSettings | null, clicks: 0 }))
vi.mock('../electron/agent', () => ({ createAgent: (options: { settings: () => AppSettings }) => {
  seen.settings = options.settings()
  return { executor: { log: () => {}, step: () => {}, shouldStop: () => false,
    click: async () => { seen.clicks++ }, type: async () => {}, key: async () => {}, exists: async () => true } }
} }))
describe('step.run passes the promised settings to its actual agent', () => {
  it.each([true, false])('fast=%s controls model stages without preventing the requested step', async fast => {
    const node = createNode('click', 0, 0), graph = { nodes: [node], edges: [] }
    const settings = { ...DEFAULT_SETTINGS, stepDelayMs: 0, findOrder: ['list', 'tars', 'windows'] as AppSettings['findOrder'] }
    const context: ToolContext = { getGraph: () => graph, getSettings: () => settings, log: () => {}, isRunning: () => false,
      userStop: () => false, sendStep: () => {}, permission: () => 'auto', askApproval: async () => true, requestStop: () => {},
      startRun: async () => ({ ok: true }), getCanvases: () => ({ activeId: 'test', tabs: [{ id: 'test', name: 'test', graph }] }), saveCanvases: () => {}, applyMerge: async () => ({ ok: true }) }
    seen.clicks = 0
    const result = await callTool('step.run', { nodeId: node.id, fast }, context, 'panel')
    expect(result.ok).toBe(true); expect(seen.clicks).toBe(1)
    expect(seen.settings!.findOrder).toEqual(fast ? withFastFind(settings).findOrder : settings.findOrder)
  })
})
