import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CheckpointDetail, CheckpointInfo, CheckpointMonitoring } from '../../electron/checkpoint-types'
import type { XpAgentApi } from '../types'
import '../styles/checkpoints.css'

type Props = { api?: XpAgentApi; running: boolean; busy: boolean; onClose: () => void; onRun: (checkpoint: CheckpointInfo) => Promise<void> }
const when = (at: number) => new Date(at).toLocaleString('tr-TR')
const statuses = { running: 'Sürüyor', closed: 'Aralık kapandı', completed: 'Koşu tamamlandı', stopped: 'Durduruldu', failed: 'Hata', interrupted: 'Kesildi' }
export default function CheckpointsPanel({ api, running, busy, onClose, onRun }: Props) {
  const [rows, setRows] = useState<CheckpointInfo[]>([])
  const [monitoring, setMonitoring] = useState<CheckpointMonitoring>({ automatic: true, active: false, roots: [], issues: [], flowRoots: [], pendingRoots: [], wideWatch: false, source: 'yok', skippedPaths: 0 })
  const [selected, setSelected] = useState('')
  const [detail, setDetail] = useState<CheckpointDetail>()
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const [wideBusy, setWideBusy] = useState(false)
  const panel = useRef<HTMLElement>(null)
  const selection = useRef('')
  useEffect(() => {
    let alive = true, pending = false
    const update = async () => {
      if (pending) return
      pending = true
      try {
        if (!api?.listCheckpoints) return
        const [list, state] = await Promise.all([api.listCheckpoints(), api.checkpointMonitoring?.()])
        if (!alive) return
        setRows(list); if (state) setMonitoring(state)
        const id = selection.current
        if (id && api.checkpointDetail) { const next = await api.checkpointDetail(id); if (alive && id === selection.current) setDetail(next) }
      } catch (e) { if (alive) setError(String(e)) }
      finally { pending = false }
    }
    void update()
    const timer = setInterval(() => void update(), 2000)
    return () => { alive = false; clearInterval(timer) }
  }, [api])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    return () => previous?.focus()
  }, [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !working) { event.preventDefault(); event.stopPropagation(); onClose() }
      if (event.key === 'Tab') {
        const targets = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        const first = targets[0], last = targets[targets.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus() }
      } }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose, working])
  const select = async (id: string) => {
    selection.current = id; setSelected(id); setDetail(undefined); setError('')
    try { const next = await api?.checkpointDetail?.(id); if (selection.current === id) setDetail(next) }
    catch (e) { if (selection.current === id) setError(String(e)) }
  }
  const action = async (fn: () => Promise<void>) => {
    if (working) return
    setWorking(true); setError('')
    try { await fn() } catch (e) { setError(String(e)) } finally { setWorking(false) }
  }
  /** Tüm disk izleme opt-in: varsayılan kapalı, açıkken başka programların dosyaları da listelenir. */
  const toggleWide = async (on: boolean) => {
    if (!api?.setCheckpointWideWatch || wideBusy) return
    setWideBusy(true); setError('')
    try { setMonitoring(await api.setCheckpointWideWatch(on)) }
    catch (e) { setError(String(e)) }
    finally { setWideBusy(false) }
  }
  const akisKokleri = monitoring.flowRoots ?? []
  const bekleyen = monitoring.pendingRoots ?? []
  return createPortal(<div className="checkpoint-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !working) onClose() }}>
    <section ref={panel} tabIndex={-1} className="checkpoint-window" role="dialog" aria-modal="true" aria-labelledby="checkpoint-title">
      <header><strong id="checkpoint-title">Checkpoint’ler ve çıktılar</strong><button className="xp-btn" disabled={working} onClick={onClose} aria-label="Kapat">×</button></header>
      <div className="checkpoint-config">
        <b>Çıktı takibi</b>
        <p>{monitoring.roots.length
          ? `İzlenen klasörler: ${monitoring.roots.join(' · ')}`
          : 'Çalıştırma başladığında AKIŞTA yazılı klasörler izlenir; klasör seçmen gerekmez.'}</p>
        {bekleyen.length > 0 && <p><small>Henüz oluşmadı, oluşunca izlenecek: {bekleyen.join(' · ')}</small></p>}
        {akisKokleri.length > 0 && <p><small>Akıştan gelen {akisKokleri.length} klasör esas alınır.</small></p>}
        <label className="checkpoint-wide">
          <input type="checkbox" checked={monitoring.wideWatch === true} disabled={wideBusy || !api?.setCheckpointWideWatch} onChange={e => void toggleWide(e.target.checked)} />
          {' '}Tüm diskleri de izle {monitoring.wideWatch ? '(açık)' : '(kapalı)'}
        </label>
        <small>{monitoring.wideWatch
          ? 'Tüm disk izleme AÇIK: başka programların dosya hareketleri de listeye girer ve disk yükü artar.'
          : 'Yalnız akışta yazılı klasörler izlenir (döngünün klasörü, öğe yolları, yazı alanlarındaki yollar). Tüm diskleri izlemek için yukarıdaki kutuyu işaretle.'}
          {' '}Nubbo’nun kendi kayıtları ve sistem/kurulum klasörleri her durumda hariçtir.</small>
        {(monitoring.skippedPaths ?? 0) > 0 && <small>{monitoring.skippedPaths} yol kullanılamadığı için atlandı (göreli yol veya sistem klasörü).</small>}
        {monitoring.issues.map((issue, i) => <p key={i} className="checkpoint-error">{issue}</p>)}
      </div>
      {!api?.listCheckpoints && <p className="checkpoint-error">Checkpoint kaydı masaüstü uygulamasında kullanılabilir.</p>}
      {error && <p className="checkpoint-error" role="alert">{error}</p>}
      <div className="checkpoint-columns">
        <nav aria-label="Checkpoint sırası">
          {!rows.length && <p>Henüz checkpoint yok. Tuval başlangıçları ve döngü turları çalışırken kaydedilir.</p>}
          {rows.map((cp, index) => <button key={cp.id} className={`checkpoint-row ${selected === cp.id ? 'selected' : ''}`} onClick={() => void select(cp.id)}>
            <b>{index + 1}. {cp.canvasName}</b><span>{cp.label}</span><small>{when(cp.at)} · {statuses[cp.status]} · {cp.outputCount} çıktı/değişiklik</small>
            {cp.parentId && <small>Önceki checkpoint’ten yeniden çalıştırma</small>}
          </button>)}
        </nav>
        <main>
          {!detail ? <p>{selected ? 'Çıktılar yükleniyor…' : 'Çıktılarını görmek için soldan bir checkpoint seç.'}</p> : <>
            <h3>{detail.canvasName} · {detail.label}</h3>
            <p>{when(detail.at)} → {detail.endedAt ? when(detail.endedAt) : statuses[detail.status]}</p>
            <p>Bu checkpoint ile sonraki checkpoint arasındaki çıktılar. Son checkpoint, koşunun sonuna kadar olan değişiklikleri gösterir. Dosyaların eski sürümleri saklanmaz; Aç düğmesi mevcut dosyayı açar.</p>
            {detail.issues.map((issue, i) => <p key={i} className="checkpoint-error">{issue}</p>)}
            {!detail.outputs.length ? <p>Bu aralıkta gözlenen çıktı yok.</p> : <ul className="checkpoint-outputs">{detail.outputs.map(o => <li key={o.path}>
              <b>{o.kind === 'folder' ? 'Klasör' : o.kind === 'unknown' ? 'Yol' : 'Dosya'} · {o.change === 'created' ? 'Yeni' : o.change === 'modified' ? 'Değişti' : o.change === 'observed' ? 'Dosya hareketi' : 'Kaldırıldı'}{o.present === false ? ' · Artık bu yolda yok' : ''}</b>
              <span title={o.path}>{o.path}</span>
              <div><button className="xp-btn" disabled={!o.present || working} onClick={() => void action(async () => { if (!await api?.openPath?.(o.path)) throw new Error('Çıktı açılamadı.') })}>Aç</button><button className="xp-btn" disabled={!o.present || working} onClick={() => void action(async () => { if (!await api?.showInFolder?.(o.path)) throw new Error('Klasör açılamadı.') })}>Klasörde göster</button></div>
            </li>)}</ul>}
          </>}
        </main>
      </div>
      <footer><span>Dosyaları kendin temizledikten sonra başlat. Mevcut taslak solda ayrı bir sekmede korunur; checkpoint kendi tuvaline yüklenir ve bitince sağdaki tuvaller sürer. Uygulama ekranları geri alınmaz.</span><button className="xp-btn primary" disabled={!detail || running || busy || working || !api?.checkpointSnapshot} onClick={() => void action(async () => { if (detail) await onRun(detail) })}>Seçiliden çalıştır</button><button className="xp-btn" disabled={working} onClick={onClose}>Kapat</button></footer>
    </section>
  </div>, document.body)
}
