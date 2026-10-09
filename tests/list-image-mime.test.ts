import { afterEach, describe, expect, it, vi } from 'vitest'
import { chooseScreenTarget } from '../electron/openrouter'
import type { ScanResult } from '../electron/matcher'

afterEach(() => vi.unstubAllGlobals())
describe('OCR list screenshot payload format', () => {
  it.each(['image/png', 'image/jpeg'])('keeps the supplied %s MIME rather than renaming bytes', async mime => {
    let request: { messages: { content: { type: string; image_url?: { url: string } }[] }[] } | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      request = JSON.parse(String(init.body))
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{"id":1,"text":"Save"}' } }] }) }
    }))
    const scan: ScanResult = { items: [{ id: 1, text: 'Save', type: 'Button', src: 'uia', x: 0, y: 0, w: 100, h: 30 }], area: { x: 0, y: 0, w: 1000, h: 700 }, ocr: true, ocrCount: 0, uiaCount: 1, window: 'Fixture', image: { data: 'ORIGINAL_BYTES', w: 1000, h: 700, mime } }
    await chooseScreenTarget({ apiKey: 'fake', model: 'test/model', prompt: 'Save', kind: 'click', stepTitle: 'Click', scan, sendImage: true })
    expect(request!.messages[1].content.find(p => p.type === 'image_url')!.image_url!.url).toBe(`data:${mime};base64,ORIGINAL_BYTES`)
  })
})
