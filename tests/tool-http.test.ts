import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createNode, type AgentGraph, type AppSettings } from '../electron/graph-types'
import { endpointInfo, startEndpoint, stopEndpoint } from '../electron/tool-http'
import type { ToolContext } from '../electron/tools'

function ctx(graph: AgentGraph): ToolContext {
  return {
    getGraph: () => graph,
    getSettings: () => ({ agentPermission: 'auto' }) as AppSettings,
    log: () => {},
    isRunning: () => false,
    userStop: () => false,
    sendStep: () => {},
    permission: () => 'auto',
    askApproval: async () => true,
    requestStop: () => {},
    startRun: async () => ({ ok: true }),
    getCanvases: () => ({ activeId: 'c1', tabs: [{ id: 'c1', name: 'Tuval 1', graph }] }),
    saveCanvases: () => {},
  }
}

function tempFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-endpoint-')), 'tool-endpoint.json')
}

const graph: AgentGraph = { nodes: [createNode('start', 0, 0)], edges: [] }

describe('yerel uç nokta', () => {
  it('jeton ister, araçları listeler, çağrıyı taşır ve kapanınca jeton dosyasını siler', async () => {
    const file = tempFile()
    const started = await startEndpoint(ctx(graph), file)
    try {
      expect(started.port).toBeGreaterThan(0)
      expect(fs.existsSync(file)).toBe(true)
      const token = JSON.parse(fs.readFileSync(file, 'utf8')).token as string
      expect(typeof token).toBe('string')

      const base = `http://127.0.0.1:${started.port}`
      expect((await fetch(`${base}/health`)).status).toBe(200)
      expect((await fetch(`${base}/tools`)).status).toBe(401)

      const tools = (await (await fetch(`${base}/tools`, { headers: { authorization: `Bearer ${token}` } })).json()) as {
        tools: { name: string }[]
      }
      expect(tools.tools.map((t) => t.name)).toContain('step.run')
      expect(tools.tools.map((t) => t.name)).toContain('flow.context')

      const call = await fetch(`${base}/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'flow.read', args: { graph } }),
      })
      const result = (await call.json()) as { ok: boolean; tool: string; message: string }
      expect(call.status).toBe(200)
      expect(result.ok).toBe(true)
      expect(result.tool).toBe('flow.read')
      expect(result.message).toContain('node')
      expect(endpointInfo()?.port).toBe(started.port)
    } finally {
      await stopEndpoint()
    }
    expect(fs.existsSync(file)).toBe(false)
    expect(endpointInfo()).toBeNull()
  })

  it('bozuk gövdeyi ve bilinmeyen yolu reddeder', async () => {
    const file = tempFile()
    const started = await startEndpoint(ctx(graph), file)
    const base = `http://127.0.0.1:${started.port}`
    const auth = { 'content-type': 'application/json', authorization: `Bearer ${JSON.parse(fs.readFileSync(file, 'utf8')).token}` }
    try {
      const broken = await fetch(`${base}/call`, { method: 'POST', headers: auth, body: 'bu json degil' })
      expect(broken.status).toBe(400)
      const noName = await fetch(`${base}/call`, { method: 'POST', headers: auth, body: JSON.stringify({ args: {} }) })
      expect(noName.status).toBe(400)
      expect((await fetch(`${base}/yok`, { headers: auth })).status).toBe(404)
    } finally {
      await stopEndpoint()
    }
  })
})
