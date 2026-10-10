import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { NODE_SPECS, type AgentGraph, type AppSettings, type ModelInfo } from '../types'
import { DEFAULT_RECOVERY_INSTRUCTIONS, recoverySettings, type RecoverySettings } from '../../electron/recovery-settings'
import { walkGraph } from '../../electron/tool-context'
import type { RecoveryReport } from '../../electron/recovery'

export default function RecoverySettingsPanel({ settings, setSettings, onSave, graph, models, onLoadModels, disabled }: {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  onSave: (partial: Partial<AppSettings>) => void
  graph: AgentGraph
  models: ModelInfo[]
  onLoadModels: () => void
  disabled?: boolean
}) {
  const s = recoverySettings(settings.recovery)
  const [reports, setReports] = useState<RecoveryReport[]>([])
  const [reportError, setReportError] = useState('')
  const update = (patch: Partial<RecoverySettings>) => setSettings(prev => ({ ...prev, recovery: { ...recoverySettings(prev.recovery), ...patch } }))
  const refresh = async () => {
    try { setReports(await window.xpAgent?.recoveryReports?.() ?? []); setReportError('') }
    catch { setReportError('Raporlar okunamadı.') }
  }
  useEffect(() => { void refresh() }, [])
  const nodes: { id: string; title: string; kind: string; path: string }[] = []
  const titles = new Map<string, string>()
  walkGraph(graph, ({ node }) => titles.set(node.id, node.title))
  walkGraph(graph, ({ node, loops, packagePath }) => {
    if (['click', 'type', 'key', 'wait'].includes(node.kind)) nodes.push({ id: node.id, title: node.title,
      kind: NODE_SPECS[node.kind].label, path: [...packagePath.map(id => titles.get(id) ?? 'Paket'), ...loops.map(loop => loop.title)].join(' › ') })
  })
  const vision = models.find(m => m.id === s.model)?.vision
  return <div className="settings-grid recovery-settings">
    <fieldset className="recovery-edit" disabled={disabled}>
    <p className="hint">Akış bir eylemde hata verince bu model devreye girer. Tuvalin JSON'unu, mevcut öğeyi, günlükleri ve önceki kurtarma raporlarını okur; düzeltmeden sonra aynı yerden devam edilir.</p>
    <label className="check"><input type="checkbox" checked={s.enabled} onChange={e => update({ enabled: e.target.checked })} /> Hata olduğunda kurtarma ajanını kullan</label>
    <div className="field"><label htmlFor="recovery-model">Kurtarma modeli (OpenRouter)</label>
      <input id="recovery-model" className="xp-input" list="recovery-models" value={s.model} placeholder="Sağlayıcı/model kimliği" onChange={e => update({ model: e.target.value })} />
      <datalist id="recovery-models">{models.map(m => <option key={m.id} value={m.id}>{m.vision ? 'Görsel' : 'Metin'}</option>)}</datalist>
      <button type="button" className="xp-btn" onClick={onLoadModels}>Model listesini getir</button>
      <p className="hint">Genel ayarlardaki API anahtarını kullanır. Ekran görüntüsü ve araç çağırma desteği olan bir model seç.</p>
      {vision === false && <p className="hint">Bu model görsel desteklemiyor. Ekranı görebilen bir model seçmelisin.</p>}
    </div>
    <div className="field"><label htmlFor="recovery-backups">Yedek modeller (her satıra bir tane, en fazla 4)</label>
      <textarea id="recovery-backups" className="xp-input" rows={3} value={(settings.recovery?.backups ?? []).join('\n')} onChange={e => update({ backups: e.target.value.split('\n') })} />
    </div>
    <div className="field"><label htmlFor="recovery-task">Akışın amacı ve çalışma bilgileri</label>
      <textarea id="recovery-task" className="xp-input" rows={6} value={s.task} placeholder="Ne yapılmalı? Hangi uygulamalar, klasörler ve sonuçlar önemli? Tamamlanan hangi işlemler tekrarlanmamalı?" onChange={e => update({ task: e.target.value })} />
    </div>
    <div className="field"><label htmlFor="recovery-instructions">Kurtarma talimatı</label>
      <textarea id="recovery-instructions" className="xp-input" rows={8} value={s.instructions} onChange={e => update({ instructions: e.target.value })} />
      <button type="button" className="xp-btn" onClick={() => update({ instructions: DEFAULT_RECOVERY_INSTRUCTIONS })}>Varsayılan talimatı getir</button>
    </div>
    <fieldset><legend>Araç yetkileri</legend>
      <label className="check"><input type="checkbox" checked={s.allowDesktop} onChange={e => update({ allowDesktop: e.target.checked })} /> Tıkla, yaz, tuş gönder ve bekle</label>
      <label className="check"><input type="checkbox" checked={s.allowNodes} onChange={e => update({ allowNodes: e.target.checked })} /> Hata veren eylem node'unu tek adım olarak çağır</label>
      <p className="hint">İnisiyatif, Koşul, Paket ve Döngü çalıştırılamaz. JSON ve ekran okunabilir. Ajan node'ları düzenleyemez ve akışı baştan başlatamaz. Seçtiğin ek node'lar mevcut öğenin değişkenleriyle çalışır.</p>
      <details><summary>Çağırabileceği ek eylem node'ları ({s.allowedNodeIds.length})</summary>
        <div className="recovery-node-list">{nodes.length ? nodes.map(node => <label className="check" key={node.id} title={node.path}>
          <input type="checkbox" disabled={!s.allowNodes} checked={s.allowedNodeIds.includes(node.id)} onChange={e => update({ allowedNodeIds: e.target.checked ? [...s.allowedNodeIds, node.id] : s.allowedNodeIds.filter(id => id !== node.id) })} />
          <span>{node.title}<small>{node.kind}{node.path ? ` · ${node.path}` : ''}</small></span>
        </label>) : <p className="hint">Bu tuvalde eylem node'u yok.</p>}</div>
      </details>
    </fieldset>
    <div className="field-row recovery-limits">
      <label>Araç çağrısı sınırı<input className="xp-input" type="number" min={1} max={60} value={s.maxCalls} onChange={e => update({ maxCalls: Number(e.target.value) })} /></label>
      <label>Kurtarma süresi (sn)<input className="xp-input" type="number" min={10} max={900} value={s.timeoutMs / 1000} onChange={e => update({ timeoutMs: Number(e.target.value) * 1000 })} /></label>
      <label>Koşu başına kurtarma<input className="xp-input" type="number" min={1} max={100} value={s.maxRecoveries} onChange={e => update({ maxRecoveries: Number(e.target.value) })} /></label>
    </div>
    <button type="button" className="xp-btn save block" onClick={() => onSave({ recovery: s })}>Kurtarma Ayarlarını Kaydet</button>
    </fieldset>
    <fieldset><legend>Kurtarma raporları</legend>
      <div className="field-row"><button type="button" className="xp-btn" onClick={() => void refresh()}>Yenile</button><button type="button" className="xp-btn" onClick={() => void window.xpAgent?.openRecoveryReports?.()}>Rapor klasörünü aç</button></div>
      {reportError && <p>{reportError}</p>}
      {!reports.length && <p className="hint">Henüz kurtarma raporu yok.</p>}
      {reports.map(report => <details className="recovery-report" key={report.id}>
        <summary>{new Date(report.startedAt).toLocaleString('tr-TR')} · {report.nodeTitle}</summary>
        <p><b>Sonuç:</b> {report.resumed === true ? 'Node tamamlandı; akış devam etti.' : report.resumed === false ? 'Devam denemesi başarısız.' : report.result === 'stopped' ? 'Kullanıcı durdurdu.' : report.result === 'retry' ? 'Aynı node’da devam denendi.' : report.result === 'completed' ? 'Node tek adımda tamamlandı.' : 'Toparlanamadı.'}</p>
        {report.completionBasis === 'model-observed' && <p className="hint">Hedefin gerçekleştiğine ajan güncel ekranı görerek karar verdi; asıl node yeniden çalıştırılmadı.</p>}
        <p><b>Hata:</b> {report.error}</p>
        <p><b>Olası neden:</b> {report.probableCause || 'Belirlenemedi.'}</p>
        <p><b>Gözlem:</b> {report.evidence || 'Model kanıt belirtmedi.'}</p>
        <p>{report.summary}</p>
        {report.resumeError && <p>{report.resumeError}</p>}
        <ol>{report.actions.map((action, index) => <li key={index}><b>{action.tool}</b> · {action.message}</li>)}</ol>
      </details>)}
    </fieldset>
  </div>
}
