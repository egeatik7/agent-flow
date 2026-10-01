import fs from 'fs'
import path from 'path'
import type { InferenceSession, Tensor } from 'onnxruntime-node'
import type { ScreenItem } from './matcher'

/**
 * Second reader. Windows OCR stays. This one only adds Chinese (and English
 * Windows missed) and replaces a Latin misread when the same spot is Chinese.
 */

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/
const DET_LIMIT = 1280
const DET_THRESH = 0.3
const BOX_THRESH = 0.5
const MAX_LINES = 80

export type OnnxLine = { text: string; conf: number; x: number; y: number; w: number; h: number }

type OrtNS = typeof import('onnxruntime-node')

let ort: OrtNS | null = null
let det: InferenceSession | null = null
let rec: InferenceSession | null = null
let chars: string[] | null = null
let broken: string | null = null
let loading: Promise<boolean> | null = null

export function onnxError(): string | null {
  return broken
}

function modelDir(): string {
  if (process.env.NUBBO_OCR_DIR) return process.env.NUBBO_OCR_DIR
  try {
    const electron = require('electron') as { app?: { isPackaged: boolean; getAppPath: () => string } }
    if (electron && typeof electron === 'object' && electron.app) {
      if (electron.app.isPackaged) return path.join(process.resourcesPath, 'ocr')
      return path.join(electron.app.getAppPath(), 'ocr')
    }
  } catch {
    /* plain node */
  }
  return path.join(__dirname, '..', 'ocr')
}

function loadChars(file: string, classes: number): string[] {
  let raw = fs.readFileSync(file, 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  const keys = raw.split(/\r?\n/)
  if (keys.length && keys[keys.length - 1] === '') keys.pop()
  const withSpace = keys.concat(' ')
  const blankSpace = ['blank', ...withSpace]
  const blankOnly = ['blank', ...keys]
  if (classes === blankSpace.length) return blankSpace
  if (classes === blankOnly.length) return blankOnly
  const out = ['blank', ...keys]
  while (out.length < classes) out.push('')
  return out.slice(0, classes)
}

function sessionOpts(): InferenceSession.SessionOptions {
  return {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    intraOpNumThreads: 4,
    interOpNumThreads: 1,
  }
}

export function warmOnnx(): Promise<boolean> {
  if (broken) return Promise.resolve(false)
  if (det && rec && chars) return Promise.resolve(true)
  if (!loading) {
    loading = (async () => {
      try {
        const dir = modelDir()
        const detPath = path.join(dir, 'ch_PP-OCRv4_det_infer.onnx')
        const recPath = path.join(dir, 'ch_PP-OCRv4_rec_infer.onnx')
        const keyPath = path.join(dir, 'ppocr_keys_v1.txt')
        if (!fs.existsSync(detPath) || !fs.existsSync(recPath) || !fs.existsSync(keyPath)) {
          throw new Error('Çince okuyucu dosyaları yok.')
        }
        if (!ort) ort = require('onnxruntime-node') as OrtNS
        det = await ort.InferenceSession.create(detPath, sessionOpts())
        rec = await ort.InferenceSession.create(recPath, sessionOpts())
        const meta = rec.outputMetadata[0]
        const shape = meta && meta.isTensor ? meta.shape : []
        const classes = shape.map((d) => (typeof d === 'number' ? d : 0)).find((d) => d > 100) || 0
        chars = loadChars(keyPath, classes || keysGuess(keyPath))
        return true
      } catch (e) {
        broken = (e as Error).message || String(e)
        det = null
        rec = null
        chars = null
        return false
      } finally {
        loading = null
      }
    })()
  }
  return loading
}

function keysGuess(file: string): number {
  const n = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l, i, a) => !(i === a.length - 1 && l === '')).length
  return n + 2
}

export function readRawShot(buf: Buffer): { w: number; h: number; bgra: Uint8Array } {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'XPAS') throw new Error('Ekran karesi okunamadı.')
  const w = buf.readInt32LE(4)
  const h = buf.readInt32LE(8)
  const need = 12 + w * h * 4
  if (w < 2 || h < 2 || w > 20000 || h > 20000 || buf.length < need) throw new Error('Ekran karesi eksik.')
  return { w, h, bgra: buf.subarray(12, need) }
}

function detSize(w: number, h: number): { dw: number; dh: number } {
  let ratio = 1
  const m = Math.max(w, h)
  if (m > DET_LIMIT) ratio = DET_LIMIT / m
  const dw = Math.max(32, Math.round((w * ratio) / 32) * 32)
  const dh = Math.max(32, Math.round((h * ratio) / 32) * 32)
  return { dw, dh }
}

function fillDet(bgra: Uint8Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const data = new Float32Array(3 * dh * dw)
  const plane = dh * dw
  const xScale = sw / dw
  const yScale = sh / dh
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * yScale - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const ty = sy - y0
    const row0 = y0 * sw
    const row1 = y1 * sw
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * xScale - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const tx = sx - x0
      const o00 = (row0 + x0) * 4
      const o10 = (row0 + x1) * 4
      const o01 = (row1 + x0) * 4
      const o11 = (row1 + x1) * 4
      const base = y * dw + x
      for (let c = 0; c < 3; c++) {
        const top = bgra[o00 + c] + (bgra[o10 + c] - bgra[o00 + c]) * tx
        const bot = bgra[o01 + c] + (bgra[o11 + c] - bgra[o01 + c]) * tx
        data[c * plane + base] = (top + (bot - top) * ty) / 255 * 2 - 1
      }
    }
  }
  return data
}

type RawBox = { x: number; y: number; w: number; h: number; score: number }

function components(prob: Float32Array, pw: number, ph: number): RawBox[] {
  const n = pw * ph
  const mask = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (prob[i] > DET_THRESH) mask[i] = 1
  const dil = new Uint8Array(n)
  for (let y = 0; y < ph; y++) {
    const row = y * pw
    const nrow = Math.min(ph - 1, y + 1) * pw
    for (let x = 0; x < pw; x++) {
      const x1 = Math.min(pw - 1, x + 1)
      if (mask[row + x] || mask[row + x1] || mask[nrow + x] || mask[nrow + x1]) dil[row + x] = 1
    }
  }
  const seen = new Uint8Array(n)
  const stack = new Int32Array(n)
  const found: RawBox[] = []
  for (let i = 0; i < n; i++) {
    if (!dil[i] || seen[i]) continue
    let sp = 0
    stack[sp++] = i
    seen[i] = 1
    let minX = pw
    let minY = ph
    let maxX = 0
    let maxY = 0
    let sum = 0
    let count = 0
    while (sp) {
      const p = stack[--sp]
      const x = p % pw
      const y = (p / pw) | 0
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      if (mask[p]) {
        sum += prob[p]
        count++
      }
      if (x > 0) {
        const q = p - 1
        if (dil[q] && !seen[q]) {
          seen[q] = 1
          stack[sp++] = q
        }
      }
      if (x + 1 < pw) {
        const q = p + 1
        if (dil[q] && !seen[q]) {
          seen[q] = 1
          stack[sp++] = q
        }
      }
      if (y > 0) {
        const q = p - pw
        if (dil[q] && !seen[q]) {
          seen[q] = 1
          stack[sp++] = q
        }
      }
      if (y + 1 < ph) {
        const q = p + pw
        if (dil[q] && !seen[q]) {
          seen[q] = 1
          stack[sp++] = q
        }
      }
    }
    if (count < 8) continue
    const score = sum / count
    if (score < BOX_THRESH) continue
    const bw = maxX - minX + 1
    const bh = maxY - minY + 1
    const dist = ((bw * bh) * 1.6) / (2 * (bw + bh))
    found.push({
      x: minX - dist,
      y: minY - dist,
      w: bw + dist * 2,
      h: bh + dist * 2,
      score,
    })
  }
  found.sort((a, b) => b.score - a.score)
  return found.slice(0, 200)
}

function mergeLineBoxes(boxes: RawBox[]): RawBox[] {
  const sorted = boxes.slice().sort((a, b) => a.y - b.y || a.x - b.x)
  const used = new Array<boolean>(sorted.length).fill(false)
  const out: RawBox[] = []
  for (let i = 0; i < sorted.length; i++) {
    if (used[i]) continue
    let b = sorted[i]
    used[i] = true
    let grew = true
    while (grew) {
      grew = false
      for (let j = 0; j < sorted.length; j++) {
        if (used[j]) continue
        const o = sorted[j]
        const v = Math.min(b.y + b.h, o.y + o.h) - Math.max(b.y, o.y)
        if (v < Math.min(b.h, o.h) * 0.5) continue
        const gapR = o.x - (b.x + b.w)
        const gapL = b.x - (o.x + o.w)
        const allow = Math.max(b.h, o.h) * 1.1
        if (!((gapR >= -4 && gapR < allow) || (gapL >= -4 && gapL < allow))) continue
        const x1 = Math.min(b.x, o.x)
        const y1 = Math.min(b.y, o.y)
        const x2 = Math.max(b.x + b.w, o.x + o.w)
        const y2 = Math.max(b.y + b.h, o.y + o.h)
        b = { x: x1, y: y1, w: x2 - x1, h: y2 - y1, score: Math.max(b.score, o.score) }
        used[j] = true
        grew = true
      }
    }
    out.push(b)
  }
  return out
}

function mapBox(b: RawBox, pw: number, ph: number, sw: number, sh: number): RawBox {
  const x = Math.max(0, Math.round((b.x / pw) * sw))
  const y = Math.max(0, Math.round((b.y / ph) * sh))
  const r = Math.min(sw, Math.round(((b.x + b.w) / pw) * sw))
  const bo = Math.min(sh, Math.round(((b.y + b.h) / ph) * sh))
  return { x, y, w: Math.max(1, r - x), h: Math.max(1, bo - y), score: b.score }
}

function cropOf(bgra: Uint8Array, sw: number, sh: number, box: RawBox): { data: Uint8Array; w: number; h: number } {
  let x = Math.max(0, box.x)
  let y = Math.max(0, box.y)
  let w = Math.min(sw - x, box.w)
  let h = Math.min(sh - y, box.h)
  const tall = h > w * 1.5
  if (!tall) {
    const out = new Uint8Array(w * h * 4)
    for (let row = 0; row < h; row++) {
      out.set(bgra.subarray(((y + row) * sw + x) * 4, ((y + row) * sw + x + w) * 4), row * w * 4)
    }
    return { data: out, w, h }
  }
  const nw = h
  const nh = w
  const out = new Uint8Array(nw * nh * 4)
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const nx = sy
      const ny = w - 1 - sx
      const s = ((y + sy) * sw + (x + sx)) * 4
      const d = (ny * nw + nx) * 4
      out[d] = bgra[s]
      out[d + 1] = bgra[s + 1]
      out[d + 2] = bgra[s + 2]
      out[d + 3] = bgra[s + 3]
    }
  }
  return { data: out, w: nw, h: nh }
}

function recTensor(img: Uint8Array, w: number, h: number, targetW: number): Float32Array {
  const th = 48
  const ratio = w / Math.max(1, h)
  let rw = Math.ceil(th * ratio)
  if (rw > targetW) rw = targetW
  if (rw < 8) rw = 8
  const data = new Float32Array(3 * th * targetW)
  const plane = th * targetW
  for (let y = 0; y < th; y++) {
    const sy = Math.min(h - 1, ((y + 0.5) * h) / th - 0.5)
    const y0 = Math.max(0, Math.floor(sy))
    const y1 = Math.min(h - 1, y0 + 1)
    const ty = Math.min(1, Math.max(0, sy - y0))
    for (let x = 0; x < rw; x++) {
      const sx = Math.min(w - 1, ((x + 0.5) * w) / rw - 0.5)
      const x0 = Math.max(0, Math.floor(sx))
      const x1 = Math.min(w - 1, x0 + 1)
      const tx = Math.min(1, Math.max(0, sx - x0))
      const o00 = (y0 * w + x0) * 4
      const o10 = (y0 * w + x1) * 4
      const o01 = (y1 * w + x0) * 4
      const o11 = (y1 * w + x1) * 4
      const base = y * targetW + x
      for (let c = 0; c < 3; c++) {
        const top = img[o00 + c] + (img[o10 + c] - img[o00 + c]) * tx
        const bot = img[o01 + c] + (img[o11 + c] - img[o01 + c]) * tx
        data[c * plane + base] = (top + (bot - top) * ty) / 255 * 2 - 1
      }
    }
  }
  return data
}

function recWidth(session: InferenceSession, need: number): number {
  const meta = session.inputMetadata[0]
  const shape = meta && meta.isTensor ? meta.shape : []
  const last = shape[shape.length - 1]
  if (typeof last === 'number' && last > 0) return last
  return Math.max(320, Math.ceil(need / 8) * 8)
}

function tidy(text: string): string {
  return text.replace(/([\u3040-\u9fff\uf900-\ufaff\uac00-\ud7af])\s+(?=[\u3040-\u9fff\uf900-\ufaff\uac00-\ud7af])/g, '$1').trim()
}

function decode(data: Float32Array, dims: readonly number[], alphabet: string[]): { text: string; conf: number } {
  let T = 0
  let C = 0
  let layout: 'tc' | 'ct' = 'tc'
  if (dims.length === 3) {
    const a = dims[1]
    const b = dims[2]
    if (b === alphabet.length || b > a) {
      T = a
      C = b
    } else {
      C = a
      T = b
      layout = 'ct'
    }
  } else if (dims.length === 2) {
    T = dims[0]
    C = dims[1]
  } else throw new Error('Beklenmeyen tanıma çıktısı.')
  const at = (t: number, c: number) => (layout === 'tc' ? data[t * C + c] : data[c * T + t])
  let prev = -1
  let text = ''
  let confSum = 0
  let n = 0
  const use = Math.min(C, alphabet.length)
  for (let t = 0; t < T; t++) {
    let best = 0
    let bv = -Infinity
    let max = -Infinity
    let neg = false
    let raw = 0
    for (let c = 0; c < use; c++) {
      const v = at(t, c)
      raw += v
      if (v < 0) neg = true
      if (v > max) max = v
      if (v > bv) {
        bv = v
        best = c
      }
    }
    let prob = bv
    if (neg || raw < 0.85 || raw > 1.15) {
      let s = 0
      for (let c = 0; c < use; c++) s += Math.exp(at(t, c) - max)
      prob = Math.exp(bv - max) / s
    }
    if (best !== 0 && best !== prev) {
      const ch = alphabet[best]
      if (ch && ch !== 'blank') {
        text += ch
        confSum += prob
        n++
      }
    }
    prev = best
  }
  return { text: tidy(text), conf: n ? confSum / n : 0 }
}

function tensorMap(session: InferenceSession, data: Float32Array, dims: number[]): Record<string, Tensor> {
  if (!ort) throw new Error('onnxruntime yok')
  const name = session.inputNames[0]
  return { [name]: new ort.Tensor('float32', data, dims) }
}

export async function recognizeBgra(bgra: Uint8Array, w: number, h: number, originX: number, originY: number): Promise<OnnxLine[]> {
  const ok = await warmOnnx()
  if (!ok || !det || !rec || !chars || !ort) return []
  const { dw, dh } = detSize(w, h)
  const detIn = fillDet(bgra, w, h, dw, dh)
  const detOut = await det.run(tensorMap(det, detIn, [1, 3, dh, dw]))
  const outName = det.outputNames[0]
  const pred = detOut[outName]
  const dims = pred.dims
  let pw = dw
  let ph = dh
  let prob: Float32Array
  const raw = pred.data as Float32Array
  if (dims.length === 4) {
    ph = dims[2]
    pw = dims[3]
    prob = raw.subarray(0, ph * pw)
  } else if (dims.length === 3) {
    ph = dims[1]
    pw = dims[2]
    prob = raw.subarray(0, ph * pw)
  } else {
    prob = raw
  }
  const mapped = mergeLineBoxes(components(prob, pw, ph).map((b) => mapBox(b, pw, ph, w, h)))
    .filter((b) => b.w >= 4 && b.h >= 6 && b.w * b.h < w * h * 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_LINES)
  const lines: OnnxLine[] = []
  for (const box of mapped) {
    const crop = cropOf(bgra, w, h, box)
    if (crop.w < 2 || crop.h < 2) continue
    const tw = recWidth(rec, Math.ceil(48 * (crop.w / crop.h)))
    const input = recTensor(crop.data, crop.w, crop.h, tw)
    const recOut = await rec.run(tensorMap(rec, input, [1, 3, 48, tw]))
    const rname = rec.outputNames[0]
    const rt = recOut[rname]
    const decoded = decode(rt.data as Float32Array, rt.dims, chars)
    if (!decoded.text || decoded.conf < 0.5) continue
    lines.push({
      text: decoded.text,
      conf: decoded.conf,
      x: originX + box.x,
      y: originY + box.y,
      w: box.w,
      h: box.h,
    })
  }
  return lines
}

export async function recognizeShot(file: string, originX: number, originY: number): Promise<OnnxLine[]> {
  const buf = fs.readFileSync(file)
  const shot = readRawShot(buf)
  return recognizeBgra(shot.bgra, shot.w, shot.h, originX, originY)
}

/** Turn a packed BGRA frame 90° counter-clockwise. New size is h × w. */
export function rotateBgraCcw(bgra: Uint8Array, w: number, h: number): { bgra: Uint8Array; w: number; h: number } {
  const nw = h
  const nh = w
  const out = new Uint8Array(nw * nh * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const rx = y
      const ry = w - 1 - x
      const si = (y * w + x) * 4
      const di = (ry * nw + rx) * 4
      out[di] = bgra[si]
      out[di + 1] = bgra[si + 1]
      out[di + 2] = bgra[si + 2]
      out[di + 3] = bgra[si + 3]
    }
  }
  return { bgra: out, w: nw, h: nh }
}

function unrotateCcw(
  line: { x: number; y: number; w: number; h: number },
  srcW: number,
  srcH: number,
  originX: number,
  originY: number
): { x: number; y: number; w: number; h: number } | null {
  let x = srcW - line.y - line.h
  let y = line.x
  let w = line.h
  let h = line.w
  if (x < 0) {
    w += x
    x = 0
  }
  if (y < 0) {
    h += y
    y = 0
  }
  if (x + w > srcW) w = srcW - x
  if (y + h > srcH) h = srcH - y
  if (w < 1 || h < 1) return null
  return { x: originX + x, y: originY + y, w, h }
}

/**
 * Lines read on the counter-clockwise frame, mapped back to the screen.
 * A line that overlaps any OCR box already found, including one added here, is dropped.
 */
export function placeSideways(
  lines: OnnxLine[],
  existing: ScreenItem[],
  srcW: number,
  srcH: number,
  originX: number,
  originY: number
): ScreenItem[] {
  const ocr = existing.filter((i) => i.src === 'ocr')
  const fresh: ScreenItem[] = []
  let nextId = existing.reduce((m, i) => Math.max(m, i.id || 0), 0) + 1
  for (const line of lines) {
    const text = acceptedText(line)
    if (!text) continue
    const box = unrotateCcw(line, srcW, srcH, originX, originY)
    if (!box) continue
    if ([...ocr, ...fresh].some((it) => overlapRatio(box, it) > 0)) continue
    const item = lineItem(nextId++, text, { ...line, text, x: box.x, y: box.y, w: box.w, h: box.h })
    fresh.push(item)
  }
  return fresh
}

export async function recognizeSideways(
  bgra: Uint8Array,
  w: number,
  h: number,
  originX: number,
  originY: number,
  existing: ScreenItem[]
): Promise<ScreenItem[]> {
  const turned = rotateBgraCcw(bgra, w, h)
  const lines = await recognizeBgra(turned.bgra, turned.w, turned.h, 0, 0)
  return placeSideways(lines, existing, w, h, originX, originY)
}

function keyOf(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function sameKey(a: string, b: string): boolean {
  const ka = keyOf(a)
  const kb = keyOf(b)
  if (!ka || !kb) return false
  if (ka === kb) return true
  const short = ka.length < kb.length ? ka : kb
  const long = ka.length < kb.length ? kb : ka
  return short.length >= 2 && long.includes(short)
}

function overlapRatio(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  if (x2 <= x1 || y2 <= y1) return 0
  const inter = (x2 - x1) * (y2 - y1)
  const small = Math.min(a.w * a.h, b.w * b.h)
  return small > 0 ? inter / small : 0
}

export type OcrEngine = 'windows' | 'onnx'

function acceptedText(line: OnnxLine): string | null {
  const text = line.text.replace(/\s+/g, ' ').trim()
  if (!text) return null
  const cjk = CJK.test(text)
  const latin = /[A-Za-z]/.test(text)
  if (!cjk && !latin) return null
  if (!cjk && (line.conf < 0.85 || text.length < 2)) return null
  if (cjk && line.conf < 0.5) return null
  return text
}

function lineItem(id: number, text: string, line: OnnxLine): ScreenItem {
  const x = Math.round(line.x)
  const y = Math.round(line.y)
  const w = Math.max(1, Math.round(line.w))
  const h = Math.max(1, Math.round(line.h))
  return { id, text, type: 'Text', src: 'ocr', x, y, w, h, words: [{ t: text, x, y, w, h }] }
}

/**
 * ONNX is the only OCR. Windows lines are dropped, including the ones it invented
 * for Chinese. Application names (UIA) stay. If ONNX read nothing, Windows lines stay.
 */
function preferOnnx(items: ScreenItem[], lines: OnnxLine[]): { items: ScreenItem[]; added: number; usedOnnx: boolean } {
  const accepted = lines.flatMap((line) => {
    const text = acceptedText(line)
    return text ? [{ text, line }] : []
  })
  if (accepted.length === 0) return { items, added: 0, usedOnnx: false }
  const kept = items.filter((i) => i.src !== 'ocr')
  let nextId = kept.reduce((m, i) => Math.max(m, i.id || 0), 0) + 1
  const ocr = accepted.map(({ text, line }) => lineItem(nextId++, text, line))
  return { items: [...kept, ...ocr], added: ocr.length, usedOnnx: true }
}

/** Keep Windows lines. Add a new line, or replace Latin garbage when this spot is actually Chinese. */
export function mergeOnnxLines(
  items: ScreenItem[],
  lines: OnnxLine[],
  engine: OcrEngine = 'windows'
): { items: ScreenItem[]; added: number; usedOnnx: boolean } {
  if (engine === 'onnx') return preferOnnx(items, lines)
  const out: ScreenItem[] = items.map((i) => ({ ...i, words: i.words?.map((w) => ({ ...w })) }))
  let added = 0
  let nextId = out.reduce((m, i) => Math.max(m, i.id || 0), 0) + 1
  for (const line of lines) {
    const text = acceptedText(line)
    if (!text) continue
    const cjk = CJK.test(text)
    const box = { x: line.x, y: line.y, w: line.w, h: line.h }
    let skip = false
    for (const it of out) {
      if (overlapRatio(box, it) < 0.45) continue
      if (sameKey(text, it.text)) {
        skip = true
        break
      }
      if (it.src === 'uia' && CJK.test(it.text)) {
        skip = true
        break
      }
      if (it.src === 'ocr' && cjk && !CJK.test(it.text)) {
        it.text = text
        it.x = box.x
        it.y = box.y
        it.w = Math.max(1, Math.round(box.w))
        it.h = Math.max(1, Math.round(box.h))
        it.words = [{ t: text, x: it.x, y: it.y, w: it.w, h: it.h }]
        added++
        skip = true
        break
      }
      if (!cjk) {
        skip = true
        break
      }
    }
    if (skip) continue
    out.push(lineItem(nextId++, text, line))
    added++
  }
  return { items: out, added, usedOnnx: added > 0 }
}
