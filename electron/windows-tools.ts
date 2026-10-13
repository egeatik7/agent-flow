import { spawn } from 'child_process'
import type { ModelTool } from './openrouter'
import type { RecoveryToolResult } from './recovery'
import { StoppedError } from './runner'

const str = { type: 'string' }
export function windowsTools(allowCode: boolean): ModelTool[] {
  const tools: ModelTool[] = [{ type: 'function', function: { name: 'window_action', description: 'Windows penceresini doğrudan yönet. windowTitle tam başlık olmalı; boşsa öndeki pencere. Birden fazla eşleşmede işlem yapılmaz. Maximize F11 tam ekran değildir.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['maximize', 'minimize', 'restore', 'focus', 'move', 'resize', 'topmost', 'notopmost'] }, windowTitle: str, x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' } }, required: ['action'], additionalProperties: false } } }]
  if (allowCode) tools.push({ type: 'function', function: { name: 'powershell_run', description: 'Hazır araçlar yetmediğinde PowerShell/.NET/Windows API çalıştır. Yalnız görev kapsamındaki işlemleri yap. Kod ve sonuçlar günlükte görünür. Bu araç sandbox değildir; kullanıcı yetkileriyle çalışır. Çalışma klasörünü belirt. Başlattığın işi başka sürece ayırıp arkada bırakma.', parameters: { type: 'object', properties: { code: str, cwd: str }, required: ['code'], additionalProperties: false } } })
  return tools
}

/** Fresh process per call; argument encoding avoids shell interpolation. Bounded output and process-tree cancellation. */
export function runPowerShell(code: string, cwd: string | undefined, shouldStop: () => boolean): Promise<RecoveryToolResult> {
  if (process.platform !== 'win32') return Promise.reject(new Error('Windows araçları yalnız Windows üzerinde çalışır.'))
  if (!code.trim() || code.length > 50000) return Promise.reject(new Error('Kod boş veya çok uzun.'))
  if (shouldStop()) return Promise.reject(new StoppedError())
  return new Promise((resolve, reject) => {
    const source = "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.Encoding]::UTF8;" + code
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { windowsHide: true, cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', ended = false
    const started = Date.now()
    const cancel = (error: Error) => {
      if (ended) return
      ended = true
      if (child.pid) { const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); killer.on('error', () => child.kill()); killer.on('close', () => child.kill()) }
      else child.kill()
      clearInterval(timer)
      reject(error)
    }
    const timer = setInterval(() => {
      if (shouldStop()) cancel(new StoppedError())
      else if (Date.now() - started >= 60000) cancel(new Error('PowerShell 60 saniye sınırını aştı.'))
    }, 100)
    // O19 (yönerge): akış UTF-8 olarak ÇÖZÜLÜR (Node'un StringDecoder'ı). Önceden her Buffer parçası
    // ayrı ayrı `b.toString('utf8')` ile çevriliyordu; parça sınırına düşen çok baytlı karakter (Türkçe
    // harf, emoji) U+FFFD'ye bozuluyordu ve bu metin hem araç sonucuna hem modele/günlüğe gidiyordu.
    // Köprüde doğru kalıp zaten var (a11y-bridge: proc.stdout/stderr.setEncoding('utf8')). setEncoding
    // kapanışta kalan yarım diziyi de boşaltır; stdout/stderr AYRI çözücü kullanır.
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (b: string) => { stdout = (stdout + b).slice(-24000) })
    child.stderr.on('data', (b: string) => { stderr = (stderr + b).slice(-6000) })
    child.on('error', error => { if (!ended) { ended = true; clearInterval(timer); reject(error) } })
    child.on('close', exitCode => {
      if (ended) return
      ended = true; clearInterval(timer)
      resolve({ ok: exitCode === 0, outcome: exitCode === 0 ? 'tamam' : 'hata', message: exitCode === 0 ? 'PowerShell tamamlandı; dış uygulamadaki hedef ayrıca gözlemlenmeli.' : stderr || `PowerShell çıkış kodu: ${exitCode}`, data: { stdout, stderr, exitCode } })
    })
  })
}

export function windowScript(args: Record<string, unknown>, ownPid: number): string {
  const action = String(args.action)
  if (!['maximize', 'minimize', 'restore', 'focus', 'move', 'resize', 'topmost', 'notopmost'].includes(action)) throw new Error('Geçersiz pencere işlemi.')
  for (const key of action === 'move' ? ['x', 'y'] : action === 'resize' ? ['width', 'height'] : []) {
    if (!Number.isInteger(args[key]) || Math.abs(Number(args[key])) > 100000 || (['width','height'].includes(key) && Number(args[key]) < 1)) throw new Error(`Geçersiz pencere alanı: ${key}`)
  }
  const title = Buffer.from(String(args.windowTitle || ''), 'utf8').toString('base64')
  return `Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class NubboWindow {
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr z,int x,int y,int w,int v,uint f);
}
'@
$title=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${title}'))
if($title){$matches=@(Get-Process | Where-Object {$_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ceq $title});if($matches.Count -ne 1){throw 'Pencere bulunamadı veya başlık birden fazla pencereye ait.'};$h=[IntPtr]$matches[0].MainWindowHandle}else{$h=[NubboWindow]::GetForegroundWindow()}
if($h -eq [IntPtr]::Zero){throw 'Hedef pencere yok.'}
[uint32]$targetPid=0;[void][NubboWindow]::GetWindowThreadProcessId($h,[ref]$targetPid);if($targetPid -eq ${ownPid}){throw 'Nubbo kendi penceresinde işlem yapmaz.'}
${['maximize','minimize','restore'].includes(action) ? `[void][NubboWindow]::ShowWindow($h,${{maximize:3,minimize:6,restore:9}[action as 'maximize']})` : action === 'focus' ? "if(-not [NubboWindow]::SetForegroundWindow($h)){throw 'Windows pencereyi öne getirmeye izin vermedi.'}" : `if(-not [NubboWindow]::SetWindowPos($h,[IntPtr]${action === 'topmost' ? -1 : action === 'notopmost' ? -2 : 0},${args.x || 0},${args.y || 0},${args.width || 0},${args.height || 0},${action === 'move' ? 21 : action === 'resize' ? 22 : 19})){throw 'Pencere yerleşimi uygulanamadı.'}`}
@{hwnd=$h.ToInt64().ToString();action='${action}'}|ConvertTo-Json -Compress`
}
