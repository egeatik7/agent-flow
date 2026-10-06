import { useEffect, useState } from 'react'
import type { ToolResult } from '../types'

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
 * Agent suggestions, where they belong: on the canvas, not buried in a side tab.
 *
 * A branch is a recipe over the flow, not a copy of it (see electron/tool-branch.ts). This panel
 * is the human side of that: what the agent proposed, what it would change, and the two ways to
 * use it — try it, or merge it into the flow. Nothing here writes to the flow except merge, which
 * is two steps on purpose and can be taken back once.
 */
export default function BranchPanel({ onInspect }: { onInspect?: (branchId: string) => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState<ToolResult | null>(null)
  const [error, setError] = useState('')
  const [branches, setBranches] = useState<BranchRow[]>([])
  const [branchId, setBranchId] = useState('')
  const [branchNodes, setBranchNodes] = useState<BranchNode[]>([])
  const [branchNode, setBranchNode] = useState('')
  const [mergeReady, setMergeReady] = useState('')
  const [mergedOnce, setMergedOnce] = useState(false)

  const call = async (name: string, args: Record<string, unknown>): Promise<ToolResult | null> => {
    if (!api?.callTool) {
      setError('Araç bağlantısı yok.')
      return null
    }
    setBusy(name)
    setError('')
    try {
      const r = await api.callTool(name, args)
      setResult(r)
      return r
    } catch (e) {
      setError(errText(e))
      return null
    } finally {
      setBusy('')
    }
  }

  /** The list is read on its own, so refreshing it does not push the last answer away. */
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

  useEffect(() => {
    void refreshBranches()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const inspectBranch = async (id: string) => {
    setBranchId(id)
    setBranchNodes([])
    setBranchNode('')
    const r = await call('branch.diff', { branchId: id })
    const d = r?.data?.diff as { addedNodes?: BranchNode[]; changedNodes?: BranchNode[] } | undefined
    setBranchNodes([...(d?.addedNodes ?? []), ...(d?.changedNodes ?? [])])
    // The canvas shows the branch as a document while it is being looked at.
    onInspect?.(id)
  }

  /** First step of a merge: only says what would be written. */
  const mergeTry = async (id: string) => {
    setMergeReady('')
    const r = await call('branch.merge', { branchId: id })
    if (r?.ok && r.data?.applied === false) setMergeReady(id)
  }

  /** Second step: the window applies it to the canvas, saves it, and the recipe is dropped. */
  const mergeApply = async (id: string) => {
    const r = await call('branch.merge', { branchId: id, apply: true })
    setMergeReady('')
    if (r?.ok && r.data?.applied === true) setMergedOnce(true)
    onInspect?.('')
    setBranchId('')
    setBranchNodes([])
    await refreshBranches()
  }

  /** A wrong merge must be takeable back: once, from the flow it replaced. */
  const mergeUndo = async () => {
    const r = await call('merge.undo', {})
    if (r?.ok) {
      setMergedOnce(false)
      await refreshBranches()
    }
  }

  const dropBranch = async (id: string) => {
    await call('branch.drop', { branchId: id })
    if (branchId === id) {
      setBranchId('')
      setBranchNodes([])
    }
    await refreshBranches()
  }

  return (
    <div className="branch-panel">
      <div className="branch-panel-head">
        <button type="button" className="branch-panel-toggle" onClick={() => setOpen((v) => !v)} title={open ? 'Kapat' : 'Aç'}>
          {open ? '▾' : '▸'} Ajan tavsiyeleri
          {branches.length > 0 ? ` (${branches.length})` : ''}
        </button>
        <button type="button" className="branch-panel-mini" disabled={busy === 'branch.list'} onClick={() => void refreshBranches()} title="Yenile">
          ↻
        </button>
      </div>

      {open && (
        <div className="branch-panel-body">
          {branches.length === 0 ? (
            <p className="hint" style={{ margin: '4px 0' }}>
              Açık öneri yok. Ajan <b>branch.create</b> ile kendi tarifini açar: akışının <b>kopyası değil</b>, düzenleme tarifidir; senin
              akışına yazmaz.
            </p>
          ) : (
            <ul style={{ margin: '4px 0 0 14px', padding: 0, fontSize: 12, lineHeight: 1.5 }}>
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
                      onClick={() => void call('run.from', { branchId: b.branchId, fromStart: true })}
                    >
                      Test et
                    </button>
                    <button type="button" className="xp-btn" style={{ marginLeft: 4 }} disabled={!!busy} onClick={() => void mergeTry(b.branchId)}>
                      Mergele
                    </button>
                    {mergeReady === b.branchId && (
                      <button type="button" className="xp-btn" style={{ marginLeft: 4 }} disabled={!!busy} onClick={() => void mergeApply(b.branchId)}>
                        Uygula (akışa yaz)
                      </button>
                    )}
                    <button type="button" className="xp-btn" style={{ marginLeft: 4 }} disabled={!!busy} onClick={() => void dropBranch(b.branchId)}>
                      Sil
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {branchNodes.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <select className="xp-input" value={branchNode} onChange={(e) => setBranchNode(e.target.value)}>
                <option value="">— önerideki bir node’u seç —</option>
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
                Tek adım
              </button>
            </div>
          )}

          {mergedOnce && (
            <button type="button" className="xp-btn" style={{ marginTop: 4 }} disabled={!!busy} onClick={() => void mergeUndo()}>
              {busy === 'merge.undo' ? 'Geri alınıyor…' : 'Son merge’ü geri al'}
            </button>
          )}

          {error && <p className="hint">Hata: {error}</p>}
          {result && (
            <div className="branch-panel-answer" title={result.message}>
              {result.outcome === 'tamam' ? '' : `${result.outcome}: `}
              {result.message}
            </div>
          )}
          <p className="hint" style={{ margin: '4px 0 0' }}>
            <b>İncele</b> yalnız farkı hesaplar ve tuvalde gösterir. <b>Test et</b> türetilmiş hâliyle çalıştırır (kayıtlı akışa yazmaz).
            <b> Mergele</b> iki adımlıdır: önce ne yazılacağını söyler, <b>Uygula</b> gerçekten yazar ve kaydeder.
          </p>
        </div>
      )}
    </div>
  )
}
