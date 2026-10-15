import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ requests: [] as { url: string; body: any; authorization?: string }[] }))
vi.mock('electron', () => ({ screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1000, height: 700 }, scaleFactor: 1 }) } }))
vi.mock('../electron/a11y-bridge', () => ({
  isLocked: async () => false,
  scan: async () => ({ area: { x: 0, y: 0, w: 1000, h: 700 }, window: 'Fixture', image: null,
    items: [{ id: 1, src: 'uia', type: 'Button', text: 'Done', x: 100, y: 100, w: 100, h: 30 }], ocr: true, uiaCount: 1, ocrCount: 0 }),
}))
vi.mock('../electron/browser', () => ({ userChromeItems: async () => null }))
vi.mock('../electron/shots', () => ({ rememberShot: () => {} }))
vi.mock('../electron/local-context-probe', async original => ({ ...await original<any>(), olcumuTazele: async () => {} }))
import { createAgent } from '../electron/agent'
import { createNode, DEFAULT_SETTINGS, type AppSettings } from '../electron/graph-types'
import { setLocalEndpoint, setStopCheck } from '../electron/openrouter'
import fs from 'node:fs'
import ts from 'typescript'
import { mergeSettingsPatch } from '../electron/settings-patch'
import { nextModelRevision } from '../electron/model-chain'
import { recoverySettings } from '../electron/recovery-settings'

const reply = () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ satisfied: true, id: 1 }) } }] }) })
const node = () => ({ ...createNode('condition', 0, 0), text: 'Done var mı?' })
let saved: AppSettings
const agent = () => createAgent({ settings: () => saved, shouldStop: () => false, log: () => {}, send: () => {} })
beforeEach(() => {
  saved = { ...DEFAULT_SETTINGS, apiKey: 'old-key', model: 'old-model', modelBackups: [], conditionModel: '', conditionBackups: [], modelRevision: 1 }
  h.requests = []
  setLocalEndpoint(''); setStopCheck(() => false)
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    h.requests.push({ url, body: JSON.parse(init.body), authorization: init.headers.Authorization })
    return reply()
  }))
})
afterEach(() => { vi.unstubAllGlobals(); setLocalEndpoint(''); setStopCheck(() => false) })

it('next condition call uses saved model/key even after beginRun', async () => {
  const running = agent()
  running.beginRun()
  expect(await running.executor.exists('', node())).toBe(true)
  saved = { ...saved, model: 'new-model', apiKey: 'new-key', modelRevision: 2 }
  expect(await running.executor.exists('', node())).toBe(true)
  expect(h.requests.map(r => [r.body.model, r.authorization])).toEqual([
    ['old-model', 'Bearer old-key'], ['new-model', 'Bearer new-key'],
  ])
  running.releaseRunSettings()
  expect(await running.executor.exists('', node())).toBe(true)
  expect(h.requests.at(-1)).toMatchObject({ body: { model: 'new-model' }, authorization: 'Bearer new-key' })
})

it('next call uses the new endpoint and the matching new model', async () => {
  saved = { ...saved, model: 'local:old-model' }
  setLocalEndpoint('http://first.fixture:8080/v1')
  const running = agent()
  running.beginRun()
  expect(await running.executor.exists('', node())).toBe(true)
  saved = { ...saved, model: 'local:new-model', localBaseUrl: 'http://second.fixture:8080/v1', modelRevision: 2 }
  // Publish the same saved revision to the runtime.
  setLocalEndpoint(saved.localBaseUrl)
  expect(await running.executor.exists('', node())).toBe(true)
  expect(h.requests.map(r => [r.url, r.body.model])).toEqual([
    ['http://first.fixture:8080/v1/chat/completions', 'old-model'],
    ['http://second.fixture:8080/v1/chat/completions', 'new-model'],
  ])
})

it('control: settings remain live between calls when beginRun is omitted, as older model-order tests do', async () => {
  const standby = agent()
  expect(await standby.executor.exists('', node())).toBe(true)
  saved = { ...saved, model: 'new-model', apiKey: 'new-key' }
  expect(await standby.executor.exists('', node())).toBe(true)
  expect(h.requests.map(r => r.body.model)).toEqual(['old-model', 'new-model'])
})

it('settings save applies its endpoint before returning without needing another settings read', async () => {
  const source = fs.readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')
  const start = source.indexOf("ipcMain.handle('settings:save'")
  const end = source.indexOf('\n  const currentGraph', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const javascript = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  let save!: (event: unknown, patch: any) => AppSettings
  const getSettings = () => saved
  new Function('env', `with (env) { ${javascript} }`)({
    setLocalEndpoint, ipcMain: { handle: (_name: string, callback: typeof save) => { save = callback } }, getSettings,
    mergeSettingsPatch, validateApiKey: (key: string) => key, clampRamp: (lo: number, hi: number) => ({ lo, hi }),
    bridge: { setValueRamp() {}, setOcrEngine() {} }, normalizeFind: (order: any, off: any) => ({ order, off }),
    normalizePrompts: (value: any) => value, cleanBackups: (value: any) => value ?? [], recoverySettings, nextModelRevision,
    store: { set: (_key: string, next: AppSettings) => { saved = next } }, syncEndpoint: async () => {},
  })
  saved = { ...saved, model: 'local:old-model', localBaseUrl: 'http://first.fixture:8080/v1' }
  const running = agent()
  running.beginRun()
  setLocalEndpoint(saved.localBaseUrl)
  const result = save(null, { localBaseUrl: 'http://second.fixture:8080/v1', model: 'local:new-model' })
  expect(result.localBaseUrl).toBe('http://second.fixture:8080/v1')
  expect(await running.executor.exists('', node())).toBe(true)
  expect(h.requests.at(-1)).toMatchObject({ url: 'http://second.fixture:8080/v1/chat/completions', body: { model: 'new-model' } })
  getSettings()
  expect(await running.executor.exists('', node())).toBe(true)
  expect(h.requests.at(-1)).toMatchObject({ url: 'http://second.fixture:8080/v1/chat/completions', body: { model: 'new-model' } })
})


it('a settings change during a model-chain pass cannot mix its old models with a new endpoint', async () => {
  saved = { ...saved, model:'local:primary', modelBackups:['local:backup'], localBaseUrl:'http://first.fixture:8080/v1' }
  setLocalEndpoint(saved.localBaseUrl)
  const running = agent(); running.beginRun()
  let calls = 0
  vi.stubGlobal('fetch',vi.fn(async (url:string, init:any) => {
    h.requests.push({url,body:JSON.parse(init.body),authorization:init.headers.Authorization})
    if (++calls === 1) {
      saved = {...saved, model:'local:new', modelBackups:[], localBaseUrl:'http://second.fixture:8080/v1'}
      setLocalEndpoint(saved.localBaseUrl)
      return {ok:false,status:503,text:async()=> 'temporary primary outage'}
    }
    return reply()
  }))
  expect(await running.executor.exists('',node())).toBe(true)
  expect(await running.executor.exists('',node())).toBe(true)
  expect(h.requests.map(r=>[r.url,r.body.model])).toEqual([
    ['http://first.fixture:8080/v1/chat/completions','primary'],
    ['http://first.fixture:8080/v1/chat/completions','backup'],
    ['http://second.fixture:8080/v1/chat/completions','new'],
  ])
})
