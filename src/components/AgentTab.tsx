import { useEffect, useState } from 'react'
import type { AgentGraph, AgentNode, AppSettings, ToolResult, ToolSpec } from '../types'

const api = typeof window !== 'undefined' ? window.xpAgent : undefined

/** One line of the branch list, as `branch.list` reports it. */
type BranchRow = {
  branchId: string
  name: string
  baseName: string | null
  groups: number
  ops: number
  baseChanged: boolean
  failed: string[]
  size: number
}

/** A node a branch adds or changes, for the single-step picker. */
type BranchNode = { id: string; kind: string; title: string }

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * The Ajan tab: the human side of the tool layer.
 *
 * Everything here goes through the same tools an outside agent calls, so what you try by hand
 * is exactly what the agent gets. Built for debugging: the answer is the engine's own words,
 * and nothing on this tab can change the flow.
 */
export default function AgentTab({
  selected,
  graph,
  settings,
  onSaveSettings,
}: {
  selected: AgentNode | null
  graph: AgentGraph
  settings: AppSettings
  onSaveSettings: (partial: Partial<AppSettings>) => void
}) {
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState<ToolResult | null>(null)
  const [error, setError] = useState('')
  const [specs, setSpecs] = useState<ToolSpec[]>([])
  const [endpoint, setEndpoint] = useState<{ port: number; file: string } | null>(null)
  const [branches, setBranches] = useState<BranchRow[]>([])
  const [branchId, setBranchId] = useState('')
  const [branchNodes, setBranchNodes] = useState<BranchNode[]>([])
  const [branchNode, setBranchNode] = useState('')

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const e = await api?.toolEndpoint?.()
        if (alive && e) setEndpoint(e)
        if (alive && !e) setEndpoint(null)
      } catch {
        /* the endpoint is optional */
      }
    })()
    return () => {
      alive = false
    }
  }, [settings.agentEndpoint])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const list = await api?.toolList?.()
        if (alive && list) setSpecs(list)
      } catch {
        /* the catalogue is a convenience; the buttons below work without it */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const call = async (name: string, args: Record<string, unknown>) => {
    if (!api?.callTool) {
      setError('Araç bağlantısı yok.')
      return
    }
    setBusy(name)
    setError('')
    setResult(null)
    try {
      setResult(await api.callTool(name, args))
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy('')
    }
  }

  const observed = result?.data?.observed as { done?: number; errors?: number } | undefined
  const last = result?.data?.last as
    | { runId?: string; ok?: boolean; failed?: number; steps?: number; stopped?: boolean; error?: string }
    | null
    | undefined

  /** The branch list is read on its own, so it does not push the last answer off the screen. */
  const refreshBranches = async () => {
    if (!api?.callTool) return
    setBusy('branch.list')
    try {
      const r = await api.callTool('branch.list', {})
      if (r.ok) setBranches(((r.data?.branches as BranchRow[] | undefined) ?? []).slice())
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy('')
    }
  }

  const inspectBranch = async (id: string) => {
    if (!api?.callTool) return
    setBranchId(id)
    setBranchNodes([])
    setBranchNode('')
    setBusy('branch.diff')
    setError('')
    setResult(null)
    try {
      const r = await api.callTool('branch.diff', { branchId: id })
      setResult(r)
      const d = r.data?.diff as { addedNodes?: BranchNode[]; changedNodes?: BranchNode[] } | undefined
      setBranchNodes([...(d?.addedNodes ?? []), ...(d?.changedNodes ?? [])])
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy('')
    }
  }

  const dropBranch = async (id: string) => {
    if (!api?.callTool) return
    setBusy('branch.drop')
    try {
      await api.callTool('branch.drop', { branchId: id })
      if (branchId === id) {
        setBranchId('')
        setBranchNodes([])
      }
      await refreshBranches()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy('')
    }
  }

  useEffect(() => {
    void refreshBranches()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <p className="hint">
        Ajan buradan Nubbo’nun <b>mevcut motorunu</b> kullanır: aynı hedef bulma, aynı odak, aynı hafıza. Hazır olanlar: <b>akışı okuma</b>,
        <b> hedefi önizleme</b>, <b>tek adım çalıştırma</b> ve <b>branch önerisi</b> (tarif olarak; akışına yazmaz). Önizleme ekrana hiç
        dokunmaz, tek adım ve branch testi dokunur ama akışı ilerletmez.
      </p>

      <div className="field">
        <label>Ajan izni</label>
        <select
          className="xp-input"
          value={settings.agentPermission ?? 'ask'}
          onChange={(e) => onSaveSettings({ agentPermission: e.target.value as 'off' | 'ask' | 'auto' })}
        >
          <option value="off">Kapalı — dışarıdan eyleyen araç çalışmaz</option>
          <option value="ask">Sor — her eyleyen çağrı onay ister</option>
          <option value="auto">Otomatik — onay sormaz</option>
        </select>
        <p className="hint">Bu sekmedeki düğmeler sorulmaz: düğmeye basman zaten onayın. Okuma araçları hiç sorulmaz.</p>
      </div>

      <div className="field">
        <label>Dışarı açık (yerel uç nokta)</label>
        <label style={{ display: 'block', fontSize: 12 }}>
          <input
            type="checkbox"
            checked={!!settings.agentEndpoint}
            onChange={(e) => onSaveSettings({ agentEndpoint: e.target.checked })}
          />{' '}
          Yalnız 127.0.0.1 üzerinde dinle
        </label>
        <p className="hint">
          {settings.agentEndpoint
            ? endpoint
              ? `Açık: http://127.0.0.1:${endpoint.port} · jeton dosyası: ${endpoint.file}`
              : 'Açılıyor…'
            : 'Kapalı. Açınca ajan araçları bu adresten çağırabilir; jeton dosyasından okunur, izin ayarı yine geçerli.'}
        </p>
        {settings.agentEndpoint && endpoint && (
          <button type="button" className="xp-btn" onClick={() => void api?.toolEndpointOpen?.()}>
            Dosyanın konumunu aç
          </button>
        )}
      </div>

      <div className="field">
        <label>Hedef denemesi (girdi göndermez)</label>
        <button
          type="button"
          className="xp-btn"
          disabled={!selected || busy === 'target.preview'}
          onClick={() => selected && void call('target.preview', { nodeId: selected.id, graph })}
        >
          {busy === 'target.preview' ? 'Bakılıyor…' : 'Hedefi önizle'}
        </button>
        <p className="hint">{selected ? `Seçili: ${selected.title} (${selected.kind})` : 'Tuvalde bir node seç, sonra bas.'}</p>
      </div>

      <div className="field">
        <label>Tek adım (ekrana dokunur)</label>
        <button
          type="button"
          className="xp-btn"
          disabled={!selected || busy === 'step.run'}
          onClick={() => selected && void call('step.run', { nodeId: selected.id, graph })}
        >
          {busy === 'step.run' ? 'Çalışıyor…' : 'Seçili node’u tek adım çalıştır'}
        </button>
        <p className="hint">
          Aynı motor, aynı hedef bulma, aynı tuş koruması. <b>Akış ilerlemez:</b> döngü işareti, hafıza ve kayıtlı yol değişmez;
          zincir bu adımdan sonra durur.
        </p>
      </div>

      <div className="field">
        <label>Akış</label>
        <button type="button" className="xp-btn" disabled={busy === 'flow.read'} onClick={() => void call('flow.read', { graph })}>
          {busy === 'flow.read' ? 'Okunuyor…' : 'Akışı oku'}
        </button>
        <p className="hint">Node’ları, paketleri ve döngüleri listeler; kutuların içi dahil. Kaydedilmemiş tuval de okunur.</p>
      </div>

      <div className="field">
        <label>Koşu</label>
        <button type="button" className="xp-btn" disabled={busy === 'run.state'} onClick={() => void call('run.state', {})}>
          {busy === 'run.state' ? 'Bakılıyor…' : 'Durumu oku'}
        </button>
        <button type="button" className="xp-btn" style={{ marginLeft: 6 }} disabled={busy === 'run.stop'} onClick={() => void call('run.stop', {})}>
          Durdur
        </button>
        <p className="hint">Durum: hangi node, hangi kutu, hangi öğe, kaç adım gözlendi, son hata ne.</p>
      </div>

      <div className="field">
        <label>Ajan branch’leri (öneri tarifi)</label>
        <button type="button" className="xp-btn" disabled={busy === 'branch.list'} onClick={() => void refreshBranches()}>
          {busy === 'branch.list' ? 'Bakılıyor…' : 'Branch’leri yenile'}
        </button>
        {branches.length === 0 ? (
          <p className="hint">
            Açık branch yok. Ajan <b>branch.create</b> ile kendi branch’ini açar: bu, akışının <b>kopyası değil</b>, düzenleme tarifidir.
            Senin akışına ve açık tuvaline hiçbir şey yazılmaz; tarifi ana akışa geçirmek (merge) sonraki adımda geliyor.
          </p>
        ) : (
          <ul style={{ margin: '6px 0 0 16px', padding: 0, fontSize: 12, lineHeight: 1.5 }}>
            {branches.map((b) => (
              <li key={b.branchId} style={{ marginBottom: 6 }}>
                <b>{b.name}</b> · {b.groups} düzenleme · {b.ops} işlem · {(b.size / 1024).toFixed(1)} KB
                {b.baseName ? ` · temel: ${b.baseName}` : ''}
                {b.baseChanged ? ' · temeli değişmiş' : ''}
                {b.failed?.length ? ` · ${b.failed.length} grup uymuyor` : ''}
                <div style={{ marginTop: 2 }}>
                  <button type="button" className="xp-btn" disabled={!!busy} onClick={() => void inspectBranch(b.branchId)}>
                    İncele
                  </button>
                  <button
                    type="button"
                    className="xp-btn"
                    style={{ marginLeft: 4 }}
                    disabled={!!busy}
                    onClick={() => void call('run.from', { branchId: b.branchId })}
                  >
                    Test et
                  </button>
                  <button type="button" className="xp-btn" style={{ marginLeft: 4 }} disabled={!!busy} onClick={() => void dropBranch(b.branchId)}>
                    Sil
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {branchNodes.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <select className="xp-input" value={branchNode} onChange={(e) => setBranchNode(e.target.value)}>
              <option value="">— branch’te değişen bir node seç —</option>
              {branchNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title} ({n.kind})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="xp-btn"
              style={{ marginLeft: 4 }}
              disabled={!branchNode || !!busy}
              onClick={() => void call('step.run', { nodeId: branchNode, branchId })}
            >
              Tek adım (branch)
            </button>
          </div>
        )}
        <p className="hint">
          <b>Test et</b> branch’i türetilmiş haliyle çalıştırır: kayıtlı akışa yazılmaz ve tuvalin döngü işaretlerini değiştirmez.
          <b> İncele</b> yalnız farkı hesaplar. <b>Sil</b> yalnız tarifi siler; akışa hiçbir şey olmaz.
        </p>
      </div>

      {error && <p className="hint">Hata: {error}</p>}

      {result && (
        <div className="field">
          <label>Sonuç</label>
          <div style={{ border: '1px solid #aca899', background: '#fff', padding: '6px 8px', fontSize: 12, lineHeight: 1.45 }}>
            {result.message}
          </div>
          <ul style={{ margin: '6px 0 0 16px', padding: 0, fontSize: 12, lineHeight: 1.5 }}>
            <li>
              sonuç: <b>{result.outcome}</b>
            </li>
            {result.target && (
              <li>
                hedef:{' '}
                {result.target.found
                  ? `${result.target.stage ?? '—'} basamağı · ${result.target.candidates ?? '—'} aday · (${Math.round(result.target.x ?? 0)}, ${Math.round(result.target.y ?? 0)})`
                  : 'bulunamadı'}
              </li>
            )}
            {result.node && (
              <li>
                node: {result.node.title}
                {result.node.packagePath.length ? ' (paket içinde)' : ''}
              </li>
            )}
            {result.loop && (
              <li>
                döngü: {result.loop.title} ·{' '}
                {typeof result.loop.index === 'number' ? `${result.loop.index + 1}/${result.loop.total}` : '—'}
                {result.loop.item ? ` · ${result.loop.item}` : ''}
              </li>
            )}
            {result.tool === 'run.state' && (
              <>
                <li>
                  koşu: {result.data?.running ? 'sürüyor' : 'yok'}
                  {result.data?.probing ? ' · tek adım sürüyor' : ''}
                  {result.data?.stopRequested ? ' · durdurma istendi' : ''}
                </li>
                {result.data?.nodeTitle ? <li>node: {String(result.data.nodeTitle)}</li> : null}
                {observed ? (
                  <li>
                    gözlenen adımlar: {observed.done ?? 0} tamam · {observed.errors ?? 0} hata
                  </li>
                ) : null}
                {last ? (
                  <li>
                    son koşu ({last.runId}):{' '}
                    {last.stopped ? 'durduruldu' : last.error ? `hata: ${last.error}` : last.ok ? 'tamamlandı' : 'hata ile bitti'}
                    {typeof last.steps === 'number' ? ` · ${last.steps} adım` : ''}
                    {last.failed ? ` · ${last.failed} hatalı öğe/tur` : ''}
                  </li>
                ) : null}
                {result.data?.lastError ? <li>son hata: {String(result.data.lastError)}</li> : null}
              </>
            )}
            {result.suggestion && <li>öneri: {result.suggestion}</li>}
          </ul>
        </div>
      )}

      {specs.length > 0 && (
        <div className="field">
          <label>Araçlar</label>
          <ul style={{ margin: '0 0 0 16px', padding: 0, fontSize: 12, lineHeight: 1.5 }}>
            {specs.map((s) => (
              <li key={s.name} style={{ opacity: s.ready ? 1 : 0.55 }}>
                <b>{s.name}</b> — {s.summary}
                {s.ready ? '' : ' (sırada)'}
                {s.sendsInput ? ' · ekrana dokunur' : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
