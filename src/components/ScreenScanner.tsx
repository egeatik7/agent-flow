import { useEffect, useMemo, useRef, useState } from 'react'
import { rampIsFlat, remapPixel } from '../lib/value-ramp'
import type { ScanResult, ScreenItem } from '../types'

type Props = {
  targetLabel: string
  windows: { title: string; handle: string }[]
  defaultWindow: string
  valueLo: number
  valueHi: number
  onSave: (lo: number, hi: number) => void | Promise<void>
  onScan: (windowTitle: string, ramp: { lo: number; hi: number }) => Promise<ScanResult>
  onPick: (item: ScreenItem) => void
  onClose: () => void
}

function norm(s: string) {
  return s.replace(/[İIı]/g, 'i').toLowerCase()
}

function bytesOf(data: string): Uint8Array<ArrayBuffer> {
  const bin = atob(data)
  const bytes = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export default function ScreenScanner(p: Props) {
  const [scope, setScope] = useState(p.defaultWindow)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [hover, setHover] = useState<number | null>(null)
  const [source, setSource] = useState<'all' | 'uia' | 'ocr'>('all')
  const [lo, setLo] = useState(p.valueLo)
  const [hi, setHi] = useState(p.valueHi)
  const [rampOpen, setRampOpen] = useState(false)
  const rampRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragStop = useRef<'lo' | 'hi' | null>(null)
  const rampNow = useRef({ lo: p.valueLo, hi: p.valueHi })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const baseRef = useRef<ImageData | null>(null)
  const [painted, setPainted] = useState(false)

  useEffect(() => {
    rampNow.current = { lo: p.valueLo, hi: p.valueHi }
    setLo(p.valueLo)
    setHi(p.valueHi)
  }, [p.valueLo, p.valueHi])

  const setRamp = (nextLo: number, nextHi: number) => {
    const a = Math.min(1, Math.max(0, nextLo))
    const b = Math.min(1, Math.max(0, nextHi))
    const lo2 = Math.min(a, b)
    const hi2 = Math.max(a, b)
    rampNow.current = { lo: lo2, hi: hi2 }
    setLo(lo2)
    setHi(hi2)
  }

  const saved =
    Math.abs(lo - p.valueLo) < 0.005 && Math.abs(hi - p.valueHi) < 0.005

  const saveRamp = () => {
    const now = rampNow.current
    return p.onSave(now.lo, now.hi)
  }

  const scan = async () => {
    setLoading(true)
    setError(null)
    try {
      setResult(await p.onScan(scope, { lo, hi }))
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void scan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (rampOpen) {
        setRampOpen(false)
        return
      }
      p.onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [p, rampOpen])

  useEffect(() => {
    if (!rampOpen) return
    const close = (e: PointerEvent) => {
      if (rampRef.current?.contains(e.target as Node)) return
      setRampOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [rampOpen])

  const placeStop = (which: 'lo' | 'hi', x: number) => {
    const now = rampNow.current
    if (which === 'lo') setRamp(Math.min(x, now.hi), now.hi)
    else setRamp(now.lo, Math.max(x, now.lo))
  }

  const atTrack = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width < 1) return 0
    return Math.round(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * 100) / 100
  }

  const items = useMemo(() => {
    const all = result?.items ?? []
    const f = norm(filter.trim())
    return all.filter((i) => (source === 'all' || i.src === source) && (!f || norm(i.text).includes(f)))
  }, [result, filter, source])

  const area = result?.area
  const img = result?.image
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!img?.data) {
      setSrc(null)
      return
    }
    const url = URL.createObjectURL(new Blob([bytesOf(img.data)], { type: img.mime || 'image/png' }))
    setSrc(url)
    setPainted(false)
    baseRef.current = null
    return () => URL.revokeObjectURL(url)
  }, [img?.data, img?.mime])

  useEffect(() => {
    if (!src) return
    let cancel = false
    const image = new Image()
    image.onload = () => {
      if (cancel || !image.naturalWidth) return
      const c = document.createElement('canvas')
      c.width = image.naturalWidth
      c.height = image.naturalHeight
      const g = c.getContext('2d', { willReadFrequently: true })
      if (!g) return
      g.drawImage(image, 0, 0)
      baseRef.current = g.getImageData(0, 0, c.width, c.height)
      paintRamp()
    }
    image.src = src
    return () => {
      cancel = true
    }
    // paintRamp closes over the latest stops; the effect below repaints when they move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  const paintRamp = () => {
    const base = baseRef.current
    const canvas = canvasRef.current
    if (!base || !canvas) return
    if (canvas.width !== base.width || canvas.height !== base.height) {
      canvas.width = base.width
      canvas.height = base.height
    }
    const g = canvas.getContext('2d')
    if (!g) return
    if (rampIsFlat(lo, hi)) {
      g.putImageData(base, 0, 0)
      setPainted(true)
      return
    }
    const out = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height)
    const d = out.data
    for (let i = 0; i < d.length; i += 4) {
      const [r, gc, b] = remapPixel(d[i], d[i + 1], d[i + 2], lo, hi)
      d[i] = r
      d[i + 1] = gc
      d[i + 2] = b
    }
    g.putImageData(out, 0, 0)
    setPainted(true)
  }

  useEffect(() => {
    paintRamp()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lo, hi, src])

  return (
    <div className="modal-backdrop" onMouseDown={p.onClose}>
      <div className="xp-dialog scanner" onMouseDown={(e) => e.stopPropagation()}>
        <div className="titlebar dialog-title">
          <div className="titlebar-left">
            <div className="titlebar-icon" aria-hidden />
            <h1>Ekran Tarayıcı — {p.targetLabel}</h1>
          </div>
          <div className="titlebar-controls">
            <button type="button" className="title-btn close" title="Kapat" onClick={p.onClose}>
              ✕
            </button>
          </div>
        </div>
        <div className="toolbar">
          <button type="button" className="xp-btn primary" onClick={scan} disabled={loading}>
            {loading ? 'Taranıyor…' : 'Ekranı Tara'}
          </button>
          <select className="xp-select scope" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">Tüm ekran</option>
            {p.windows.map((w) => (
              <option key={w.handle + w.title} value={w.title}>
                {w.title}
              </option>
            ))}
          </select>
          <span className="tb-sep" />
          <input
            className="xp-input search"
            placeholder="Yazı ara… (örn. opera)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select className="xp-select source" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            <option value="all">Hepsi</option>
            <option value="uia">Uygulama öğeleri</option>
            <option value="ocr">OCR yazıları</option>
          </select>
          <div className="dropdown ramp-drop" ref={rampRef}>
            <button
              type="button"
              className={`xp-btn${rampOpen ? ' open' : ''}`}
              title="Value ramp. Siyah durağı ve altı 0 olur. Beyaz durağı ve üstü 1 olur."
              onClick={() => setRampOpen((v) => !v)}
            >
              Değer {lo.toFixed(2)}–{hi.toFixed(2)} ▾
            </button>
            {rampOpen && (
              <div className="dropdown-menu ramp-menu" onMouseDown={(e) => e.stopPropagation()}>
                <div className="ramp-title">Value ramp</div>
                <p className="ramp-hint">Siyah durak ve altındaki her değer 0 olur. Beyaz durak ve üstündeki her değer 1 olur. Arası 0’dan 1’e yayılır. Kaydet’e basınca kalır.</p>
                <div
                  className="ramp-track"
                  ref={trackRef}
                  onPointerDown={(e) => {
                    const x = atTrack(e.clientX)
                    const which = Math.abs(x - lo) <= Math.abs(x - hi) ? 'lo' : 'hi'
                    dragStop.current = which
                    e.currentTarget.setPointerCapture(e.pointerId)
                    placeStop(which, x)
                  }}
                  onPointerMove={(e) => {
                    if (!dragStop.current) return
                    placeStop(dragStop.current, atTrack(e.clientX))
                  }}
                  onPointerUp={() => {
                    dragStop.current = null
                  }}
                >
                  <div
                    className="ramp-bar"
                    style={{
                      background: `linear-gradient(90deg, #000 0%, #000 ${lo * 100}%, #fff ${hi * 100}%, #fff 100%)`,
                    }}
                  />
                  <span className="ramp-stop" style={{ left: `${lo * 100}%` }} />
                  <span className="ramp-stop hi" style={{ left: `${hi * 100}%` }} />
                </div>
                <div className="ramp-fields">
                  <label>
                    Siyah
                    <input
                      className="xp-input"
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={lo}
                      onChange={(e) => setRamp(Number(e.target.value), hi)}
                    />
                  </label>
                  <label>
                    Beyaz
                    <input
                      className="xp-input"
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={hi}
                      onChange={(e) => setRamp(lo, Number(e.target.value))}
                    />
                  </label>
                </div>
                <div className="ramp-presets">
                  <button type="button" className="xp-btn" onClick={() => setRamp(0, 1)}>
                    Düz 0–1
                  </button>
                  <button type="button" className="xp-btn" onClick={() => setRamp(0.15, 0.8)}>
                    0.15–0.80
                  </button>
                  <button type="button" className="xp-btn save" disabled={saved} onClick={() => void saveRamp()}>
                    {saved ? 'Kayıtlı' : 'Kaydet'}
                  </button>
                </div>
              </div>
            )}
          </div>
          <span className="scanner-count">
            {result ? `${items.length} / ${result.items.length} yazı` : ''}
            {result && !result.ocr ? ' · OCR kapalı' : ''}
            {result?.sideCount ? ` · yan ${result.sideCount}` : ''}
          </span>
        </div>
        <div className="scanner-body">
          <div className="scanner-shot">
            {loading && !result && <div className="scanner-empty">Uygulama küçültülüp ekran okunuyor…</div>}
            {error && <div className="scanner-empty error">{error}</div>}
            {src && area && (
              <div className="shot-wrap">
                <img src={src} alt="Ekran görüntüsü" draggable={false} className={painted ? 'shot-hidden' : ''} />
                <canvas ref={canvasRef} className={painted ? 'shot-canvas' : 'shot-canvas shot-hidden'} />
                {items.map((i) => (
                  <button
                    type="button"
                    key={i.id}
                    className={`shot-box ${i.src}${hover === i.id ? ' hover' : ''}`}
                    style={{
                      left: `${((i.x - area.x) / area.w) * 100}%`,
                      top: `${((i.y - area.y) / area.h) * 100}%`,
                      width: `${(Math.max(4, i.w) / area.w) * 100}%`,
                      height: `${(Math.max(4, i.h) / area.h) * 100}%`,
                    }}
                    title={`${i.text} (${i.src === 'uia' ? i.type : 'OCR'})`}
                    onMouseEnter={() => setHover(i.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => p.onPick(i)}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="scanner-list">
            {items.length === 0 && result && <div className="hint">Eşleşen yazı yok.</div>}
            {items.map((i) => (
              <button
                type="button"
                key={i.id}
                className={`scan-row${hover === i.id ? ' hover' : ''}`}
                onMouseEnter={() => setHover(i.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => p.onPick(i)}
              >
                <span className={`src-dot ${i.src}`} />
                <span className="scan-text">{i.text}</span>
                <span className="scan-type">{i.src === 'uia' ? i.type : 'OCR'}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="dialog-status">
          Bir kutuya veya listeden bir yazıya tıkla → “{p.targetLabel}” için kullanılır. Mavi: uygulamanın bildirdiği öğe, turuncu:
          ekrandan okunan yazı (OCR).
        </div>
      </div>
    </div>
  )
}
