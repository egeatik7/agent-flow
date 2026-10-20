import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CheckpointDetail, CheckpointInfo, CheckpointMonitoring, CheckpointOutput } from '../../electron/checkpoint-types'
import type { XpAgentApi } from '../types'
import { checkpointTree, treeFind, treeTrail, treeAttention, treeOutputs, type CheckpointTreeNode } from '../lib/checkpoint-tree'
import '../styles/checkpoints.css'

type Props = { api?: XpAgentApi; running: boolean; busy: boolean; onClose: () => void; onRun: (checkpoint: CheckpointInfo) => Promise<void> }
const when = (at: number) => new Date(at).toLocaleString('tr-TR')
const statuses = { running: 'Sürüyor', closed: 'Aralık kapandı', completed: 'Koşu tamamlandı', stopped: 'Durduruldu', failed: 'Hata', interrupted: 'Kesildi' }
export default function CheckpointsPanel({ api, running, busy, onClose, onRun }: Props) {
  const [rows, setRows] = useState<CheckpointInfo[]>([])
  const [monitoring, setMonitoring] = useState<CheckpointMonitoring>({ automatic: true, active: false, roots: [], issues: [], flowRoots: [], pendingRoots: [], wideWatch: false, source: 'yok', skippedPaths: 0 })
  const [selected, setSelected] = useState('')
  const [outputs, setOutputs] = useState<CheckpointOutput[]>([])
  const [detailIssues, setDetailIssues] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [limits, setLimits] = useState<Record<string, number>>({})
  const [focusedPath, setFocusedPath] = useState<Set<string>>(new Set())
  const tree = useMemo(() => checkpointTree(rows), [rows])
  const chosen = treeFind(tree, selected)
  const initialized = useRef(false)
  const aliveRef = useRef(true)
  const requestSeq = useRef(0)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const [wideBusy, setWideBusy] = useState(false)
  // 100.000 satıra kadar çıktı tek listede render edilirse ~50 bin DOM düğümü modalı donduruyordu.
  const [outputLimit, setOutputLimit] = useState(300)
  const panel = useRef<HTMLElement>(null)
  const selection = useRef('')
  // KAPALI checkpoint ayrıntısı değişmez: her 2 sn'lik yenilemede 250 turun 250 dosyasını yeniden
  // okumak yerine önbellekten kullan; yalnız süren checkpoint tazelenir.
  const detailCache = useRef(new Map<string, CheckpointDetail>())
  const load = async (list: CheckpointInfo[], key: string) => {
    const seq = ++requestSeq.current
    const roots = checkpointTree(list), target = treeFind(roots, key)
    if (!target || !api?.checkpointDetail) return
    setLoading(true)
    const ids = [...target.checkpointIds]
    const statusById = new Map(list.map(row => [row.id, row.status]))
    const details = new Map<string, CheckpointDetail>()
    for (const id of ids) { const hit = detailCache.current.get(id); if (hit) details.set(id, hit) }
    const need = ids.filter(id => !details.has(id) || statusById.get(id) === 'running')
    const failures: string[] = []; let index = 0
    await Promise.all(Array.from({ length: Math.min(4, need.length) }, async () => {
      while (index < need.length) {
        const id = need[index++]
        try { const detail = await api.checkpointDetail!(id); detailCache.current.set(id, detail); details.set(id, detail) }
        catch (error) { failures.push(String(error)) }
        if (!aliveRef.current || selection.current !== key || requestSeq.current !== seq) return
      }
    }))
    if (!aliveRef.current || selection.current !== key || requestSeq.current !== seq) return
    const known = new Set(roots.find(n => n.runId === target.runId)?.lapKeys ?? [])
    const values = [...details.values()]
    setOutputs(treeOutputs(target, values, known)); setLoading(false)
    setDetailIssues([...new Set(values.flatMap(detail => detail.issues))])
    setError(failures.length ? `${failures.length} checkpoint okunamadı; gösterilen çıktı listesi eksik olabilir. ${failures[0]}` : '')
  }
  useEffect(() => {
    aliveRef.current = true
    let alive = true, pending = false
    const update = async () => {
      if (pending) return
      pending = true
      try {
        if (!api?.listCheckpoints) return
        const [list, state] = await Promise.all([api.listCheckpoints(), api.checkpointMonitoring?.()])
        if (!alive) return
        setRows(list); if (state) setMonitoring(state)
        if (!initialized.current) { initialized.current = true; setExpanded(new Set(checkpointTree(list).map(n => n.key))) }
        const id = selection.current
        if (id) await load(list, id)
      } catch (e) { if (alive) setError(String(e)) }
      finally { pending = false }
    }
    void update()
    const timer = setInterval(() => void update(), 2000)
    return () => { alive = false; aliveRef.current = false; requestSeq.current++; clearInterval(timer) }
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
  const select = async (key: string) => {
    selection.current = key; setSelected(key); setOutputs([]); setDetailIssues([]); setOutputLimit(300); setError('')
    await load(rows, key)
  }
  const toggle = (key: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next })
  const attention = treeAttention(tree)
  const focusAttention = () => {
    if (!attention) return
    setExpanded(previous => new Set([...previous, ...treeTrail(tree, attention.key)]))
    // Include the relevant off-page item without rendering every preceding sibling.
    setFocusedPath(new Set(treeTrail(tree, attention.key)))
    void select(attention.key)
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.checkpoint-row.selected')?.scrollIntoView?.({ block: 'nearest' }))
  }
  const lapStatuses = { running: 'Sürüyor', completed: 'Tur akışı tamamlandı', incomplete: 'Yarım kaldı', stopped: 'Durduruldu', failed: 'Hata', interrupted: 'Kesildi' }
  const renderTree = (nodes: CheckpointTreeNode[], parent = 'root'): React.ReactNode => {
    const limit = limits[parent] ?? 100
    const shown = nodes.slice(0, limit)
    for (const node of nodes.slice(limit)) if (focusedPath.has(node.key)) shown.push(node)
    return <ul className="checkpoint-tree">{shown.map(node => <li key={node.key}>
      <div className="checkpoint-tree-line">
        {node.children.length > 0 ? <button className="checkpoint-expand" aria-label={`${node.title} ${expanded.has(node.key) ? 'daralt' : 'genişlet'}`} aria-expanded={expanded.has(node.key)} onClick={() => toggle(node.key)}>{expanded.has(node.key) ? '−' : '+'}</button> : <span className="checkpoint-expand-space" />}
        <button className={`checkpoint-row ${selected === node.key ? 'selected' : ''}`} onClick={() => void select(node.key)}>
          <b>{node.title}</b>
          {node.subtitle && <small>{node.subtitle}</small>}
          <small>{node.lap ? `${lapStatuses[node.lap.status] ?? 'Durum bilinmiyor'} · ` : node.kind === 'run' ? `${statuses[node.runStatus ?? 'interrupted']} · ` : ''}{node.count} yol kaydı{node.kind === 'loop' ? ` · bu denemede ${node.children.filter(n => n.lap?.status === 'completed').length} tur tamamlandı · ${node.children[0]?.lap?.total ?? 0} öğeli döngü` : ''}</small>
          {node.kind === 'run' && rows.some(r => r.runId === node.runId && r.parentId) && <small>Önceki checkpoint’ten yeni deneme</small>}
        </button>
      </div>
      {expanded.has(node.key) && renderTree(node.children, node.key)}
    </li>)}{nodes.length > limit && <li><button className="xp-btn" onClick={() => setLimits(previous => ({ ...previous, [parent]: limit + 100 }))}>Sonraki 100 kaydı göster ({nodes.length - limit} kaldı)</button></li>}</ul>
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
      <details className="checkpoint-config"><summary>Çıktı takibi ve izleme ayrıntıları</summary>
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
      </details>
      {!api?.listCheckpoints && <p className="checkpoint-error">Checkpoint kaydı masaüstü uygulamasında kullanılabilir.</p>}
      {error && <p className="checkpoint-error" role="alert">{error}</p>}
      <div className="checkpoint-tree-toolbar"><span>Döngü → tur → iç döngü → çıktı</span><button className="xp-btn" disabled={!attention} onClick={focusAttention}>Çalışan / yarım kalan turu göster</button></div>
      <div className="checkpoint-columns">
        <nav aria-label="Döngüler ve checkpointler">
          {!rows.length && <p>Henüz checkpoint yok. Tuval başlangıçları ve döngü turları çalışırken kaydedilir.</p>}
          {renderTree(tree)}
        </nav>
        <main>
          {!chosen ? <p>Önce döngüyü aç; çıktıları görmek için ilgili turu seç. Dosyalar seçim yapılana kadar yüklenmez.</p> : <>
            <h3>{chosen.title}</h3>
            {chosen.lap && <p>{lapStatuses[chosen.lap.status]} · {when(chosen.lap.at)}{chosen.lap.endedAt ? ` → ${when(chosen.lap.endedAt)}` : ''}</p>}
            {chosen.checkpoint && <p>Kayıtlı başlangıç: {chosen.checkpoint.label} · {statuses[chosen.checkpoint.status]}</p>}
            <p>Yol kayıtları, dosya olayının gözlendiği turu gösterir; dosyayı hangi işlemin ürettiğini kanıtlamaz. Aynı yol bu görünümde bir kez gösterilir. Dosyaların eski sürümleri ve uygulama ekranları geri alınmaz.</p>
            {[...new Set([...rows.filter(r => r.runId === chosen.runId).flatMap(r => r.issues), ...detailIssues])].map(issue => <p key={issue} className="checkpoint-error">{issue}</p>)}
            {loading && <p role="status">Çıktılar güncelleniyor…</p>}
            {!loading && !outputs.length && <p>Bu kapsamda gözlenen çıktı yok.</p>}
            <p>{outputs.length} farklı yol{chosen.kind === 'lap' || chosen.kind === 'loop' ? ' · alt turlar dahil' : ''}</p>
            <ul className="checkpoint-outputs">{outputs.slice(0, outputLimit).map(o => <li key={o.path}>
              <b>{o.kind === 'folder' ? 'Klasör' : o.kind === 'unknown' ? 'Yol' : 'Dosya'} · {o.change === 'created' ? 'Yeni' : o.change === 'modified' ? 'Değişti' : o.change === 'observed' ? 'Dosya hareketi' : 'Kaldırıldı'}{o.present === false ? ' · Artık bu yolda yok' : ''}</b>
              <span title={o.path}>{o.path}</span>
              <div><button className="xp-btn" disabled={!o.present || working} onClick={() => void action(async () => { if (!await api?.openPath?.(o.path)) throw new Error('Çıktı açılamadı.') })}>Aç</button><button className="xp-btn" disabled={!o.present || working} onClick={() => void action(async () => { if (!await api?.showInFolder?.(o.path)) throw new Error('Klasör açılamadı.') })}>Klasörde göster</button></div>
            </li>)}</ul>
            {outputs.length > outputLimit && <p><button className="xp-btn" onClick={() => setOutputLimit(limit => limit + 500)}>Daha fazla göster ({outputs.length - outputLimit} kaldı)</button></p>}
          </>}
        </main>
      </div>
      <footer><span>Seçili kapsamın kayıtlı başlangıcı varsa çalıştırılabilir. Dosyaları kendin temizledikten sonra başlat. Mevcut taslak solda ayrı bir sekmede korunur; checkpoint kendi tuvaline yüklenir ve bitince sağdaki tuvaller sürer. Uygulama ekranları geri alınmaz.</span><button className="xp-btn primary" disabled={!chosen?.checkpoint || loading || running || busy || working || !api?.checkpointSnapshot} onClick={() => void action(async () => { if (chosen?.checkpoint) await onRun(chosen.checkpoint) })}>Seçiliden çalıştır</button><button className="xp-btn" disabled={working} onClick={onClose}>Kapat</button></footer>
    </section>
  </div>, document.body)
}
