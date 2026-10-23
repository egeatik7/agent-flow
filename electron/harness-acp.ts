import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { harnessSettings, type HarnessSettings } from './recovery-settings'

export function harnessLaunch(value: HarnessSettings, platform = process.platform, executable = process.execPath) {
  const settings = harnessSettings(value)
  if (!settings.command) throw new Error('Harness CLI programını seç.')
  const env = { ...process.env, DSH_PERMISSION_MODE: settings.fullControl ? 'danger-full-access' : 'workspace-write' }
  if (/\.[cm]?js$/i.test(settings.command)) return { command: executable, args: [settings.command, ...settings.args], env: { ...env, ELECTRON_RUN_AS_NODE: '1' } }
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(settings.command)) {
    // cmd expands percent even inside quotes. Refuse ambiguous command strings instead of shell interpolation.
    if (/[\r\n"%!]/.test(settings.command) || settings.args.some(arg => /[\r\n"%!^&|<>]/.test(arg))) throw new Error('CMD çalıştırıcı yolu/argümanlarında desteklenmeyen kabuk karakterleri var; doğrudan EXE veya JS çalıştırıcısını seç.')
    const line = `""${settings.command}" ${settings.args.map(arg => `"${arg}"`).join(' ')}"`
    return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/v:off', '/s', '/c', line], env, windowsVerbatimArguments: true }
  }
  return { command: settings.command, args: settings.args, env }
}

/** ACP v1 NDJSON over stdio. No model API is called by Nubbo on this path. */
export class HarnessAcp {
  private child: ChildProcessWithoutNullStreams
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout> }>()
  private nextId = 1
  private buffer = ''
  private failure?: Error
  private closed = false
  private stderr = ''
  sessionId = ''
  constructor(settings: HarnessSettings, private stopped: () => boolean, private notify: (params: any) => void = () => {}) {
    const launch = harnessLaunch(settings)
    this.child = spawn(launch.command, launch.args, { env: launch.env, cwd: settings.cwd || path.dirname(path.resolve(settings.command)), windowsHide: true,
      windowsVerbatimArguments: 'windowsVerbatimArguments' in launch && launch.windowsVerbatimArguments, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.on('error', error => this.fail(new Error(`Harness başlatılamadı: ${error.message}`)))
    this.child.on('exit', (code, signal) => this.fail(new Error(`Harness kapandı (${code ?? signal}). ${this.stderr.slice(-1500).replace(/Bearer\s+[^\s"']+/gi, 'Bearer [gizli]').replace(/sk-[A-Za-z0-9_-]+/g, '[gizli anahtar]')}`)))
    this.child.stdin.on('error', error => this.fail(new Error(`Harness bağlantısı kapandı: ${error.message}`)))
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk.toString()).slice(-8000) })
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      if (this.buffer.length > 32 * 1024 * 1024) { this.fail(new Error('Harness protokol mesajı sınırı aşıldı.')); return }
      let split: number
      while ((split = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, split).trim(); this.buffer = this.buffer.slice(split + 1)
        if (!line) continue
        try { this.receive(JSON.parse(line), settings.fullControl) }
        catch { this.fail(new Error('Harness stdout ACP protokolü değil; ACP destekli CLI çalıştırıcısını seç.')) }
      }
    })
  }
  private fail(error: Error) {
    this.failure ??= error
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(this.failure) }
    this.pending.clear()
  }
  private send(value: unknown) {
    if (this.failure) throw this.failure
    this.child.stdin.write(JSON.stringify(value) + '\n')
  }
  private receive(message: any, fullControl: boolean) {
    if (message.jsonrpc !== '2.0') throw new Error('Geçersiz RPC')
    if (message.method) {
      if (message.method === 'session/update') this.notify(message.params)
      if (message.id !== undefined) {
        if (message.method === 'session/request_permission') {
          const sameSession = !!this.sessionId && message.params?.sessionId === this.sessionId
          const option = sameSession && fullControl && !this.stopped() ? message.params?.options?.find((o: any) => o.kind === 'allow_once') : undefined
          this.send({ jsonrpc: '2.0', id: message.id, result: { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } } })
        } else this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Client method unavailable' } })
      }
      return
    }
    const item = this.pending.get(message.id)
    if (!item) return
    this.pending.delete(message.id); clearTimeout(item.timer)
    if (message.error) item.reject(new Error(`Harness ACP: ${message.error.message || 'RPC hatası'}`))
    else item.resolve(message.result)
  }
  call(method: string, params: unknown, timeoutMs = 60_000): Promise<any> {
    if (this.failure) return Promise.reject(this.failure)
    if (this.closed) return Promise.reject(new Error('Harness bağlantısı kapalı.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => { this.pending.delete(id); reject(new Error(`Harness yanıt vermedi: ${method}`)) }, timeoutMs) : undefined
      this.pending.set(id, { resolve, reject, timer })
      try { this.send({ jsonrpc: '2.0', id, method, params }) } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error) }
    })
  }
  async initialize() {
    const result = await this.call('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'nubbo-recovery', version: '1.9.175' } })
    if (result?.protocolVersion !== 1 || result?.agentCapabilities?.mcpCapabilities?.http !== true) throw new Error('Bu Harness sürümü ACP v1 + HTTP MCP desteğini bildirmiyor. CLI sürümünü güncelle veya uygun çalıştırıcıyı seç.')
    return result
  }
  async close() {
    if (this.closed) return
    // Stop accepting fresh work first. Cancellation alone does not revoke the MCP capability.
    if (!this.failure && this.sessionId) {
      try { await this.call('session/cancel', { sessionId: this.sessionId }, 1000) } catch { /* bounded shutdown */ }
      try { await this.call('session/close', { sessionId: this.sessionId }, 1000) } catch { /* old ACP versions may omit close */ }
    }
    this.closed = true
    this.fail(new Error('Harness bağlantısı kapatıldı.'))
    this.child.stdin.end()
    const pid = this.child.pid
    if (pid && this.child.exitCode === null) {
      if (process.platform === 'win32') await new Promise<void>(resolve => {
        const killer = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
        killer.on('exit', () => resolve()); killer.on('error', () => { this.child.kill(); resolve() })
      })
      else { try { process.kill(-pid, 'SIGKILL') } catch { this.child.kill('SIGKILL') } }
    }
  }
}
