import { useEffect, useRef, useState } from 'react'
import type { XpAgentApi } from '../types'
import type { FileLibraryInfo, FileEntry, FileFolder } from '../../electron/file-contract'
import '../styles/files.css'

export default function FilesPanel(p: { api: XpAgentApi; onClose: () => void; onSelect?: (folder: FileFolder) => void; onChanged?: (info: FileLibraryInfo) => void }) {
  const [info, setInfo] = useState<FileLibraryInfo>({ root: '', folders: [], tools: '' })
  const [id, setId] = useState(''), [relative, setRelative] = useState(''), [entries, setEntries] = useState<FileEntry[]>([])
  const [group, setGroup] = useState<'folders' | 'output' | 'work'>('folders')
  const [name, setName] = useState(''), [query, setQuery] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const serial = useRef(0)
  const current = info.folders.find(f => f.id === id)
  const adopt = (next: FileLibraryInfo) => { setInfo(next); p.onChanged?.(next) }
  const load = async () => { if (p.api.fileInfo) adopt(await p.api.fileInfo()) }
  useEffect(() => { let live = true; void p.api.fileInfo?.().then(x => { if (live) adopt(x) }).catch(e => { if (live) setError(String(e)) }); return () => { live = false; serial.current++ } }, [])
  useEffect(() => {
    const n = ++serial.current
    setEntries([])
    if (id) void p.api.fileBrowse?.(id, relative).then(x => { if (n === serial.current) setEntries(x.entries) }).catch(e => { if (n === serial.current) setError(String(e)) })
  }, [id, relative, info])
  const action = async (kind: 'create' | 'link' | 'import' | 'rename' | 'forget' | 'tools' | 'root', paths?: string[], parent?: string) => {
    if (busy || !p.api.fileAction) return
    setBusy(true); setError('')
    try {
      const next = await p.api.fileAction({ kind, id: parent ?? (['rename', 'forget', 'import'].includes(kind) ? id : undefined), name, paths, ...((parent || kind === 'import') ? { relative } : {}) })
      adopt(next)
      if (kind === 'create' || kind === 'link') { const added = next.folders.find(f => !info.folders.some(old => old.id === f.id)); if (added) { setId(added.id); setRelative('') } }
      if (kind === 'forget') { setId(''); setRelative('') }
      setName('')
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  const choose = async () => {
    if (!current || !p.onSelect) return
    if (!relative) { p.onSelect(current); return }
    setBusy(true); setError('')
    try {
      const separator = current.path.includes('\\') ? '\\' : '/'
      const target = [current.path.replace(/[\\/]+$/, ''), relative.split(/[\\/]/).join(separator)].join(separator)
      const next = await p.api.fileAction!({ kind: 'link', paths: [target] }); adopt(next)
      const folder = next.folders.find(f => f.path.toLowerCase() === target.toLowerCase())
      if (!folder) throw new Error('Alt klasör bağlanamadı.')
      p.onSelect(folder)
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <div className="modal-backdrop files-backdrop"><section className="xp-dialog files-dialog" role="dialog" aria-modal="true" aria-label="Nubbo Dosyalar" onKeyDown={e => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); p.onClose() } }}>
    <div className="titlebar dialog-title"><h1>Nubbo Dosyalar</h1><button type="button" className="title-btn close" disabled={busy} onClick={p.onClose}>✕</button></div>
    <div className="files-tools"><input className="xp-input" aria-label="Yeni klasör veya yeni ad" value={name} onChange={e => setName(e.target.value)} placeholder="Klasör adı" />
      <button className="xp-btn" disabled={busy || !name.trim()} onClick={() => void action('create')}>Yeni klasör</button>
      <button className="xp-btn" disabled={busy || !id || !name.trim()} onClick={() => void action('create', undefined, id)}>Alt klasör</button>
      <button className="xp-btn" disabled={busy} onClick={() => void action('link')}>PC klasörünü bağla</button>
      <button className="xp-btn" disabled={busy} onClick={() => void load().catch(e => setError(String(e)))}>Yenile</button>
    </div>
    <div className="files-tools"><button className="xp-btn" onClick={() => setGroup('folders')}>Klasörler</button><button className="xp-btn" onClick={() => setGroup('output')}>Çıktılar</button><button className="xp-btn" onClick={() => setGroup('work')}>Çalışmalar</button></div>
    <div className="files-layout"><div className="files-folders" role="listbox" aria-label="Klasörler">{info.folders.filter(f => group === 'folders' ? f.role !== 'work' : f.role === group).map(f => <button type="button" role="option" aria-selected={id === f.id} className={id === f.id ? 'selected' : ''} key={f.id} disabled={busy} title={f.path} onClick={() => { setId(f.id); setRelative(''); setError('') }}><b>📁 {f.name}</b><small>{f.kind === 'linked' ? 'PC’ye bağlı' : 'Nubbo klasörü'}{f.available === false ? ' · bulunamadı' : ''}</small></button>)}{!info.folders.length && <p>Yeni klasör oluştur veya PC’den bir klasör bağla.</p>}</div>
      <div className="files-content" onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }} onDrop={e => { e.preventDefault(); if (!id || busy) return; const paths = Array.from(e.dataTransfer.files).map(f => p.api.fileDropPath?.(f) ?? '').filter(Boolean); if (paths.length) void action('import', paths) }}>
        <div className="files-tools"><b>{current?.name ?? 'Klasör seç'}{relative ? ` / ${relative}` : ''}</b>{relative && <button className="xp-btn" onClick={() => setRelative(relative.split(/[\\/]/).slice(0, -1).join('/'))}>Üst klasör</button>}</div>
        <input className="xp-input" aria-label="Dosyalarda ara" value={query} onChange={e => setQuery(e.target.value)} placeholder="Dosya adında ara…" />
        <div className="files-entries">{entries.filter(e => e.name.toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr'))).slice(0, 500).map(e => <button type="button" className="files-entry" key={e.path} onDoubleClick={() => e.kind === 'folder' ? setRelative(relative ? `${relative}/${e.name}` : e.name) : void p.api.openPath?.(e.path)} title={e.path}><span>{e.kind === 'folder' ? '📁' : '📄'} {e.name}</span><small>{e.kind === 'folder' ? 'Klasör' : `${Math.ceil(e.size / 1024)} KB`}</small></button>)}</div>
        <p className="hint">{entries.length} öğe{entries.length > 500 ? ' · arayarak daralt (ilk 500 gösteriliyor)' : ''}. Çift tıkla aç. Dosyaları buraya bırakarak bu klasöre kopyala.</p>
        {current && <details><summary>Gerçek Windows yolu</summary><p className="mono files-path">{current.path}</p><button className="xp-btn" onClick={() => void p.api.openPath?.(current.path)}>Windows’ta aç</button><button className="xp-btn" onClick={() => void navigator.clipboard.writeText(current.path).catch(e => setError(String(e)))}>Yolu kopyala</button></details>}
      </div></div>
    <div className="files-tools"><button className="xp-btn" disabled={busy || !id} onClick={() => void action('import')}>Dosya ekle (kopyala)</button><button className="xp-btn" disabled={busy || !id || !name.trim()} onClick={() => void action('rename')}>Görünen adı değiştir</button><button className="xp-btn" disabled={busy || !id} onClick={() => void action('forget')}>Listeden kaldır</button><span className="hint">Listeden kaldırmak dosyaları silmez.</span></div>
    <details className="files-settings"><summary>Konumlar ve araçlar</summary><p className="files-path">Dosya kökü: {info.root}</p><p className="files-path">Nubbo Tools: {info.tools || 'Seçilmedi'}</p><button className="xp-btn" disabled={busy} onClick={() => void action('tools')}>Tools klasörünü seç</button><button className="xp-btn" disabled={busy} onClick={() => void action('root')}>Dosya kökünü değiştir</button><p className="hint">Kök değiştirmek mevcut dosyaları taşımaz. Önceki kökü seçerek geri dönebilirsin.</p></details>
    {error && <p className="files-error" role="alert">{error}</p>}
    <div className="xp-confirm-buttons">{p.onSelect && <button className="xp-btn primary" disabled={!current || busy} onClick={() => void choose()}>Bu klasörü seç</button>}<button className="xp-btn" disabled={busy} onClick={p.onClose}>{busy ? 'İşleniyor…' : 'Kapat'}</button></div>
  </section></div>
}
