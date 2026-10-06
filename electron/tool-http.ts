/**
 * The local endpoint: how an outside agent reaches the same tools the panel uses.
 *
 * Bound to 127.0.0.1, protected by a token written to a file the caller can read, and started
 * only when the Ajan tab asks for it. Every call goes through callTool with source 'agent', so
 * the permission setting applies unchanged. This module knows nothing about flows or input: it
 * is a thin door, and closing it leaves nothing behind.
 */
import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import { callTool, toolList, type ToolContext } from './tools'

export type EndpointInfo = { port: number; token: string; file: string; startedAt: number }
export type EndpointPublic = { port: number; file: string; startedAt: number }

let server: http.Server | null = null
let info: EndpointInfo | null = null

/** What the panel may show: the address and the token file, never the token itself. */
export function endpointInfo(): EndpointPublic | null {
  return info ? { port: info.port, file: info.file, startedAt: info.startedAt } : null
}

const MAX_BODY = 8 * 1024 * 1024

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('Gövde çok büyük.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function reply(res: http.ServerResponse, code: number, body: unknown) {
  const text = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, ctx: ToolContext, token: string) {
  const url = req.url ?? '/'
  if (req.method === 'GET' && url === '/health') {
    reply(res, 200, { ok: true })
    return
  }
  if (req.headers.authorization !== `Bearer ${token}`) {
    reply(res, 401, { ok: false, message: 'Jeton geçersiz.' })
    return
  }
  if (req.method === 'GET' && url === '/tools') {
    reply(res, 200, { ok: true, tools: toolList() })
    return
  }
  if (req.method === 'POST' && url === '/call') {
    let payload: { name?: unknown; args?: unknown }
    try {
      payload = JSON.parse(await readBody(req))
    } catch {
      reply(res, 400, { ok: false, message: 'Gövde JSON değil.' })
      return
    }
    const name = typeof payload.name === 'string' ? payload.name : ''
    if (!name) {
      reply(res, 400, { ok: false, message: 'name gerekli.' })
      return
    }
    try {
      reply(res, 200, await callTool(name, payload.args, ctx, 'agent'))
    } catch (e) {
      reply(res, 500, { ok: false, message: (e as Error).message })
    }
    return
  }
  reply(res, 404, { ok: false, message: 'Bilinmeyen yol.' })
}

export async function startEndpoint(
  ctx: ToolContext,
  file: string,
  stamp?: { app?: string; profile?: string }
): Promise<EndpointPublic> {
  if (server && info) return { port: info.port, file: info.file, startedAt: info.startedAt }
  const token = crypto.randomBytes(24).toString('hex')
  const s = http.createServer((req, res) => {
    void handle(req, res, ctx, token)
  })
  // A single step may legitimately run for minutes; Node's five minute default would cut the
  // socket while the tool is still working. The tool's own timeout is the limit that matters.
  s.requestTimeout = 0
  s.headersTimeout = 65_000
  await new Promise<void>((resolve, reject) => {
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => resolve())
  })
  const address = s.address()
  const port = address && typeof address === 'object' ? address.port : 0
  server = s
  info = { port, token, file, startedAt: Date.now() }
  try {
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          port,
          token,
          pid: process.pid,
          at: new Date().toISOString(),
          version: 1,
          // Which build is behind this door, and which profile it is: a caller can prove it is
          // talking to the instance it means to, instead of guessing from a port number.
          app: stamp?.app ?? '',
          profile: stamp?.profile ?? '',
        },
        null,
        2
      ),
      'utf8'
    )
  } catch {
    /* the endpoint still works in-process; only the command line cannot find it */
  }
  return { port, file, startedAt: info.startedAt }
}

export async function stopEndpoint(): Promise<void> {
  const s = server
  const file = info?.file
  server = null
  info = null
  if (file) {
    try {
      fs.rmSync(file, { force: true })
    } catch {
      /* already gone */
    }
  }
  if (s) {
    s.closeAllConnections?.()
    await new Promise<void>((resolve) => s.close(() => resolve()))
  }
}
