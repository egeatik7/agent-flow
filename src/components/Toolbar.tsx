import { useEffect, useRef, useState } from 'react'
import { NODE_KINDS, NODE_SPECS, type NodeKind } from '../types'
import type { Theme } from '../lib/theme'

type Props = {
  theme: Theme
  onTheme: (theme: Theme) => void
  running: boolean
  busy?: boolean
  hasStart: boolean
  hasSelection: boolean
  capturing: number
  onAdd: (kind: NodeKind) => void
  canPackage: boolean
  onPackage: () => void
  onCapture: () => void
  onOpenScanner: () => void
  onRun: () => void
  onRunFromSelected: () => void
  onStop: () => void
  onLayout: () => void
  onForget: () => void
  onResetLoops: () => void
}

export default function Toolbar(p: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const kinds = NODE_KINDS.filter((k) => k !== 'package' && k !== 'browser' && k !== 'waitFile' && k !== 'moveFile' && (k !== 'start' || !p.hasStart))

  return (
    <div className="toolbar">
      <div className="dropdown" ref={ref}>
        <button type="button" className="xp-btn" disabled={p.running || p.busy} onClick={() => setOpen((o) => !o)}>
          + Node Ekle ▾
        </button>
        {open && (
          <div className="dropdown-menu">
            <div className="ctx-title">{p.hasSelection ? 'Seçili node’dan sonra ekle' : 'Akışın sonuna ekle'}</div>
            {kinds.map((k) => (
              <button
                type="button"
                key={k}
                disabled={p.running || p.busy}
                onClick={() => {
                  p.onAdd(k)
                  setOpen(false)
                }}
              >
                <span className="ctx-icon" style={{ background: NODE_SPECS[k].color }}>
                  {NODE_SPECS[k].icon}
                </span>
                <span>
                  <b>{NODE_SPECS[k].label}</b>
                  <small>{NODE_SPECS[k].description}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {p.canPackage && (
        <button
          type="button"
          className="xp-btn"
          onClick={p.onPackage}
          disabled={p.running || p.busy}
          title="Seçili node’ları tek pakete alır. Döngünün bir parçası seçilirse kutu, içindeki her node ile birlikte girer."
        >
          Paketle
        </button>
      )}

      <span className="tb-sep" />

      <button type="button" className="xp-btn" onClick={p.onOpenScanner} disabled={p.running || p.busy} title="Ekrandaki yazıları gör, birini seçerek Tıkla node’u ekle">
        Ekran Tarayıcı
      </button>
      <button type="button" className="xp-btn" onClick={p.onCapture} disabled={p.capturing > 0 || p.running || p.busy}>
        {p.capturing > 0 ? `İmleci hedefe götür… ${p.capturing}` : 'İmleçle Yakala (3 sn)'}
      </button>

      <span className="tb-sep" />

      {p.running ? (
        <button type="button" className="xp-btn danger strong" onClick={p.onStop}>
          ■ Durdur
        </button>
      ) : (
        <>
          <button type="button" className="xp-btn primary" disabled={p.busy} onClick={p.onRun}>
            ▶ Ajanı Çalıştır
          </button>
          <button type="button" className="xp-btn" onClick={p.onRunFromSelected} disabled={p.busy || !p.hasSelection}>
            Seçiliden Çalıştır
          </button>
        </>
      )}

      <span className="tb-sep" />

      <button type="button" className="xp-btn" onClick={p.onLayout} disabled={p.running || p.busy}>
        Düzenle
      </button>
      <button
        type="button"
        className="xp-btn"
        onClick={p.onForget}
        disabled={p.running || p.busy}
        title="Bütün node’ların hafızasını ve kayıtlı yollarını siler. Akışın kendisi durur."
      >
        Hafızayı Sil
      </button>
      <button
        type="button"
        className="xp-btn"
        onClick={p.onResetLoops}
        disabled={p.running || p.busy}
        title="Bu tuvaldeki her döngüyü 1. öğeye alır. Önce dıştakiler, sonra onların ilk öğesine göre iç listeler."
      >
        Döngüleri Sıfırla
      </button>

      <div className="theme-picker" role="group" aria-label="Arayüz teması">
        {(['aero', 'xp'] as const).map(theme => (
          <button key={theme} type="button" className={`xp-btn theme-option${p.theme === theme ? ' active' : ''}`}
            aria-pressed={p.theme === theme} onClick={() => p.onTheme(theme)}
            title={theme === 'aero' ? 'Lila cam Aero arayüzü' : 'Klasik Windows XP arayüzü'}>
            {theme === 'aero' && <span className="theme-orb" aria-hidden="true" />}
            {theme === 'aero' ? 'Aero' : 'XP'}
          </button>
        ))}
      </div>
    </div>
  )
}
