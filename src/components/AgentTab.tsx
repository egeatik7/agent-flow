import { screenCheckMode, type AppSettings } from '../types'

/** Ordinary agent settings. Developer tools are available only via the test CLI. */
export default function AgentTab({ settings, onSaveSettings }: {
  settings: AppSettings
  onSaveSettings: (partial: Partial<AppSettings>) => void
}) {
  return (
    <div>
      <p className="hint">Akışın eylemlerinden sonra ekranın nasıl değerlendirileceğini seç.</p>
      <div className="field">
        <label>Ekran doğrulaması</label>
        <select
          className="xp-input"
          value={screenCheckMode(settings)}
          onChange={(e) => onSaveSettings({ screenCheck: e.target.value as 'off' | 'log' | 'on' })}
        >
          <option value="off">Kapalı — eylemden sonra ekrana bakılmaz</option>
          <option value="log">Yalnızca günlük — kaydeder, adımı hata saymaz, model çağırmaz</option>
          <option value="on">Açık — gerekirse yakından bakar ve plan sorar</option>
        </select>
        <p className="hint">Varsayılan yalnızca günlük. Bu ayar, inisiyatifin ayrı bir modelle bitiş kontrolü yapmasını sağlamaz.</p>
      </div>
    </div>
  )
}
