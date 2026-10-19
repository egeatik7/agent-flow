import { useEffect, useState } from 'react'
import nubbo from '../assets/nubbo.png'
import still from '../assets/nubbo-still.png'
import { hudContext, hudMemory, hudText, type HudContext, type HudMemory } from './hud-payload'
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
  const [baglam, setBaglam] = useState<HudContext | undefined>(undefined)
  /** Canlı bellek göstergesi (1.9.130): main'den NESNE olarak gelir; günlük metni ayrıştırılmaz. */
  const [bellek, setBellek] = useState<HudMemory | undefined>(undefined)
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
      const p = (payload ?? {}) as Partial<Status>
      const text = typeof p.text === 'string' ? p.text.trim() : ''
      if (!text) return
      const level = p.level === 'warn' || p.level === 'error' || p.level === 'success' || p.level === 'info' ? p.level : 'info'
      setStatus({ level, text })
    })
    const offLoop = window.xpAgent?.onHudLoop?.((payload) => {
      const text = hudText(payload)
      setLoop(text)
    })
    const offMethod = window.xpAgent?.onHudMethod?.((payload) => {
      const text = hudText(payload)
      setMethod(text)
    })
    const offRecovery = window.xpAgent?.onRecoveryStatus?.(payload => {
      if (!payload || typeof payload !== 'object') return
      setRecovering(payload.active === true)
      setStatus({ level: payload.active ? 'warn' : 'info', text: `${typeof payload.nodeTitle === 'string' ? payload.nodeTitle : ''}: ${typeof payload.message === 'string' ? payload.message : ''}` })
    })
    const offCountdown = window.xpAgent?.onHudCountdown?.((payload) => {
      const text = hudText(payload)
      setCountdown(text)
    })
    const offStages = window.xpAgent?.onHudStages?.((payload) => {
      const text = hudText(payload)
      setStages(text)
    })
    const offBaglam = window.xpAgent?.onHudContext?.((payload) => {
      const kart = (payload as { kart?: unknown } | null)?.kart
      if (kart === null) setBaglam(undefined)
      else { const parsed = hudContext(kart); if (parsed) setBaglam(parsed) }
    })
    const offBellek = window.xpAgent?.onHudMemory?.((payload) => {
      const kart = (payload as { kart?: unknown } | null)?.kart
      if (kart === null) setBellek(undefined)
      else { const parsed = hudMemory(kart); if (parsed) setBellek(parsed) }
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
      offBellek?.()
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
      <p title={method.startsWith('Yap ·') ? `Model: son başarılı model cevabının yaşı. Eylem: son eylem aracı girişiminin yaşı; tamamlanma kanıtı değildir. ${method}` : method} className={`hud-line hud-method${method || recovering ? ' on' : ''}`}>{recovering ? 'Kurtarma ajanı devrede · akış bekliyor' : method}</p>
      {/*
        CANLI BELLEK GÖSTERGESİ (1.9.130). Yalnız ölçüm ve raporlama: kart hiçbir şeyi temizlemez,
        süreç kapatmaz veya ayar değiştirmez. Kısa bölüm İKİ satırdır; GPU ve süreç ayrıntıları
        kaydırılabilir ayrıntıda durur (kart taşmaz, satırlar üst üste binmez).
      */}
      {bellek && (
        <div className={`hud-bellek${bellek.daraliyor ? ' daraliyor' : ''}${bellek.eski ? ' eski' : ''}`} role="status" aria-label="Canlı bellek ölçümü">
          <p className="hud-bellek-ana">{bellek.ramVram}</p>
          <p className="hud-bellek-ana">{bellek.butce}</p>
          {bellek.gpuSatirlari.length > 0 && <p className="hud-bellek-satir">{bellek.gpuSatirlari.join(' · ')}</p>}
          {bellek.surecSatirlari.map((satir) => <p key={satir} className="hud-bellek-satir">{satir}</p>)}
          {bellek.aciklamalar.map((satir) => <p key={satir} className="hud-bellek-aciklama">{satir}</p>)}
          {bellek.uyari && <p className="hud-bellek-uyari">{bellek.uyari}</p>}
          {bellek.hata && <p className="hud-bellek-uyari">{`Ölçüm hatası: ${bellek.hata}`}</p>}
          <p className="hud-bellek-satir">{bellek.olcumVar ? bellek.yas : 'Ölçüm: bilinmiyor'}{bellek.eski && bellek.olcumVar ? ' · eski ölçüm' : ''}</p>
        </div>
      )}
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
