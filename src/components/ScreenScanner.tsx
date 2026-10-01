import { useEffect, useMemo, useState } from 'react'
import type { ScanResult, ScreenItem } from '../types'

type Props = {
  targetLabel: string
  windows: { title: string; handle: string }[]
  defaultWindow: string
  onScan: (windowTitle: string) => Promise<ScanResult>
  onPick: (item: ScreenItem) => void
  onClose: () => void
}

function norm(s: string) {
  return s.replace(/[İIı]/g, 'i').toLowerCase()
}

function bytesOf(data: string): Uint8Array {
  const bin = atob(data)
  const bytes = new Uint8Array(bin.length)
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

  const scan = async () => {
    setLoading(true)
    setError(null)
    try {
      setResult(await p.onScan(scope))
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
    const key = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [p])

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
    return () => URL.revokeObjectURL(url)
  }, [img?.data, img?.mime])

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
          <span className="scanner-count">
            {result ? `${items.length} / ${result.items.length} yazı` : ''}
            {result && !result.ocr ? ' · OCR kapalı' : ''}
            {result?.sideCount ? ` · yan ${result.sideCount}` : ''}
            {result?.captureDebug ? ` · tanı: ${result.captureDebug}` : ''}
          </span>
        </div>
        <div className="scanner-body">
          <div className="scanner-shot">
            {loading && !result && <div className="scanner-empty">Uygulama küçültülüp ekran okunuyor…</div>}
            {error && <div className="scanner-empty error">{error}</div>}
            {src && area && (
              <div className="shot-wrap">
                <img src={src} alt="Ekran görüntüsü" draggable={false} />
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
