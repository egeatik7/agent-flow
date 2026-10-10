import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { NODE_SPECS, type AgentGraph, type AppSettings, type ModelInfo } from '../types'
import { DEFAULT_RECOVERY_INSTRUCTIONS, recoverySettings, type RecoverySettings } from '../../electron/recovery-settings'
import { walkGraph } from '../../electron/tool-context'
import ModelChain from './ModelChain'
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
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const removedIds = useRef(new Set<string>())
  const update = (patch: Partial<RecoverySettings>) => setSettings(prev => ({ ...prev, recovery: { ...recoverySettings(prev.recovery), ...patch } }))
  const refresh = async () => {
    try { const snapshot = await window.xpAgent?.recoveryReports?.() ?? []; setReports(snapshot.filter(r => !removedIds.current.has(r.id))); setReportError('') }
    catch { setReportError('Raporlar okunamadı.') }
  }
  useEffect(() => {
    const off = window.xpAgent?.onRecoveryReportsRemoved?.(ids => {
      ids.forEach(id => removedIds.current.add(id))
      setReports(prev => prev.filter(report => !removedIds.current.has(report.id)))
    })
    void refresh()
    return () => off?.()
  }, [])
  const clear = async () => {
    if (clearing || !window.xpAgent?.clearRecoveryReports) return
    setClearing(true); setReportError('')
    try {
      if (!await window.xpAgent.clearRecoveryReports()) throw new Error('Silinemedi')
      setConfirmClear(false)
      await refresh()
    } catch { setReportError('Raporlar temizlenemedi. Tekrar deneyebilirsin.') }
    finally { setClearing(false) }
  }
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
    <div className="field"><label htmlFor="recovery-api-key">Kurtarma ajanı OpenRouter API Key</label>
      <div className="save-row">
        <input id="recovery-api-key" className="xp-input" type="password" value={settings.recovery?.apiKey ?? ''} placeholder="sk-or-v1-..." onChange={e => update({ apiKey: e.target.value })} />
        <button type="button" className="xp-btn save" onClick={() => onSave({ recovery: s })}>Kaydet</button>
      </div>
      <p className="hint">Genel sekmeden bağımsızdır. Kurtarma ajanı yalnız burada kaydettiğin anahtarı kullanır.</p>
    </div>
    <div className="field"><label htmlFor="recovery-model">Kurtarma modelleri (OpenRouter)</label>
      <ModelChain primary={settings.recovery?.model ?? s.model} backups={settings.recovery?.backups ?? []}
        inputId="recovery-model" listId="recovery-models" placeholder="Sağlayıcı/model kimliği"
        onChange={(model, backups) => update({ model, backups })} />
      <datalist id="recovery-models">{models.map(m => <option key={m.id} value={m.id} label={m.vision ? 'görsel destekli' : undefined} />)}</datalist>
      <button type="button" className="xp-btn" onClick={onLoadModels}>Model listesini getir</button>
      <p className="hint">Model alanına yazarak listede ara. İlk satır ana modeldir; sonraki satırlar sırayla denenen yedeklerdir (en fazla 4). Ekran görüntüsü ve araç çağırma desteği olan modeller seç.</p>
      {vision === false && <p className="hint">Bu model görsel desteklemiyor. Ekranı görebilen bir model seçmelisin.</p>}
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
      {window.xpAgent?.clearRecoveryReports && <div className="recovery-note-actions">
        {confirmClear ? <>
          <p>Tüm kurtarma raporları kalıcı olarak silinsin mi? Tuval ve node'lar korunur.</p>
          <button type="button" className="xp-btn" disabled={clearing} onClick={() => void clear()}>Evet, tümünü sil</button>
          <button type="button" className="xp-btn" disabled={clearing} onClick={() => setConfirmClear(false)}>Vazgeç</button>
        </> : <button type="button" className="xp-btn" disabled={!reports.length} onClick={() => setConfirmClear(true)}>Tüm raporları temizle</button>}
      </div>}
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
