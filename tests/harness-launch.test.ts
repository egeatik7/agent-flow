import { expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { harnessLaunch, harnessWorkspace, harnessDiagnostic } from '../electron/harness-launch'
import { harnessSettings } from '../electron/recovery-settings'

const exe = 'C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe'
const packed = 'C:\\Program Files\\DeepSeek Harness\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js'
it('launches the selected Desktop EXE in its OWN Node mode with the bundled CLI, never the GUI', () => {
  const h = harnessLaunch(harnessSettings({ command: exe }), 'win32', 'C:\\Nubbo.exe', file => file === packed)
  expect(h.command).toBe(exe)
  expect(h.args).toEqual(['--expose-internals', packed, '--profile', 'acp'])
  expect(h.env.ELECTRON_RUN_AS_NODE).toBe('1')
  expect(h.env.DSH_PERMISSION_MODE).toBe('danger-full-access')
  expect(h.mode).toBe('desktop-cli')
})
it('accepts a packed archive detected by the physical official CLI shim without reading ASAR in plain Node', () => {
  const existing = new Set(['C:\\Program Files\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd', 'C:\\Program Files\\DeepSeek Harness\\resources\\app.asar'])
  expect(harnessLaunch(harnessSettings({ command: exe }), 'win32', '', file => existing.has(file)).args[1]).toBe(packed)
})
it('uses an unpacked official entry when packaged that way', () => {
  const unpacked = packed.replace('app.asar\\', 'app.asar.unpacked\\')
  expect(harnessLaunch(harnessSettings({ command: exe }), 'win32', '', file => file === unpacked).args[1]).toBe(unpacked)
})
it('fails before opening a Desktop GUI if the CLI runtime is missing', () => {
  expect(() => harnessLaunch(harnessSettings({ command: exe }), 'win32', '', () => false)).toThrow('paketli CLI girişi bulunamadı')
})
it('does not silently switch a different executable to another installation', () => {
  const h = harnessLaunch(harnessSettings({ command: 'C:\\Another\\server.exe' }), 'win32', '', () => true)
  expect(h.command).toBe('C:\\Another\\server.exe'); expect(h.mode).toBe('native')
})
it('keeps space/Turkish/shell characters as separate native arguments rather than shell interpolation', () => {
  const command = 'C:\\Çağrı & İşler\\DeepSeek Harness.exe'
  const h = harnessLaunch(harnessSettings({ command }), 'win32', '', () => true)
  expect(h.command).toBe(command); expect(h.args.at(-1)).toBe('acp')
  expect('windowsVerbatimArguments' in h).toBe(false)
})
it('isolates Electron Node mode and honors restricted permission settings', () => {
  vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')
  try {
    expect(harnessLaunch(harnessSettings({ command: 'native.exe', fullControl: false }), 'win32').env).toMatchObject({ DSH_PERMISSION_MODE: 'workspace-write' })
    expect(harnessLaunch(harnessSettings({ command: 'native.exe' }), 'win32').env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  } finally { vi.unstubAllEnvs() }
})
it('uses a stable existing writable workspace instead of the installation directory', () => {
  const cwd = harnessWorkspace(harnessSettings({ command: exe }))
  expect(cwd).toBe(path.join(os.tmpdir(), 'nubbo-harness-workspace'))
  expect(fs.statSync(cwd).isDirectory()).toBe(true)
  fs.accessSync(cwd, fs.constants.W_OK)
})
it('respects an explicit workspace, rejects a missing directory and does not create it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-work-test-'))
  try {
    expect(harnessWorkspace(harnessSettings({ cwd: dir }))).toBe(dir)
    expect(() => harnessWorkspace(harnessSettings({ cwd: path.join(dir, 'missing') }))).toThrow('bulunamadı')
    expect(() => harnessWorkspace(harnessSettings({ cwd: 'relative' }))).toThrow('mutlak')
    expect(fs.existsSync(path.join(dir, 'missing'))).toBe(false)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
it('redacts credentials from launch diagnostics', () => {
  const text = harnessDiagnostic('Bearer abcdef API_KEY=key123 token:other sk-secret123 password=guess')
  for (const value of ['abcdef', 'key123', 'other', 'sk-secret123', 'guess']) expect(text).not.toContain(value)
})

it('refuses to launch Nubbo itself as its own recovery agent', () => {
  expect(() => harnessLaunch(harnessSettings({ command: 'C:\\Nubbo\\Nubbo.exe' }), 'win32', 'C:\\Nubbo\\Nubbo.exe')).toThrow('kendi EXE')
})
