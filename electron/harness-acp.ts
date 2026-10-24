import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { HarnessSettings } from './recovery-settings'
import { harnessLaunch, harnessWorkspace, harnessDiagnostic } from './harness-launch'
export { harnessLaunch } from './harness-launch'

/** ACP v1 NDJSON over stdio. No model API is called by Nubbo on this path. */
export class HarnessAcp {
  private child: ChildProcessWithoutNullStreams
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout> }>()
  private nextId = 1
  private buffer = ''
  private failure?: Error
  private closed = false
  private closing?: Promise<void>
  private stderr = ''
  sessionId = ''
  private stage = 'başlatma'
  readonly launchInfo: { selectedCommand: string; command: string; cwd: string; mode: string }
  constructor(settings: HarnessSettings, private stopped: () => boolean, private notify: (params: any) => void = () => {}) {
    const launch = harnessLaunch(settings)
    const cwd = harnessWorkspace(settings)
    this.launchInfo = { selectedCommand: launch.selectedCommand, command: launch.command, cwd, mode: launch.mode }
    this.child = spawn(launch.command, launch.args, { env: launch.env, cwd, windowsHide: true,
      windowsVerbatimArguments: 'windowsVerbatimArguments' in launch && launch.windowsVerbatimArguments, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.on('error', error => this.fail(new Error(`Harness başlatılamadı: ${error.message}`)))
    this.child.on('exit', (code, signal) => this.fail(new Error(`Harness ${this.stage} aşamasında kapandı (${code ?? signal}); ACP görevi tamamlanmadı. ${this.stderr.slice(-1500)} ${/cache|disk_cache/i.test(this.stderr) ? 'Cache mesajı GUI sürecinden gelebilir; ACP çalıştırıcısı ve başlatma modu denetlenmeli.' : ''}`)))
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
    this.failure ??= new Error(harnessDiagnostic(`${error.message} · Seçilen: ${this.launchInfo.selectedCommand} · Mod: ${this.launchInfo.mode} · Çalışma: ${this.launchInfo.cwd} · Aşama: ${this.stage}`))
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
    if (this.closed || this.closing && !['session/cancel', 'session/close'].includes(method)) return Promise.reject(new Error('Harness bağlantısı kapalı.'))
    this.stage = method
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => { this.pending.delete(id); reject(new Error(harnessDiagnostic(`Harness yanıt vermedi: ${method} · Seçilen: ${this.launchInfo.selectedCommand} · Mod: ${this.launchInfo.mode} · Çalışma: ${this.launchInfo.cwd}`))) }, timeoutMs) : undefined
      this.pending.set(id, { resolve, reject, timer })
      try { this.send({ jsonrpc: '2.0', id, method, params }) } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error) }
    })
  }
  async initialize() {
    const result = await this.call('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'nubbo-recovery', version: '1.9.177' } })
    if (result?.protocolVersion !== 1 || result?.agentCapabilities?.mcpCapabilities?.http !== true) throw new Error('Bu Harness sürümü ACP v1 + HTTP MCP desteğini bildirmiyor. CLI sürümünü güncelle veya uygun çalıştırıcıyı seç.')
    return result
  }
  close(): Promise<void> {
    return this.closing ??= this.shutdown()
  }
  private async shutdown() {
    // Caller revokes the MCP capability first. Cancellation alone does not undo dispatched input.
    if (!this.failure && this.sessionId) {
      try { await this.call('session/cancel', { sessionId: this.sessionId }, 1000) } catch { /* bounded shutdown */ }
      try { await this.call('session/close', { sessionId: this.sessionId }, 1000) } catch { /* old ACP versions may omit close */ }
    }
    this.closed = true
    this.fail(new Error('Harness bağlantısı kapatıldı.'))
    this.child.stdin.end()
    const pid = this.child.pid
    if (!pid) return
    if (process.platform !== 'win32') {
      // The group can still contain a shell child after the Harness leader has crashed.
      try { process.kill(-pid, 'SIGKILL') } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    } else if (this.child.exitCode === null && this.child.signalCode === null) {
      await new Promise<void>(resolve => {
        const killer = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore', timeout: 4000 })
        let settled = false
        const done = () => { if (!settled) { settled = true; resolve() } }
        killer.on('exit', done); killer.on('error', done)
      })
      if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL')
    }
    if (this.child.exitCode === null && this.child.signalCode === null) {
      const exited = await new Promise<boolean>(resolve => {
        const onExit = () => { clearTimeout(timer); resolve(true) }
        const timer = setTimeout(() => { this.child.removeListener('exit', onExit); resolve(false) }, 1500)
        this.child.once('exit', onExit)
        if (this.child.exitCode !== null || this.child.signalCode !== null) onExit()
      })
      if (!exited) throw new Error('Harness sürecinin kapandığı doğrulanamadı.')
    }
  }
}
