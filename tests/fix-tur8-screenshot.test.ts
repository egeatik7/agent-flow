import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScanResult } from '../electron/matcher'

/**
 * Ölçülen kusur (1.9.105): Ayarlar > Genel > "Metin modeline numaralı ekran görüntüsü gönder"
 * ayarı ETKİSİZDİ. Karar yolundaki tarama `image:'none'` istiyor ve dönen görüntüyü `null`'luyordu,
 * bu yüzden `pickFrom` içindeki `sendImage` daima false oluyordu: kutu işaretli olsa da modele resim
 * gitmiyordu. Bu dosya ayarın gerçekten çalıştığını ölçer.
 */
const state = vi.hoisted(() => ({
  scans: [] as { image?: string }[],
  requests: [] as string[],
  actions: [] as string[],
  items: [] as unknown[],
}))

vi.mock('electron', () => ({ screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1000, height: 700 }, scaleFactor: 1 }) } }))
vi.mock('../electron/a11y-bridge', () => ({
  isLocked: async () => false,
  scan: async (opts: { image?: string }) => {
    state.scans.push(opts)
    // Numaralı görüntü YALNIZ 'marked' istendiğinde doğar (worker: screen.ps1 `$mode -eq 'marked'`).
    const image = opts.image === 'marked' || opts.image === 'plain'
      ? { data: opts.image === 'marked' ? 'MARKED_BYTES' : 'PLAIN_BYTES', w: 1000, h: 700, mime: 'image/jpeg' }
      : null
    return { missingWindow: '', items: state.items, area: { x: 0, y: 0, w: 1000, h: 700 }, image, window: 'Fixture', ocr: true, ocrCount: state.items.length, uiaCount: 0, ocrEngine: 'combined' }
  },
  discardShot: () => {},
  applyOnnx: async (s: ScanResult) => s,
  locate: async () => ({ x: 10, y: 20, w: 80, h: 20, enabled: true, name: 'Saved' }),
  findImage: async () => null,
  clickAt: async () => state.actions.push('click'),
  moveMouse: async () => { state.actions.push('move'); return { hwnd: 1 } },
  sendKeys: async () => state.actions.push('keys'),
  // Yazma yolu bu yüzeyi okur; sahte worker yazıyı gerçekten göndermiş gibi davranır.
  typeText: async () => { state.actions.push('type'); return { value: 'merhaba', writeSent: true } },
  cursorPos: async () => ({ x: 0, y: 0 }),
  inputTarget: async () => ({ hwnd: '1', pid: 10, title: 'Fixture', rect: { x: 0, y: 0, w: 1000, h: 700 } }),
  assertInputTarget: async () => {},
  focusedValue: async () => null,
  inputState: async () => ({ type: 'Edit', window: 'Fixture' }),
  foreground: async () => ({ title: 'Fixture', pid: 10, hwnd: '1', proc: 'fixture' }),
  windowRect: async () => ({ x: 0, y: 0, w: 1000, h: 700 }),
}))
vi.mock('../electron/browser', () => ({ userChromeItems: async () => null }))
vi.mock('../electron/shots', () => ({ rememberShot: () => {} }))

import { createAgent } from '../electron/agent'
import { createNode, DEFAULT_SETTINGS } from '../electron/graph-types'
import { setStopCheck } from '../electron/openrouter'

const row = (text: string) => ({ id: 1, text, type: 'Text', src: 'uia', x: 20, y: 30, w: 170, h: 20 })
const tikla = (prompt: string) => ({ ...createNode('click', 0, 0), title: 'Tıkla 1', prompt })
const kosul = (text: string) => ({ ...createNode('condition', 0, 0), title: 'Koşul 1', text })

function executor(patch: Record<string, unknown> = {}) {
  return createAgent({
    log: () => {}, send: () => {}, shouldStop: () => false,
    settings: () => ({
      ...DEFAULT_SETTINGS, apiKey: 'test-key', model: 'text/main', modelBackups: [],
      findOrder: ['windows', 'onnx', 'list'] as never, findOff: [], ...patch,
    }),
  }).executor
}

function respond(id: number, extra: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: { body: string }) => {
    state.requests.push(String(init.body))
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ id, text: 'Kaydet', reason: 'liste', ...extra }) } }] }) }
  }))
}

const goruntuGonderdi = () => state.requests.some((b) => b.includes('image_url'))
const goruntuIcerigi = () => state.requests.map((b) => JSON.parse(b) as { messages: { content: unknown }[] })
  .flatMap((r) => r.messages)
  .flatMap((m) => Array.isArray(m.content) ? m.content as { type: string; image_url?: { url: string } }[] : [])
  .find((p) => p.type === 'image_url')?.image_url?.url ?? ''

beforeEach(() => {
  state.scans = []; state.requests = []; state.actions = []; state.items = [row('Kaydet')]
  setStopCheck(() => false)
})
afterEach(() => { vi.unstubAllGlobals(); setStopCheck(() => false) })

describe('metin modeline numaralı ekran görüntüsü gönderme', () => {
  it('ayar açıkken tarama numaralı görüntü ister ve görüntü model isteğine eklenir', async () => {
    respond(1)
    await executor({ sendScreenshot: true }).click(tikla('Kaydet düğmesine tıkla'), 1)
    expect(state.scans[0].image).toBe('marked')
    expect(goruntuGonderdi()).toBe(true)
    expect(goruntuIcerigi()).toContain('MARKED_BYTES')
    expect(state.actions).toContain('click')
  })

  it('ayar kapalıyken numaralı görüntü ne istenir ne gönderilir', async () => {
    respond(1)
    await executor({ sendScreenshot: false }).click(tikla('Kaydet düğmesine tıkla'), 1)
    expect(state.scans[0].image).not.toBe('marked')
    expect(goruntuGonderdi()).toBe(false)
    expect(state.actions).toContain('click')
  })

  it('koşulda ayar açık olsa bile görüntü istenmez ve gönderilmez', async () => {
    respond(1, { satisfied: true })
    await executor({ sendScreenshot: true }).exists('', kosul('kaydet göründü mü?'))
    expect(state.scans.every((s) => s.image !== 'marked')).toBe(true)
    expect(goruntuGonderdi()).toBe(false)
  })

  it('model yoksa (anahtar ve yerel uç nokta boş) görüntü hiç istenmez', { timeout: 30_000 }, async () => {
    respond(1)
    // Modelsiz yolda deterministik eşleşme tırnaklı literalle çalışır (Tıkla'da tırnak desteklenir).
    await executor({ sendScreenshot: true, apiKey: '', localBaseUrl: '' }).click(tikla('"Kaydet"'), 1)
    expect(state.scans.every((s) => s.image !== 'marked')).toBe(true)
    expect(state.requests).toHaveLength(0)
  })

  it('yazı yolu da aynı ayarı kullanır', async () => {
    respond(1)
    await executor({ sendScreenshot: true }).type({ ...createNode('type', 0, 0), title: 'Yazı Yaz 1', text: 'merhaba', prompt: 'Kaydet alanına yaz' }, 1)
    expect(state.scans[0].image).toBe('marked')
    expect(goruntuGonderdi()).toBe(true)
  })
})
