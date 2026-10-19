import { describe, expect, it } from 'vitest'
import { assertModelKeysAllowed, keySet } from '../electron/key-guard'
import { callTool, type ToolContext, type ToolResult } from '../electron/tools'
import type { AppSettings } from '../electron/graph-types'

// Modelin canlı tuş seçimi: kapatma/silme kombinasyonları engellenir (key-guard artık bağlı).
describe('model tuş koruması', () => {
  it.each(['alt+f4', 'ALT+F4', ['alt', 'F4'] as unknown as string, 'ctrl+w', 'ctrl+q', 'shift+delete', 'delete', '%{F4}', '^w', '^q', '^+{w}', '^%{F4}', '{ESC}{DELETE}', '{DELETE}'])('%s engellenir', (keys) => {
    expect(() => assertModelKeysAllowed(keys as string)).toThrow(/engellendi/)
  })

  it.each(['enter', 'escape', 'ctrl+s', 'ctrl+shift+s', 'win+r', 'backspace', 'tab'])('%s serbest', (keys) => {
    expect(() => assertModelKeysAllowed(keys)).not.toThrow()
  })

  it('farklı yazım aynı kümeye çözülür', () => {
    expect(keySet(['Control', 'W'])).toEqual(['ctrl', 'w'])
    expect(keySet('%{F4}')).toEqual(['alt', 'f4'])
    expect(keySet('')).toBeNull()
  })

  it('act.key aracı alt+f4 isteğini reddeder ve girdi göndermez', async () => {
    let sent = 0
    const ctx = {
      getGraph: () => ({ nodes: [], edges: [] }), getSettings: () => ({ agentPermission: 'auto' }) as AppSettings,
      log: () => {}, isRunning: () => false, userStop: () => false, sendStep: () => {}, permission: () => 'auto',
      askApproval: async () => true, requestStop: () => {}, startRun: async () => ({ ok: true }),
      getCanvases: () => ({ activeId: 'c', tabs: [] }), saveCanvases: () => {},
      sendKey: () => { sent++ },
    } as unknown as ToolContext
    const result = await callTool('act.key', { keys: 'alt+f4' }, ctx) as ToolResult
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).toContain('engellendi')
    expect(sent).toBe(0)
  })
})
