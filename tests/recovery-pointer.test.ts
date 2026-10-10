import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgent } from '../electron/agent'
import { recoveryExecutor } from '../electron/recovery-runtime'
import { DEFAULT_SETTINGS, createNode } from '../electron/graph-types'
import { DEFAULT_RECOVERY } from '../electron/recovery-settings'
import { StoppedError } from '../electron/runner'
import type { ToolContext } from '../electron/tools'
const fixture = vi.hoisted(() => ({ cursor: { x: 0, y: 0 }, area: { x: -200, y: 40, w: 1001, h: 501 }, image: 'FRAME',
  move: vi.fn(), click: vi.fn(), locked: vi.fn(async () => false), cursorRead: vi.fn(), read: vi.fn() }))
vi.mock('electron', () => ({ screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }) } }))
vi.mock('../electron/a11y-bridge', () => ({ isLocked: fixture.locked, moveMouse: fixture.move, clickAt: fixture.click, cursorPos: fixture.cursorRead }))
vi.mock('../electron/tools', () => ({ callTool: fixture.read }))
beforeEach(() => {
  vi.clearAllMocks()
  fixture.area = { x: -200, y: 40, w: 1001, h: 501 }; fixture.image = 'FRAME'; fixture.cursor = { x: 0, y: 0 }
  fixture.move.mockImplementation(async (x, y) => { fixture.cursor = { x, y }; return {} })
  fixture.click.mockResolvedValue(undefined)
  fixture.cursorRead.mockImplementation(async () => ({ ...fixture.cursor }))
  fixture.read.mockImplementation(async () => ({ ok: true, outcome: 'tamam', message: 'Screen', data: { area: { ...fixture.area }, image: { data: fixture.image } } }))
})
function harness(allowDesktop = true) {
  let stop = false
  const settings = { ...DEFAULT_SETTINGS, stepDelayMs: 0, recovery: { ...DEFAULT_RECOVERY, enabled: true, allowDesktop } }
  const send = vi.fn(), agent = createAgent({ settings: () => settings, log: vi.fn(), send, shouldStop: () => stop })
  const node = createNode('click', 0, 0), graph = { nodes: [node], edges: [] }
  const request = { node, live: node, graph, error: new Error('wrong click'), stepNo: 1, vars: {}, ahead: {} }
  const execute = recoveryExecutor(request, { getSettings: () => settings, log: vi.fn() } as unknown as ToolContext, () => stop, agent.executor)
  return { execute, graph, send, stop: () => { stop = true } }
}
describe('recovery pointer through the real normal agent input path', () => {
  it('aligns without clicking, reports the cursor and double-clicks its actual position without editing nodes', async () => {
    const h = harness(), before = JSON.stringify(h.graph)
    await h.execute('screen.read', {})
    const moved = await h.execute('act.move', { x: .5, y: .5 })
    expect(fixture.move).toHaveBeenCalledExactlyOnceWith(300, 290)
    expect(fixture.click).not.toHaveBeenCalled()
    expect(moved.data?.sent).toBe(false)
    const frame = await h.execute('screen.read', {})
    expect(frame.data?.cursor).toMatchObject({ x: 300, y: 290, rx: .5, ry: .5 })
    fixture.cursor = { x: 302, y: 291 }
    const click = await h.execute('act.clickCurrent', { mode: 'double' })
    expect(fixture.click).toHaveBeenCalledExactlyOnceWith(302, 291, 'double')
    expect(click.message).toContain('@302,291'); expect(click.data?.sent).toBe(true)
    expect(JSON.stringify(h.graph)).toBe(before); expect(h.send).not.toHaveBeenCalled()
  })
  it('uses the latest cropped/scaled screen origin and size, including negative monitor coordinates', async () => {
    const h = harness()
    await h.execute('screen.read', {})
    fixture.area = { x: -1920, y: 10, w: 1920, h: 1080 }
    await h.execute('screen.read', {})
    await h.execute('act.clickPoint', { x: 1, y: 1, mode: 'right' })
    expect(fixture.click).toHaveBeenCalledExactlyOnceWith(-1, 1089, 'right')
  })
  it('does not dispatch invalid coordinates or coordinates without an available screenshot', async () => {
    const h = harness()
    await expect(h.execute('act.move', { x: .5, y: .5 })).rejects.toThrow('screen_read')
    await h.execute('screen.read', {})
    for (const x of [-1, 2, NaN, Infinity]) await expect(h.execute('act.clickPoint', { x, y: .5 })).rejects.toThrow('0–1')
    fixture.image = ''; await h.execute('screen.read', {})
    await expect(h.execute('act.move', { x: .5, y: .5 })).rejects.toThrow('screen_read')
    expect(fixture.move).not.toHaveBeenCalled(); expect(fixture.click).not.toHaveBeenCalled()
  })
  it('honors desktop permission and Stop during the actual cursor read', async () => {
    const denied = harness(false)
    await expect(denied.execute('act.clickCurrent', {})).rejects.toThrow('kapalı')
    const h = harness()
    fixture.cursorRead.mockImplementationOnce(async () => { h.stop(); return { x: 100, y: 200 } })
    await expect(h.execute('act.clickCurrent', { mode: 'double' })).rejects.toBeInstanceOf(StoppedError)
    expect(fixture.click).not.toHaveBeenCalled()
  })
})
