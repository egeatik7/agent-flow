import http from 'node:http'
import crypto from 'node:crypto'
import type { ModelTool } from './openrouter'
import type { RecoveryToolResult } from './recovery'

export type McpTool = { name: string; description: string; inputSchema: Record<string, any> }
export const mcpTool = (tool: ModelTool): McpTool => ({ name: tool.function.name, description: tool.function.description, inputSchema: tool.function.parameters })
const READ_ONLY = new Set(['nubbo_status', 'nubbo_context', 'nubbo_logs', 'nubbo_job', 'screen_read', 'flow_read', 'flow_context', 'target_preview'])
export function isMutation(name: string) { return !READ_ONLY.has(name) }
export function validateTool(tool: McpTool, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Araç argümanları nesne olmalı.')
  const args = value as Record<string, unknown>
  const properties = tool.inputSchema.properties ?? {}
  for (const key of tool.inputSchema.required ?? []) if (args[key] === undefined) throw new Error(`Eksik alan: ${key}`)
  for (const [key, val] of Object.entries(args)) {
    const spec = properties[key]
    if (!spec) throw new Error(`Bilinmeyen alan: ${key}`)
    if (spec.type === 'integer' ? typeof val !== 'number' || !Number.isSafeInteger(val) : typeof val !== spec.type) throw new Error(`Geçersiz alan: ${key}`)
    if (typeof val === 'number' && (!Number.isFinite(val) || spec.minimum !== undefined && val < spec.minimum || spec.maximum !== undefined && val > spec.maximum)) throw new Error(`Alan sınır dışında: ${key}`)
    if (spec.enum && !spec.enum.includes(val)) throw new Error(`Geçersiz seçim: ${key}`)
    if (typeof val === 'string' && (val.length > (spec.maxLength ?? 150_000) || spec.minLength && val.trim().length < spec.minLength)) throw new Error(`Metin uzunluğu geçersiz: ${key}`)
  }
  return args
}

/** Per-recovery, authenticated, stateless Streamable HTTP MCP. It never opens the general agent API. */
export async function startHarnessMcp(options: {
  tools: McpTool[]
  stopped: () => boolean
  execute: (name: string, args: Record<string, unknown>) => Promise<RecoveryToolResult>
  instructions: string
  delivered?: (name: string, result: RecoveryToolResult) => void
  deferAfterMs?: number
}) {
  let revoked = false
  let tail: Promise<unknown> = Promise.resolve()
  const token = crypto.randomBytes(32).toString('hex')
  type Job = { name: string; result: Promise<any>; output?: RecoveryToolResult; done: boolean }
  const jobs = new Map<string, Job>()
  let jobCounter = 0
  const ledger = new Map<string, { signature: string; jobId: string }>()
  const jobTool: McpTool = { name: 'nubbo_job', description: 'Uzun araç işleminin sonucunu bekle. Pending cevabındaki jobId ile çağır; aynı eylemi yeniden gönderme. Ekran görüntüsü hazırsa bu sonuçta gelir.', inputSchema: { type: 'object', properties: { jobId: { type: 'string' }, waitMs: { type: 'integer', minimum: 0, maximum: 10000 } }, required: ['jobId'], additionalProperties: false } }
  const deliver = async (jobId: string, waitMs: number) => {
    const job = jobs.get(jobId)
    if (!job) throw new Error('Bu oturuma ait işlem bulunamadı.')
    let timer: ReturnType<typeof setTimeout> | undefined
    const pending = { content: [{ type: 'text', text: JSON.stringify({ pending: true, jobId, instruction: 'İşlem sürüyor. nubbo_job ile sonucu bekle; eylemi yeniden gönderme.' }) }], isError: false }
    try {
      const value = await Promise.race([job.result, new Promise(resolve => { timer = setTimeout(() => resolve(pending), waitMs) })])
      if (value !== pending && job.output) options.delivered?.(job.name, job.output)
      return value
    } finally { clearTimeout(timer) }
  }
  const tools = options.tools.map(tool => isMutation(tool.name) ? { ...tool, inputSchema: { ...tool.inputSchema,
    properties: { ...tool.inputSchema.properties, operationId: { type: 'string', minLength: 1, maxLength: 128, description: 'Bu işlem için benzersiz kimlik. Aynı işlemi sorgulamak/tekrar göndermek için aynı kimliği kullan; yeni kimlik aynı eylemi yeniden yapar.' } },
    required: [...(tool.inputSchema.required ?? []), 'operationId'] } } : tool)
  tools.push(jobTool)
  const check = () => { if (revoked || options.stopped()) throw new Error('Kurtarma oturumu kapalı veya durduruldu.') }
  async function invoke(name: string, value: unknown) {
    const tool = tools.find(tool => tool.name === name)
    if (!tool) throw new Error('Kurtarmaya açık olmayan araç.')
    const args = { ...validateTool(tool, value) }
    if (name === 'nubbo_job') { check(); return deliver(String(args.jobId), Number(args.waitMs ?? 5000)) }
    const operationId = args.operationId; delete args.operationId
    const jobId = `job-${++jobCounter}`
    const job: Job = { name, result: Promise.resolve(), done: false }
    const signature = JSON.stringify([name, args])
    const run = async () => {
      check()
      try {
        const result = await options.execute(name, args)
        job.output = result
        const data = { ...result.data }
        const shot = data.image as { data?: string; mime?: string } | undefined
        delete data.image
        const content: any[] = [{ type: 'text', text: JSON.stringify({ ...result, data }) }]
        if (shot?.data) content.push({ type: 'image', data: shot.data, mimeType: shot.mime || 'image/png' })
        return { content, isError: !result.ok }
      } catch (error) { return { content: [{ type: 'text', text: (error as Error).message }], isError: true } }
    }
    check()
    const key = typeof operationId === 'string' ? operationId : ''
    if (key) {
      const old = ledger.get(key)
      if (old) { if (old.signature !== signature) throw new Error('operationId başka bir işlemde kullanılmış.'); return deliver(old.jobId, options.deferAfterMs ?? 1500) }
    }
    const result = tail.then(run).finally(() => { job.done = true })
    job.result = result
    jobs.set(jobId, job)
    // Keep only the latest two screen images after a new observation. Older text/path evidence remains.
    void result.then(() => {
      const frames = [...jobs.values()].filter(j => j.done && j.output?.data?.image)
      for (const old of frames.slice(0, -2)) {
        if (old.output?.data) delete old.output.data.image
        void old.result.then(value => { if (value?.content) value.content = value.content.filter((c: any) => c.type !== 'image') })
      }
    }).catch(() => {})
    tail = result.catch(() => {})
    if (key) ledger.set(key, { signature, jobId }) // reserve before execution; failures are never replayed
    return deliver(jobId, options.deferAfterMs ?? 1500)
  }
  async function rpc(message: any): Promise<any> {
    if (message.jsonrpc !== '2.0' || Array.isArray(message) || typeof message.method !== 'string') throw new Error('Geçersiz JSON-RPC.')
    const id = message.id
    if (message.method.startsWith('notifications/')) {
      // A timeout/cancel can leave a dispatched action ambiguous. Close the whole recovery gate.
      if (message.method === 'notifications/cancelled') revoked = true
      return undefined
    }
    if (typeof id !== 'string' && typeof id !== 'number') throw new Error('İstek kimliği gerekli.')
    const result = (async () => {
      try {
        check()
        let value: unknown
        if (message.method === 'initialize') {
          const requested = message.params?.protocolVersion
          const supported = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28']
          value = { protocolVersion: supported.includes(requested) ? requested : '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'nubbo-recovery', version: '1.9.175' }, instructions: options.instructions }
        } else if (message.method === 'ping') value = {}
        else if (message.method === 'tools/list') value = { tools }
        else if (message.method === 'tools/call') value = await invoke(message.params?.name, message.params?.arguments ?? {})
        else return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }
        return { jsonrpc: '2.0', id, result: value }
      } catch (error) { return { jsonrpc: '2.0', id, error: { code: -32602, message: (error as Error).message } } }
    })()
    return result
  }
  const server = http.createServer(async (req, res) => {
    const reply = (status: number, body?: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body === undefined ? undefined : JSON.stringify(body)) }
    if (req.url !== '/mcp') { reply(404); return }
    if (req.headers.authorization !== `Bearer ${token}` || req.headers.origin) { reply(403); return }
    if (revoked || options.stopped()) { reply(410); return }
    if (req.method !== 'POST') { reply(405); return }
    if (!req.headers['content-type']?.startsWith('application/json')) { reply(415); return }
    try {
      let size = 0; const chunks: Buffer[] = []
      for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new Error('İstek çok büyük.'); chunks.push(chunk) }
      const result = await rpc(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      reply(result === undefined ? 202 : 200, result)
    } catch (error) { reply(400, { error: (error as Error).message }) }
  })
  server.requestTimeout = 0
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('MCP adresi oluşturulamadı.')
  return {
    declaration: { type: 'http', name: 'nubbo', url: `http://127.0.0.1:${address.port}/mcp`, headers: [{ name: 'Authorization', value: `Bearer ${token}` }] },
    isRevoked: () => revoked,
    revoke: () => { revoked = true },
    async close() { revoked = true; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await tail },
  }
}
