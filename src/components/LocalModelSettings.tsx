import { useState, type Dispatch, type SetStateAction } from 'react'
import type { AppSettings, ModelInfo } from '../types'

import NumberDraft from './NumberDraft'
import LocalChat from './LocalChat'

const PRESETS = [
  { title: 'llama.cpp', url: 'http://127.0.0.1:8080/v1' },
  { title: 'Ollama', url: 'http://127.0.0.1:11434/v1' },
  { title: 'LM Studio', url: 'http://127.0.0.1:1234/v1' },
]

export default function LocalModelSettings({ settings: s, setSettings, onSave, onLoad, onBeforeChat, models, disabled }: {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  onSave: (patch: Partial<AppSettings>) => void
  onLoad?: () => Promise<ModelInfo[]>
  onBeforeChat?: () => Promise<boolean>
  models: ModelInfo[]
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [failed, setFailed] = useState(false)
  const set = (patch: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...patch }))
    setStatus('')
  }
  const load = async () => {
    if (!onLoad || busy) return
    setBusy(true); setFailed(false); setStatus('Sunucuya bağlanılıyor…')
    try {
      const list = await onLoad()
      setStatus(list.length ? `${list.length} yerel model bulundu. Genel sekmesindeki model listelerine ekleyebilirsin.` : 'Sunucu yanıt verdi, ancak model listesi boş. Sunucuda bir model yükle.')
    } catch (e) { setFailed(true); setStatus(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const local = models.filter(m => m.id.startsWith('local:'))
  return <fieldset className="panel-fields" disabled={disabled}>
    <div className="settings-grid local-settings">
      <p className="hint">Bilgisayarında çalışan llama.cpp, Ollama veya LM Studio sunucusuna bağlan. Modelleri Genel sekmesinde bulut modelleriyle aynı listede sıralayabilirsin.</p>
      <fieldset className="xp-group"><legend>Sunucu bağlantısı</legend>
        <div className="field"><label htmlFor="local-preset">Sunucu türü</label>
          <select id="local-preset" className="xp-select" value={PRESETS.some(p => p.url === s.localBaseUrl?.trim()) ? s.localBaseUrl?.trim() : ''} onChange={e => e.target.value && set({ localBaseUrl: e.target.value })}>
            <option value="">Özel adres</option>
            {PRESETS.map(p => <option key={p.url} value={p.url}>{p.title}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="local-address">Sunucu adresi</label>
          <input id="local-address" className="xp-input mono" value={s.localBaseUrl ?? ''} placeholder="http://127.0.0.1:8080/v1" onChange={e => set({ localBaseUrl: e.target.value })} />
        </div>
        <div className="settings-actions">
          <button type="button" className="xp-btn primary" disabled={busy || !s.localBaseUrl?.trim() || !onLoad} onClick={() => void load()}>{busy ? 'Bağlanılıyor…' : 'Bağlan ve modelleri getir'}</button>
        </div>
        {status && <p className={`settings-status ${failed ? 'warn' : ''}`} role="status">{status}</p>}
        {local.length > 0 && <ul className="local-model-list" aria-label="Yerel modeller">{local.map(m => <li key={m.id}><b>{m.id.slice(6)}</b><small>{s.localVision || m.vision ? 'Görsel kullanım açık' : 'Metin modeli'}</small></li>)}</ul>}
      </fieldset>
      <fieldset className="xp-group"><legend>Kullanım</legend>
        <label className="check"><input type="checkbox" checked={s.localOff !== true} onChange={e => set({ localOff: !e.target.checked })} /> Yerel modelleri kullan</label>
        <p className="hint">Kapalıyken listelerdeki yerel modeller atlanır; varsa sıradaki bulut modeli denenir. Adres ve model sıralaması korunur.</p>
        <label className="check"><input type="checkbox" checked={s.localVision === true} onChange={e => set({ localVision: e.target.checked })} /> Yüklediğim yerel model görüntü destekliyor</label>
        <p className="hint">Görsel model kullanıyorsan sunucuda görüntü desteğini de aç. Bu işaret sunucuya görüntü desteği eklemez.</p>
        <div className="field"><label htmlFor="local-think">Düşünme modu</label>
          <select id="local-think" className="xp-select" value={s.localThink ?? ''} onChange={e => set({ localThink: e.target.value })}>
            <option value="">Otomatik (Ollama'da kapalı)</option>
            <option value="none">Kapalı — en hızlı</option>
            <option value="low">Açık — düşük</option>
            <option value="medium">Açık — orta</option>
            <option value="high">Açık — yüksek</option>
          </select>
        </div>
        <p className="hint">Düşünme açıkken model cevabı yazmadan önce uzun bir düşünme metni üretir: Ollama'da ölçüm kapalıyken <b>0,1 sn</b>, açıkken <b>1,4 sn</b> ve kısa yanıt bütçesi düşünmeye gidip cevap boş kalabiliyor. Seviyeler (düşük/orta/yüksek) yalnız seviyeli modellerde (örn. gpt-oss) anlam taşır; diğerlerinde "açık" gibi davranır.</p>
        <div className="field"><label htmlFor="local-timeout">Yanıt için bekleme süresi (saniye)</label>
          <NumberDraft id="local-timeout" min={10} max={900} value={Math.round((s.localTimeoutMs ?? 180_000) / 1000)} onCommit={value => set({ localTimeoutMs: value * 1000 })} />
        </div>
      </fieldset>
      <button type="button" className="xp-btn save block" onClick={() => onSave({ localBaseUrl: (s.localBaseUrl ?? '').trim(), localTimeoutMs: s.localTimeoutMs ?? 180_000, localVision: s.localVision === true, localOff: s.localOff === true, localThink: s.localThink ?? '' })}>Yerel ayarları kaydet</button>
      <p className="hint">Kurtarma ajanı kendi OpenRouter bağlantısını kullanmaya devam eder.</p>
      {/* "Yerel model mi, API mi cevap veriyor" sorusunu canlı denemeyle yanıtlar. */}
      <LocalChat settings={s} models={models} disabled={disabled} onBeforeSend={onBeforeChat} />
    </div>
  </fieldset>
}
