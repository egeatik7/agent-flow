import { useEffect, useState } from 'react'
import type { AgentGraph, XpAgentApi } from '../types'
import { fileSetup, fileSetupKey, type FileLibraryInfo, type FileSelection, type FileRunContext } from '../../electron/file-contract'
import FilesPanel from './FilesPanel'
import '../styles/files.css'

export default function RunFilesDialog(p: { api: XpAgentApi; graph: AgentGraph; resume: boolean; onAnswer: (context: FileRunContext | null) => void }) {
  const setup = fileSetup(p.graph)!
  const [info, setInfo] = useState<FileLibraryInfo>({ root: '', folders: [], tools: '' })
  const [selection, setSelection] = useState<FileSelection>({ inputId: '', outputId: '', newOutput: true, tools: '' })
  const [last, setLast] = useState<FileRunContext>(), [picker, setPicker] = useState<'inputId' | 'outputId' | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [count, setCount] = useState<number>()
  useEffect(() => { let live = true; void Promise.all([p.api.fileInfo!(), p.api.fileDefaults!(p.graph)]).then(([i, d]) => { if (!live) return; setInfo(i); setSelection({ ...(d.selection ?? selection), tools: i.tools || d.selection?.tools || '' }); setLast(d.last?.setup === fileSetupKey(setup) ? d.last : undefined); setLoaded(true) }).catch(e => { if (live) setError(String(e)) }); return () => { live = false } }, [])
  useEffect(() => { let live = true; setCount(undefined); const f = info.folders.find(f => f.id === selection.inputId); if (f) void p.api.listFileSource?.(f.path, { kind: 'files', filter: setup.inputFilter }).then(rows => { if (live) setCount(rows.length) }).catch(e => { if (live) setError(String(e)) }); return () => { live = false } }, [selection.inputId, info])
  const start = async () => { setBusy(true); setError(''); try { p.onAnswer(await p.api.prepareFiles!(p.graph, selection)) } catch (e) { setError(String(e)); setBusy(false) } }
  return <div className="modal-backdrop files-backdrop"><section className="xp-dialog run-files-dialog" role="dialog" aria-modal="true" aria-label="Çalışmanın dosyaları" onKeyDown={e => { if (e.key === 'Escape' && !busy && !picker) p.onAnswer(null) }}>
    <div className="titlebar dialog-title"><h1>Çalışmanın dosyaları</h1><button className="title-btn close" disabled={busy} onClick={() => p.onAnswer(null)}>✕</button></div>
    <div className="run-files-body">
      {p.resume && last && <div className="run-files-last"><b>Önceki çalışmadan devam et</b><p className="files-path">Giriş: {last.input}<br />Çıkış: {last.output}</p><button className="xp-btn primary" disabled={busy} onClick={() => p.onAnswer(last)}>Aynı klasörlerle devam et</button><p className="hint">Aşağıdan yeni klasör seçmek yeni bir çalışma oluşturur.</p></div>}
      <label className="field">{setup.inputLabel}<div className="files-tools"><select className="xp-input" value={selection.inputId} onChange={e => { setSelection({ ...selection, inputId: e.target.value }); setError('') }}><option value="">Klasör seç…</option>{info.folders.filter(f => f.role !== 'work').map(f => <option key={f.id} value={f.id}>{f.name}{f.available === false ? ' (bulunamadı)' : ''}</option>)}</select><button className="xp-btn" disabled={busy} onClick={() => setPicker('inputId')}>Dosyalardan seç…</button></div></label>
      <p className="hint">{count === undefined ? setup.inputFilter : `${count} uygun dosya · ${setup.inputFilter}`}</p>
      <label className="field">{setup.outputLabel}<div className="files-tools"><select className="xp-input" value={selection.outputId || ''} onChange={e => setSelection({ ...selection, outputId: e.target.value })}><option value="">Nubbo yeni çıktı klasörü oluştursun</option>{info.folders.filter(f => f.role !== 'work').map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select><button className="xp-btn" disabled={busy} onClick={() => setPicker('outputId')}>Dosyalardan seç…</button></div></label>
      <label className="check"><input type="checkbox" checked={selection.newOutput || !selection.outputId} disabled={!selection.outputId} onChange={e => setSelection({ ...selection, newOutput: e.target.checked })} />Bu çalışma için ayrı bir çıktı alt klasörü oluştur</label>
      {setup.tools && <details open={!selection.tools}><summary>Nubbo Tools</summary><div className="files-tools"><input className="xp-input" aria-label="Nubbo Tools yolu" value={selection.tools} onChange={e => setSelection({ ...selection, tools: e.target.value })} placeholder="EXE’lerin bulunduğu klasör" /><button className="xp-btn" disabled={busy} onClick={async () => { try { const i = await p.api.fileAction!({ kind: 'tools' }); setInfo(i); setSelection(s => ({ ...s, tools: i.tools })) } catch (e) { setError(String(e)) } }}>Seç…</button></div></details>}
      <p className="hint">Ara klasörler Nubbo tarafından hazırlanır. Giriş dosyaları hazırlık klasörüne kopyalanır; isimlendirme kopyada yapılır.</p>
      {error && <p className="files-error" role="alert">{error}</p>}
    </div>
    <div className="xp-confirm-buttons"><button className="xp-btn primary" disabled={busy || !loaded || !selection.inputId || count === 0 || setup.tools && !selection.tools} onClick={() => void start()}>{busy ? 'Klasörler hazırlanıyor…' : p.resume ? 'Yeni çalışmayla seçiliden başlat' : 'Başlat'}</button><button className="xp-btn" disabled={busy} onClick={() => p.onAnswer(null)}>İptal</button></div>
    {picker && <FilesPanel api={p.api} onClose={() => setPicker(null)} onChanged={setInfo} onSelect={f => { setSelection(s => ({ ...s, [picker]: f.id })); setPicker(null) }} />}
  </section></div>
}
