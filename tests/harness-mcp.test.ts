import { expect, it, vi } from 'vitest'
import { startHarnessMcp } from '../electron/harness-mcp'
import { harnessLaunch } from '../electron/harness-acp'
import { harnessSettings } from '../electron/recovery-settings'
it('serializes desktop calls, deduplicates operations across RPC IDs, and revokes the paused-run capability', async () => {
  const execute = vi.fn(async () => { await new Promise(r => setTimeout(r, 20)); return { ok: true, outcome: 'tamam', message: 'sent' } })
  const server = await startHarnessMcp({ tools: [{ name: 'act_key', description: 'key', inputSchema: { type: 'object', properties: { keys: { type: 'string' } }, required: ['keys'] } }], stopped: () => false, instructions: '', execute })
  let id = 0
  const call = async (args: unknown, auth = true) => {
    const res = await fetch(server.declaration.url, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: server.declaration.headers[0].value } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'act_key', arguments: args } }) })
    return { status: res.status, body: res.ok ? await res.json() : undefined }
  }
  try {
    expect((await call({ keys: 'enter', operationId: 'one' }, false)).status).toBe(403)
    const replies = await Promise.all([call({ keys: 'enter', operationId: 'one' }), call({ keys: 'enter', operationId: 'one' })])
    expect(replies.every(r => r.body.result.isError === false)).toBe(true); expect(execute).toHaveBeenCalledTimes(1)
    expect((await call({ keys: 'delete', operationId: 'one' })).body.error).toBeTruthy()
    expect((await call({ keys: 'enter' })).body.error).toBeTruthy()
    server.revoke(); expect((await call({ keys: 'enter', operationId: 'two' })).status).toBe(410)
    expect(execute).toHaveBeenCalledTimes(1)
  } finally { await server.close() }
})
it('starts Windows CMD launchers with separate controlled args and rejects expansion characters', () => {
  const good = harnessLaunch(harnessSettings({ command: 'C:\\Program Files\\DSH\\dsh.cmd' }), 'win32')
  expect(good.args.slice(0, 4)).toEqual(['/d', '/v:off', '/s', '/c'])
  expect(good.args[4]).toContain('"--profile" "acp"')
  expect(() => harnessLaunch(harnessSettings({ command: 'C:\\DSH\\dsh.cmd', args: ['%SECRET%'] }), 'win32')).toThrow('kabuk')
})
it('returns a job ticket for a slow tool and delivers its image later without replay', async () => {
  let finish!: () => void
  const waiting = new Promise<void>(resolve => { finish = resolve })
  const delivered = vi.fn()
  const execute = vi.fn(async () => { await waiting; return { ok: true, outcome: 'tamam', message: 'frame', data: { image: { data: 'Zml4dHVyZQ==', mime: 'image/png' } } } })
  const server = await startHarnessMcp({ tools: [{ name: 'screen_read', description: 'read', inputSchema: { type: 'object', properties: {} } }], stopped: () => false, instructions: '', execute, delivered, deferAfterMs: 5 })
  let id = 0
  const call = async (name: string, args: unknown = {}) => {
    const res = await fetch(server.declaration.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: server.declaration.headers[0].value }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) })
    return (await res.json()).result
  }
  try {
    const pending = await call('screen_read')
    const ticket = JSON.parse(pending.content[0].text)
    expect(ticket.pending).toBe(true); expect(delivered).not.toHaveBeenCalled()
    finish()
    const frame = await call('nubbo_job', { jobId: ticket.jobId, waitMs: 1000 })
    expect(frame.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' })
    expect(execute).toHaveBeenCalledTimes(1); expect(delivered).toHaveBeenCalledTimes(1)
  } finally { finish(); await server.close() }
})
it('blocks speculative input until a previous mutation result is received but permits an immediate stop', async () => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const seen: string[] = []
  const server = await startHarnessMcp({
    tools: [
      { name: 'act_key', description: 'key', inputSchema: { type: 'object', properties: { keys: { type: 'string' } }, required: ['keys'] } },
      { name: 'recovery_finish', description: 'stop', inputSchema: { type: 'object', properties: { decision: { type: 'string', enum: ['stop'] } }, required: ['decision'] } },
    ], stopped: () => false, instructions: '', deferAfterMs: 5,
    execute: async name => { seen.push(name); if (name === 'act_key') await pending; return { ok: true, outcome: 'tamam', message: 'ok' } },
  })
  let id = 0
  const call = async (name: string, args: unknown) => (await (await fetch(server.declaration.url, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: server.declaration.headers[0].value },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }),
  })).json())
  try {
    const first = await call('act_key', { keys: 'enter', operationId: 'one' })
    expect(JSON.parse(first.result.content[0].text).pending).toBe(true)
    expect((await call('act_key', { keys: 'delete', operationId: 'two' })).error).toBeTruthy()
    const stop = await call('recovery_finish', { decision: 'stop', operationId: 'stop' })
    expect(stop.result.isError).toBe(false)
    expect(seen).toEqual(['act_key', 'recovery_finish'])
  } finally { release(); await server.close() }
})
it('deduplicates an identical operation when JSON argument key order differs', async () => {
  const execute = vi.fn(async () => ({ ok: true, outcome: 'tamam', message: 'sent' }))
  const server = await startHarnessMcp({ tools: [{ name: 'act_key', description: 'key', inputSchema: { type: 'object', properties: { keys: { type: 'string' }, window: { type: 'string' } }, required: ['keys', 'window'] } }], stopped: () => false, instructions: '', execute })
  let id = 0
  const call = async (args: unknown) => (await (await fetch(server.declaration.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: server.declaration.headers[0].value }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'act_key', arguments: args } }) })).json())
  try {
    expect((await call({ keys: 'enter', window: 'Blender', operationId: 'one' })).result.isError).toBe(false)
    expect((await call({ window: 'Blender', operationId: 'one', keys: 'enter' })).result.isError).toBe(false)
    expect(execute).toHaveBeenCalledTimes(1)
  } finally { await server.close() }
})
it('bounds already-observed read-job history in an indefinitely running session', async () => {
  let calls = 0
  const server = await startHarnessMcp({ tools: [{ name: 'nubbo_context', description: 'read', inputSchema: { type: 'object', properties: {} } }], stopped: () => false, instructions: '', deferAfterMs: 1,
    execute: async () => { if (++calls === 1) await new Promise(resolve => setTimeout(resolve, 10)); return { ok: true, outcome: 'tamam', message: 'context' } },
  })
  let id = 0
  const call = async (name: string, args = {}) => (await (await fetch(server.declaration.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: server.declaration.headers[0].value }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) })).json())
  try {
    const first = await call('nubbo_context')
    const ticket = JSON.parse(first.result.content[0].text)
    expect(ticket.pending).toBe(true)
    await call('nubbo_job', { jobId: ticket.jobId, waitMs: 1000 })
    for (let i = 0; i < 70; i++) await call('nubbo_context')
    expect((await call('nubbo_job', { jobId: ticket.jobId })).error).toBeTruthy()
    expect((await call('nubbo_context')).result.isError).toBe(false)
  } finally { await server.close() }
})
it('does not mark an aborted HTTP response observed and does not replay its operation', async () => {
  let began!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { began = resolve })
  const waiting = new Promise<void>(resolve => { release = resolve })
  const delivered = vi.fn(), execute = vi.fn(async () => { began(); await waiting; return { ok: true, outcome: 'tamam', message: 'sent' } })
  const server = await startHarnessMcp({ tools: [{ name: 'act_key', description: 'key', inputSchema: { type: 'object', properties: { keys: { type: 'string' } }, required: ['keys'] } }], stopped: () => false, instructions: '', execute, delivered, deferAfterMs: 1000 })
  let id = 0
  const call = async (signal?: AbortSignal) => {
    const res = await fetch(server.declaration.url, { method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: server.declaration.headers[0].value }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'act_key', arguments: { keys: 'enter', operationId: 'once' } } }) })
    return res.json()
  }
  try {
    const abort = new AbortController()
    const first = call(abort.signal).catch(error => error)
    await started; abort.abort()
    await first
    await new Promise(resolve => setTimeout(resolve, 20))
    release()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(delivered).not.toHaveBeenCalled()
    expect((await call()).result.isError).toBe(false)
    expect(execute).toHaveBeenCalledTimes(1); expect(delivered).toHaveBeenCalledTimes(1)
  } finally { release(); await server.close() }
})
