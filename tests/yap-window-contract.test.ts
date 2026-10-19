import { beforeEach, expect, it, vi } from 'vitest'
import { callTool, type ToolContext } from '../electron/tools'
import { DEFAULT_SETTINGS, createNode } from '../electron/graph-types'
import { recoveryExecutor } from '../electron/recovery-runtime'
import { windowScript } from '../electron/windows-tools'
import { yapFingerprint } from '../electron/yap-context'
import { updateViewerHud } from '../electron/viewer-hud'

const fixture = vi.hoisted(() => ({ scan: vi.fn(), windows: vi.fn(), fail: false }))
vi.mock('electron', () => ({ screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }) } }))
vi.mock('../electron/a11y-bridge', () => ({ scan: fixture.scan, listWindows: fixture.windows, cursorPos: async () => ({ x: 0, y: 0 }) }))
const base = () => ({ getGraph: () => ({ nodes: [], edges: [] }), getSettings: () => DEFAULT_SETTINGS, isRunning: () => false, userStop: () => false,
  log: vi.fn(), permission: () => 'auto', sendStep: () => {},
}) as unknown as ToolContext
beforeEach(() => {
  vi.clearAllMocks()
  fixture.windows.mockResolvedValue([{ title: 'Editor', handle: '123', pid: 55 }])
  fixture.scan.mockResolvedValue({ items: [], area: { x: 0, y: 0, w: 100, h: 100 }, image: null, window: 'Editor', windowHandle: '123', windowPid: 55 })
})

it('requested titles use strict read-only matching even with fresh:true', async () => {
  const result = await callTool('screen.read', { windowTitle: 'Editor' }, base(), 'panel')
  expect(fixture.scan).toHaveBeenCalledWith(expect.objectContaining({ windowTitle: 'Editor', strictWindow: 'exact', fresh: true, readOnly: true }))
  expect(result).toMatchObject({ ok: true, data: { matched: true } })
})
it('an absent requested window cannot be reported as a successful read', async () => {
  fixture.scan.mockResolvedValue({ items: [], area: { x: 0, y: 0, w: 0, h: 0 }, image: null, window: '', missingWindow: 'Editor' })
  const result = await callTool('screen.read', { windowTitle: 'Editor' }, base(), 'panel')
  expect(result).toMatchObject({ ok: false, outcome: 'hedef-yok', data: { matched: false } })
  expect(result.message).not.toContain('yerine')
})
it('stable identity is passed through with PID and rejects a reused handle', async () => {
  const good = await callTool('screen.read', { hwnd: '123', pid: 55 }, base(), 'panel')
  expect(fixture.scan).toHaveBeenCalledWith(expect.objectContaining({ windowHandle: '123', windowPid: 55 }))
  expect(good.data?.matched).toBe(true)
  fixture.scan.mockResolvedValue({ items: [], area: { x: 0, y: 0, w: 100, h: 100 }, image: null, window: 'Editor', windowHandle: '123', windowPid: 99 })
  const bad = await callTool('screen.read', { hwnd: '123', pid: 55 }, base(), 'panel')
  expect(bad.data?.matched).toBe(false); expect(bad.ok).toBe(false)
})
it('default Yap reads omit OCR/UIA while details:true explicitly asks for them', async () => {
  const node = createNode('ai', 0, 0)
  const execute = recoveryExecutor({ graph: { nodes: [node], edges: [] }, node, live: node, stepNo: 1, vars: {}, ahead: {}, error: Error('') }, base(), () => false, undefined, true)
  await execute('screen.read', {})
  expect(fixture.scan).toHaveBeenLastCalledWith(expect.objectContaining({ ocr: false, uia: false, image: 'plain' }))
  await execute('screen.read', { details: true })
  expect(fixture.scan).toHaveBeenLastCalledWith(expect.objectContaining({ ocr: true, uia: true, image: 'plain' }))
})
it('invalid HWND/PID never reaches native scanning', async () => {
  const result = await callTool('screen.read', { hwnd: '123' }, base(), 'panel')
  expect(result.ok).toBe(false); expect(fixture.scan).not.toHaveBeenCalled()
})
it('window scripts validate PID before sending the action and read back the maximized state', () => {
  const code = windowScript({ action: 'maximize', hwnd: '123', pid: 55 }, 9)
  expect(code.indexOf('targetPid -ne 55')).toBeLessThan(code.indexOf('ShowWindow($h,3)'))
  expect(code).toContain('IsZoomed($h)'); expect(code).toContain('GetWindowText($h,$t,1024)')
  expect(code).toContain('GetWindowRect($h,[ref]$r)')
  expect(() => windowScript({ action: 'maximize', hwnd: "123'; bad", pid: 55 }, 9)).toThrow('HWND')
  expect(() => windowScript({ action: 'maximize', hwnd: '123' }, 9)).toThrow('PID')
})
it('action identity does not depend on JSON property order', () => {
  expect(yapFingerprint({ tool: 'act_type', args: { text: 'x', into: 'y' } })).toBe(yapFingerprint({ args: { into: 'y', text: 'x' }, tool: 'act_type' }))
})
it('the existing desktop/phone method channel retains progress in reconnect snapshots', () => {
  const hud = updateViewerHud(undefined, 'hud:method', { text: 'Yap · Son model cevabı: 10 sn önce · Son eylem: 20 sn önce' })
  expect(hud?.method).toContain('Son model cevabı: 10 sn önce')
  expect(updateViewerHud(hud, 'hud:method', { text: '' })?.method).toBe('')
})
