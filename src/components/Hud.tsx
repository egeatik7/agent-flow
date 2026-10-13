import { useEffect, useState } from 'react'
import nubbo from '../assets/nubbo.png'
import still from '../assets/nubbo-still.png'
import type { BaglamKarti } from '../../electron/hud-context'
import type { LogLevel } from '../types'

type Status = { level: LogLevel; text: string }

const IDLE: Status = { level: 'info', text: 'Ne yaptığı burada yazacak.' }

export default function Hud() {
  const [status, setStatus] = useState<Status>(() =>
    window.xpAgent ? IDLE : { level: 'info', text: 'deepseek-v4: şimdi Kaydet’e basmalıyım.' }
  )
  const [loop, setLoop] = useState(() => (window.xpAgent ? '' : 'Modeller · 3/12 · kedi.png'))
  const [method, setMethod] = useState(() => (window.xpAgent ? '' : 'Windows OCR'))
  /** Zamanlayıcı adımı sürerken kalan süre; adım bitince boşalır. */
  const [countdown, setCountdown] = useState('')
  /** Son üç aşama ve süreleri (1.9.119): OCR + liste → Model → Kelime seçimi. */
  const [stages, setStages] = useState('')
  /** Bağlam ölçümü (1.9.129): main'den NESNE olarak gelir; günlük metni ayrıştırılmaz. */
  const [baglam, setBaglam] = useState<BaglamKarti | undefined>(undefined)
  const [recovering, setRecovering] = useState(false)
  const [playing, setPlaying] = useState(() => !document.hidden)

  useEffect(() => {
    const onVis = () => setPlaying(!document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    document.documentElement.classList.add('hud-root')
    document.title = ''
    const off = window.xpAgent?.onHud?.((payload) => {
      const p = payload as Partial<Status>
      const text = typeof p.text === 'string' ? p.text.trim() : ''
      if (!text) return
      const level = p.level === 'warn' || p.level === 'error' || p.level === 'success' || p.level === 'info' ? p.level : 'info'
      setStatus({ level, text })
    })
    const offLoop = window.xpAgent?.onHudLoop?.((payload) => {
      const text = typeof (payload as { text?: unknown }).text === 'string' ? (payload as { text: string }).text.trim() : ''
      setLoop(text)
    })
    const offMethod = window.xpAgent?.onHudMethod?.((payload) => {
      const text = typeof (payload as { text?: unknown }).text === 'string' ? (payload as { text: string }).text.trim() : ''
      setMethod(text)
    })
    const offRecovery = window.xpAgent?.onRecoveryStatus?.(payload => {
      setRecovering(payload.active)
      setStatus({ level: payload.active ? 'warn' : 'info', text: `${payload.nodeTitle}: ${payload.message}` })
    })
    const offCountdown = window.xpAgent?.onHudCountdown?.((payload) => {
      const text = typeof (payload as { text?: unknown }).text === 'string' ? (payload as { text: string }).text.trim() : ''
      setCountdown(text)
    })
    const offStages = window.xpAgent?.onHudStages?.((payload) => {
      const text = typeof (payload as { text?: unknown }).text === 'string' ? (payload as { text: string }).text.trim() : ''
      setStages(text)
    })
    const offBaglam = window.xpAgent?.onHudContext?.((payload) => {
      const kart = (payload as { kart?: BaglamKarti | null } | null)?.kart
      setBaglam(kart && typeof kart === 'object' ? kart : undefined)
    })
    return () => {
      document.documentElement.classList.remove('hud-root')
      off?.()
      offLoop?.()
      offMethod?.()
      offRecovery?.()
      offCountdown?.()
      offStages?.()
      offBaglam?.()
    }
  }, [])

  const mascot = playing ? nubbo : still
  return (
    <div className="hud">
      <div className="hud-mascot-slot">
        <img key={mascot} className="hud-mascot" src={mascot} alt="" draggable={false} />
      </div>
      <div className={`hud-card ${status.level}`}>
        <div className="hud-title">
          <span className="hud-dot" />
          Nubbo
        </div>
        <p className="hud-text">{status.text}</p>
        {countdown && <p className="hud-countdown" role="timer">{countdown}</p>}
      {stages && <p className="hud-stages">{stages}</p>}
      </div>
      <p className={`hud-line hud-method${method || recovering ? ' on' : ''}`}>{recovering ? 'Kurtarma ajanı devrede · akış bekliyor' : method}</p>
      {/*
        BAĞLAM ÖLÇÜMÜ (1.9.129): ölçüm NESNESİNDEN yazılır (günlük metni ayrıştırılmaz). İlk satır
        kullanıcının istediği cümledir: "Yüklü bağlam: 32.768 token". Ölçüm yoksa "bilinmiyor",
        yaşlıysa "eski ölçüm" yazar; yapılandırılmış pencere "yüklü" diye GÖSTERİLMEZ.
      */}
      {baglam && (
        <div className={`hud-baglam${baglam.eski ? ' eski' : ''}${baglam.bilinmiyor ? ' bilinmiyor' : ''}`} role="status" aria-label="Yüklü bağlam ölçümü">
          <p className="hud-baglam-ana">{baglam.yukluMetin}<span className="hud-baglam-rozet">{` · ${baglam.rozet}`}</span></p>
          <p className="hud-baglam-ayrinti">
            {`Azami ${baglam.azamiToken === null ? 'bilinmiyor' : baglam.azamiToken.toLocaleString('tr-TR')} · Yapılandırılmış ${baglam.yapilandirilmisToken === null ? 'bilinmiyor' : baglam.yapilandirilmisToken.toLocaleString('tr-TR')} · Gönderilen num_ctx ${baglam.istekNumCtx === null ? 'yok' : baglam.istekNumCtx.toLocaleString('tr-TR')}`}
          </p>
          <p className="hud-baglam-ayrinti">
            {`Giriş ${baglam.girisToken === null ? 'bilinmiyor' : `${baglam.girisToken.toLocaleString('tr-TR')} (ölçüm)`} · tahmini ${baglam.tahminiToken === null ? 'bilinmiyor' : `${baglam.tahminiToken.toLocaleString('tr-TR')} (TAHMİN)`}`}
          </p>
        </div>
      )}
      <p className={`hud-line hud-loop${loop ? ' on' : ''}`}>{loop}</p>
    </div>
  )
}
