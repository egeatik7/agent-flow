import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { harnessSettings, type HarnessSettings } from './recovery-settings'

const isFile = (file: string) => { try { return fs.statSync(file).isFile() } catch { return false } }

/** Resolve only the selected installation, never a different program from PATH. */
export function harnessLaunch(value: HarnessSettings, platform = process.platform, executable = process.execPath, fileExists = isFile) {
  const settings = harnessSettings(value)
  if (!settings.command) throw new Error('Harness programını seç.')
  const paths = platform === 'win32' ? path.win32 : path
  const selectedCommand = settings.command
  if (paths.resolve(selectedCommand).toLowerCase() === paths.resolve(executable).toLowerCase()) throw new Error('Nubbo uygulamasının kendi EXE dosyası seçilmiş. Kurtarma için DeepSeek Harness.exe veya dsh.cmd seç.')
  const env: NodeJS.ProcessEnv = { ...process.env, DSH_PERMISSION_MODE: settings.fullControl ? 'danger-full-access' : 'workspace-write' }
  // Native launchers must not inherit the host's accidental Electron Node mode.
  delete env.ELECTRON_RUN_AS_NODE
  if (platform === 'win32' && paths.basename(selectedCommand).toLowerCase() === 'deepseek harness.exe') {
    const resources = paths.join(paths.dirname(selectedCommand), 'resources')
    const relative = ['dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js']
    const packed = paths.join(resources, 'app.asar', ...relative)
    const unpacked = paths.join(resources, 'app.asar.unpacked', ...relative)
    // Electron's fs understands ASAR. The physical shim also identifies older packaged layouts.
    const shim = paths.join(resources, 'runtime', 'cli', 'bin', 'dsh.cmd')
    const entry = fileExists(packed) ? packed : fileExists(unpacked) ? unpacked : fileExists(shim) && fileExists(paths.join(resources, 'app.asar')) ? packed : ''
    if (!entry) throw new Error('DeepSeek masaüstü EXE seçildi fakat aynı kurulumun paketli CLI girişi bulunamadı. Uygulamayı güncelle/onar veya dsh.cmd seç; GUI kurtarma ajanı olarak açılmadı.')
    return { command: selectedCommand, args: ['--expose-internals', entry, ...settings.args], env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, mode: 'desktop-cli', selectedCommand }
  }
  if (/\.[cm]?js$/i.test(selectedCommand)) return { command: executable, args: [paths.resolve(selectedCommand), ...settings.args], env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, mode: 'script', selectedCommand }
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(selectedCommand)) {
    if (/[\r\n"%!]/.test(selectedCommand) || settings.args.some(arg => /[\r\n"%!^&|<>]/.test(arg))) throw new Error('CMD çalıştırıcı yolu/argümanlarında desteklenmeyen kabuk karakterleri var; doğrudan EXE veya JS çalıştırıcısını seç.')
    const line = `""${selectedCommand}" ${settings.args.map(arg => `"${arg}"`).join(' ')}"`
    return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/v:off', '/s', '/c', line], env, windowsVerbatimArguments: true, mode: 'cmd', selectedCommand }
  }
  return { command: selectedCommand, args: settings.args, env, mode: 'native', selectedCommand }
}

/** Installation directories can be read-only. Keep the default workspace writable and stable. */
export function harnessWorkspace(value: HarnessSettings): string {
  const explicit = value.cwd.trim()
  if (explicit) {
    if (!path.isAbsolute(explicit)) throw new Error('Harness çalışma klasörü mutlak bir yol olmalı.')
    if (!fs.existsSync(explicit) || !fs.statSync(explicit).isDirectory()) throw new Error('Harness çalışma klasörü bulunamadı.')
    return explicit
  }
  const cwd = path.join(os.tmpdir(), 'nubbo-harness-workspace')
  fs.mkdirSync(cwd, { recursive: true })
  return cwd
}

export function harnessDiagnostic(value: string): string {
  return value.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [gizli]').replace(/sk-[A-Za-z0-9_-]+/g, '[gizli anahtar]').replace(/((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[gizli]')
}
