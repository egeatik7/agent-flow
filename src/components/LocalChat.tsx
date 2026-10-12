import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { AppSettings, ModelInfo } from '../types'

type SohbetTuru = { id: number; role: 'user' | 'model'; text: string; source?: string; failed?: boolean }
type SonTur = { id: number; label: string; model: string; ms: number; chars: number; gpu: string }

let sayac = 0
const yeniId = () => ++sayac

/**
 * Yerel Model sekmesinin altındaki sohbet kutusu. Tek mesaj gönderir ve cevabı KİMİN verdiğini
 * (yerel sunucu mu, OpenRouter mı) her cevabın yanında, alttaki son turlarda ve Ajan Günlüğü'nde
 * açıkça yazar. VRAM yalnız ölçülebiliyorsa görünür (IPC yanıtındaki `gpu` alanı).
 */
export default function LocalChat({ settings, models, disabled }: {
  settings: AppSettings
  models: ModelInfo[]
  disabled?: boolean
}) {
  const yerelModeller = models.filter((m) => m.id.startsWith('local:'))
  const apiModeller = models.filter((m) => !m.id.startsWith('local:'))
  // "OpenRouter'a dön" işaretliyse sohbet de API'de başlar; kullanıcı yine de değiştirebilir.
  const [target, setTarget] = useState<'local' | 'api'>(settings.localOff === true ? 'api' : 'local')
  const [model, setModel] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [turlar, setTurlar] = useState<SohbetTuru[]>([])
  const [sonTurlar, setSonTurlar] = useState<SonTur[]>([])
  const [logSatirlari, setLogSatirlari] = useState<string[]>([])
  const liste = useRef<HTMLDivElement | null>(null)

  const secenekler = target === 'local' ? yerelModeller : apiModeller
  // Liste değişirse ilk satıra düşülür; seçim ayrı bir durumda tutulmaz ki ekran ile istek ayrışmasın.
  const secili = secenekler.some((m) => m.id === model) ? model : (secenekler[0]?.id ?? '')
  const kaynakAdi = target === 'local' ? 'Yerel' : 'API'

  useEffect(() => {
    liste.current?.scrollTo?.({ top: 1e6 })
  }, [turlar.length])

  // Ajan Günlüğü'nün sohbet satırları burada da görünür: kaynak etiketi ve VRAM aynı satırlardadır.
  useEffect(() => {
    const api = typeof window === 'undefined' ? undefined : window.xpAgent
    if (!api?.onAgentLog) return
    const off = api.onAgentLog((payload) => {
      const p = payload as { level?: string; message?: string } | undefined
      if (p?.level !== 'chat' || !p.message) return
      setLogSatirlari((s) => [p.message!.split('\n')[0], ...s].slice(0, 6))
    })
    return typeof off === 'function' ? off : undefined
  }, [])

  const gonder = async () => {
    const prompt = draft.trim()
    if (!prompt || busy || disabled) return
    setDraft(''); setError('')
    setTurlar((t) => [...t, { id: yeniId(), role: 'user', text: prompt }])
    setBusy(true)
    try {
      const api = typeof window === 'undefined' ? undefined : window.xpAgent
      if (!api?.localChat) throw new Error('Sohbet yalnız masaüstü uygulamasında çalışır.')
      const res = await api.localChat({ prompt, target, ...(secili ? { model: secili } : {}) })
      if (!res.ok) throw new Error(res.error || 'Model cevap vermedi.')
      const kaynak = `${res.target === 'local' ? 'Yerel' : 'API'} · ${res.model} · ${(res.ms / 1000).toFixed(1)} sn${res.gpu ? ` · VRAM ${res.gpu}` : ''}`
      setTurlar((t) => [...t, { id: yeniId(), role: 'model', text: res.reply, source: kaynak }])
      setSonTurlar((s) => [{ id: yeniId(), label: res.target === 'local' ? 'Yerel' : 'API', model: res.model, ms: res.ms, chars: res.reply.length, gpu: res.gpu }, ...s].slice(0, 6))
    } catch (e) {
      const mesaj = e instanceof Error ? e.message : String(e)
      setError(mesaj)
      setTurlar((t) => [...t, { id: yeniId(), role: 'model', text: `Cevap alınamadı: ${mesaj}`, failed: true }])
    } finally {
      setBusy(false)
    }
  }

  const balon = (role: SohbetTuru['role'], failed?: boolean): CSSProperties => ({
    display: 'inline-block', maxWidth: '92%', textAlign: 'left', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
    padding: '4px 6px', font: '12px Tahoma,sans-serif',
    border: `1px solid ${role === 'user' ? '#b9a97a' : failed ? '#c98b8b' : '#b7cbe2'}`,
    background: role === 'user' ? '#fff8dd' : failed ? '#fdeaea' : '#eef3fb',
  })

  return <fieldset className="xp-group" disabled={disabled}>
    <legend>Sohbet (canlı deneme)</legend>
    <p className="hint">Yazdığın mesaj tek tur olarak gider; cevabı yerel sunucunun mu yoksa OpenRouter'ın mı verdiği her cevabın altında ve Ajan Günlüğü'nde yazar. Ctrl+Enter gönderir.</p>
    <div className="field">
      <div className="field-row wrap">
        <select id="local-chat-target" className="xp-select" aria-label="Cevap verecek taraf" value={target} onChange={(e) => setTarget(e.target.value === 'api' ? 'api' : 'local')}>
          <option value="local">Yerel model</option>
          <option value="api">OpenRouter (API)</option>
        </select>
        {secenekler.length > 0 && <select id="local-chat-model" className="xp-select" aria-label="Sohbet modeli" value={secili} onChange={(e) => setModel(e.target.value)}>
          {secenekler.map((m) => <option key={m.id} value={m.id}>{target === 'local' ? m.id.slice(6) : m.id}</option>)}
        </select>}
      </div>
      {target === 'local' && <p className={settings.localBaseUrl?.trim() && settings.localOff !== true ? 'hint' : 'hint warn'}>
        {settings.localBaseUrl?.trim()
          ? `${settings.localOff === true ? 'Yerel modeller kapalı ("OpenRouter\'a dön" açık).' : 'Sunucu:'} ${settings.localBaseUrl.trim()}`
          : 'Yerel sunucu adresi kayıtlı değil; Yerel Model sekmesinden kur.'}
      </p>}
      {secenekler.length === 0 && <p className="hint warn">{target === 'local'
        ? 'Listede kayıtlı yerel model yok. Yukarıdan sunucuya bağlan, sonra modeli Genel sekmesindeki listeye ekle.'
        : 'Listede kayıtlı OpenRouter modeli yok. Genel sekmesinden bir metin modeli seç.'}</p>}
    </div>
    <div ref={liste} role="log" aria-label="Yerel sohbet" style={{ background: '#fff', border: '1px solid #7f9db9', padding: '5px', minHeight: '72px', maxHeight: '240px', overflow: 'auto' }}>
      {turlar.length === 0 && <p className="hint" style={{ margin: 0 }}>Henüz mesaj yok.</p>}
      {turlar.map((t) => <div key={t.id} style={{ margin: '0 0 6px', textAlign: t.role === 'user' ? 'right' : 'left' }}>
        <div style={balon(t.role, t.failed)}>{t.text}</div>
        {t.source && <small className="hint" style={{ display: 'block', margin: 0 }}>{t.source}</small>}
      </div>)}
    </div>
    <div className="field">
      <textarea id="local-chat-input" className="xp-textarea" rows={3} value={draft} disabled={busy}
        placeholder="Modele yaz… (Ctrl+Enter gönderir)"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void gonder() } }} />
      <div className="settings-actions">
        <button type="button" className="xp-btn primary" disabled={busy || !draft.trim()} onClick={() => void gonder()}>{busy ? 'Gönderiliyor…' : 'Gönder'}</button>
      </div>
    </div>
    {error && <p className="settings-status warn" role="alert">Hata: {error}</p>}
    {sonTurlar.length > 0 && <>
      <p className="hint" style={{ margin: '8px 0 4px' }}><b>Son turlar</b> — kaynak · model · süre · uzunluk</p>
      <ul className="local-model-list" aria-label="Son sohbet turları">
        {sonTurlar.map((t) => <li key={t.id}><b>{t.label}</b> · {t.model} · {(t.ms / 1000).toFixed(1)} sn · {t.chars} karakter{t.gpu ? ` · VRAM ${t.gpu}` : ''}</li>)}
      </ul>
    </>}
    {logSatirlari.length > 0 && <>
      <p className="hint" style={{ margin: '8px 0 4px' }}><b>Ajan Günlüğü</b> (sohbet satırları)</p>
      <ul className="local-model-list" aria-label="Ajan günlüğü sohbet satırları">
        {logSatirlari.map((s, i) => <li key={`${i}-${s}`} className="mono" style={{ fontFamily: 'var(--font-mono, monospace)' }}>{s}</li>)}
      </ul>
    </>}
  </fieldset>
}
