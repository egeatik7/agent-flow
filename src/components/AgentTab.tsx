import { useEffect, useState } from 'react'
import type { AgentGraph, AgentNode, AppSettings, ToolResult, ToolSpec } from '../types'

const api = typeof window !== 'undefined' ? window.xpAgent : undefined

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

  const steps = result?.data?.steps as { done?: number; errors?: number } | undefined

  return (
    <div>
      <p className="hint">
        Ajan buradan Nubbo’nun <b>mevcut motorunu</b> kullanır: aynı hedef bulma, aynı odak, aynı hafıza. Şu an <b>akışı okuma</b>,
        <b>hedefi önizleme</b> ve <b>tek adım çalıştırma</b> hazır; önizleme ekrana hiç dokunmaz, tek adım dokunur ama akışı ilerletmez.
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
                {steps ? (
                  <li>
                    gözlenen adımlar: {steps.done ?? 0} tamam · {steps.errors ?? 0} hata
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
