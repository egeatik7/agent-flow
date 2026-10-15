import { expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chooseScreenTarget, setChatLogger } from '../electron/openrouter'
import { setDiagnosticsRoot } from '../electron/send-log'
import type { ScanResult } from '../electron/matcher'

it('records exact OCR IDs and the rejected candidate without changing the selection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-ocr-evidence-'))
  setDiagnosticsRoot(root)
  const logs: string[] = []
  setChatLogger(line => logs.push(line))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ id: 185, text: 'User Perspective' }) } }] }) })))
  try {
    const scan = { area: { x: 0, y: 0, w: 1920, h: 1080 }, image: null,
      items: [{ id: 185, text: 'View Marker Playback v', src: 'uia', type: 'Button', x: 20, y: 40, w: 200, h: 20 },
        { id: 137, text: 'User Perspective', src: 'ocr', type: 'Text', x: 77, y: 132, w: 124, h: 29 }],
    } as unknown as ScanResult
    await expect(chooseScreenTarget({ apiKey: 'fake', model: 'valid', prompt: 'User Perspective', kind: 'click', stepTitle: 'Tıkla', scan, sendImage: false })).rejects.toThrow('MODEL_TARGET_REJECTED')
    const dir = path.join(root, fs.readdirSync(root)[0])
    const mapping = JSON.parse(fs.readFileSync(path.join(dir, 'ocr-esleme.json'), 'utf8'))
    const resolution = JSON.parse(fs.readFileSync(path.join(dir, 'id-cozumleme.json'), 'utf8'))
    expect(mapping.originalItems).toEqual(scan.items)
    expect(mapping.imageSent).toBe(false)
    expect(resolution.originalItemWithReturnedId.text).toBe('View Marker Playback v')
    expect(resolution.modelText).toBe('User Perspective')
    expect(resolution.textClash).toBe(true)
    expect(resolution.acceptedCandidate).toBeNull()
    expect(logs.some(line => line.startsWith('OCR-KANIT'))).toBe(true)
  } finally { setDiagnosticsRoot(''); setChatLogger(null); vi.unstubAllGlobals(); fs.rmSync(root, { recursive: true, force: true }) }
})
