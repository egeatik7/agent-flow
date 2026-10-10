import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import AgentTab from './AgentTab'
import RecoverySettingsPanel from './RecoverySettingsPanel'
import ModelChain from './ModelChain'
import LlmPanel from './LlmPanel'
import NubboMascot from './NubboMascot'
import NodeNavigator from './NodeNavigator'
import TemplateInput from './TemplateInput'
import { KEY_PRESETS, winPrefix } from '../lib/key-presets'
import {
  NODE_SPECS,
  portLabel,
  listItems,
  loopStartIndex,
  type AgentEdge,
  type AgentGraph,
  type AgentNode,
  type AppSettings,
  type PathStep,
  type ClickMode,
  type ModelInfo,
  type StepStatus,
} from '../types'

export type SideTab = 'node' | 'llm' | 'settings' | 'agent' | 'canvases'

type Props = {
  tab: SideTab
  canvasPanel?: ReactNode
  canvasName?: string
  canvasKey?: string
  onNavigateNode?: (id: string, inspect: boolean) => void
  locationName?: string
  locationKey?: string
  navigationDisabled?: boolean
  onNavigateBack?: () => void
  onNavigateForward?: () => void
  onNavigateOut?: () => void
  canNavigateBack?: boolean
  canNavigateForward?: boolean
  canNavigateOut?: boolean
  stepStatus?: Record<string, StepStatus>
  highlightedNodeIds?: string[]
  runPhase?: 'idle' | 'running' | 'stopped'
  onTab: (t: SideTab) => void
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  onSaveSettings: (partial: Partial<AppSettings>) => void
  windows: { title: string; handle: string }[]
  onRefreshWindows: () => void
  models: ModelInfo[]
  onLoadModels: () => void
  onTestApi: () => void
  onTestVision: () => void
  graph: AgentGraph
  rootGraph?: AgentGraph
  disabled?: boolean
  selected: AgentNode | null
  selectedCount?: number
  selectedEdge: AgentEdge | null
  onUpdateNode: (patch: Partial<AgentNode>) => void
  onDeleteNode: () => void
  onDeleteEdge: () => void
  onCaptureForNode: () => void
  onOpenScanner: () => void
  onFillFromFolder: (nodeId: string) => void
  onLoopFolder: (nodeId: string, folder: string) => void
  /** Yerel (OpenAI uyumlu) sunucudan model listesi çeker; satırlar "local:model" olarak eklenir. */
  onLoadLocalModels?: () => Promise<void>
  onEnterPackage: (id: string) => void
  onUnpackPackage: (id: string) => void
  onUpdatePackaged: (packageId: string, nodeId: string, patch: Partial<AgentNode>) => void
  onPickDir: () => Promise<string | null>
  capturing: number
}

const VISION_PRESETS = [
  'google/gemini-3.8-flash',
  'google/gemini-3.5-flash-lite',
  'google/gemini-2.5-flash',
  'anthropic/claude-sonnet-5',
  'qwen/qwen2.5-vl-72b-instruct',
]

const AGENT_PRESETS = ['bytedance/ui-tars-1.5-7b', 'google/gemini-3.8-flash', 'anthropic/claude-sonnet-5']

const CLICK_MODES: { key: ClickMode; label: string }[] = [
  { key: 'left', label: 'Tek tık' },
  { key: 'double', label: 'Çift tık' },
  { key: 'right', label: 'Sağ tık' },
  { key: 'move', label: 'Fareyi Oynat' },
]


function SaveRow(props: { children: ReactNode; onSave: () => void }) {
  return (
    <div className="field-row">
      {props.children}
      <button type="button" className="xp-btn save" onClick={props.onSave}>
        Kaydet
      </button>
    </div>
  )
}

function TargetBox(p: Props & { n: AgentNode }) {
  const { n } = p
  const loc = n.locator
  return (
    <div className="field locator-box">
      <label>Hedef</label>
      {loc ? (
        <>
          <p className="hint">
            Yakalanan: <b>{loc.text || loc.name ? `“${loc.text || loc.name}”` : 'yazısız öğe'}</b> ({loc.controlType})
            {loc.windowTitle ? <> — {loc.windowTitle}</> : null}
          </p>
          {loc.icon && (
            <>
              <img className="icon-preview" alt="Seçilen öğenin resmi" src={`data:image/png;base64,${loc.icon}`} />
            </>
          )}
        </>
      ) : n.anchor ? (
        <p className="hint">Son bilinen konum: {n.anchor.x}, {n.anchor.y}</p>
      ) : (
        null
      )}
      <div className="field-row wrap">
        <button type="button" className="xp-btn primary" onClick={p.onOpenScanner}>
          Ekrandan Seç
        </button>
        <button type="button" className="xp-btn" disabled={p.capturing > 0} onClick={p.onCaptureForNode}>
          {p.capturing > 0 ? `İmleci hedefe götür… ${p.capturing}` : 'İmleçle Yakala (3 sn)'}
        </button>
        {(loc || n.anchor) && (
          <button type="button" className="xp-btn" onClick={() => p.onUpdateNode({ locator: undefined, anchor: undefined })}>
            Temizle
          </button>
        )}
      </div>
    </div>
  )
}

function TemplateField(p: Props & { n: AgentNode; field: 'prompt' | 'text' | 'keys' | 'folder'; label: string; placeholder?: string; multiline?: boolean; id?: string; mono?: boolean }) {
  return <TemplateInput key={`${p.n.id}:${p.field}`} value={p.n[p.field] ?? ''}
    graph={p.rootGraph ?? p.graph} nodeId={p.n.id} label={p.label}
    placeholder={p.placeholder} multiline={p.multiline} id={p.id} mono={p.mono} disabled={p.disabled}
    onChange={value => p.field === 'folder' ? p.onLoopFolder(p.n.id, value) : p.onUpdateNode({ [p.field]: value })} />
}

/** Döngü öğesi mutlak yol değilse klasör alanıyla birleştirir; şablonlu/boş klasörde yol çözülemez. */
function fullItemPath(item: string, folder?: string): string {
  const value = item.trim()
  if (!value) return ''
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')) return value
  const base = (folder ?? '').trim().replace(/[\\/]+$/, '')
  if (!base || /\{\{/.test(base)) return ''
  return `${base}\\${value}`
}

function LoopEditor(p: Props & { n: AgentNode }) {
  const [pathMenu, setPathMenu] = useState<{ x: number; y: number; item: string; full: string } | null>(null)
  const { n } = p
  const items = listItems(n)
  const members = (n.members ?? []).length
  const mark = loopStartIndex(n, items.length, true)
  const folder = n.folder ?? ''
  const folderIsTemplate = /\{\{/.test(folder)
  const setItem = (index: number, value: string) => {
    const next = items.slice()
    next[index] = value
    p.onUpdateNode({ items: next })
  }
  return (
    <>
      {members === 0 && <p className="hint warn">Kutu boş. Tekrar edecek node’ları çerçevenin içine sürükle ya da seçip Ctrl+G.</p>}
      <div className="field">
        <label htmlFor="loop-folder">Klasör</label>
        <TemplateField {...p} n={n} field="folder" id="loop-folder" label="Klasör" mono placeholder={'C:\\Klasör veya D:\\İş\\{{öğe}}'} />
        <div className="field-row loop-folder-actions">
          <button type="button" className="xp-btn primary" onClick={() => p.onFillFromFolder(n.id)}>
            Klasörden doldur…
          </button>
          {(items.length > 0 || folder.trim()) && (
            <button type="button" className="xp-btn" onClick={() => p.onLoopFolder(n.id, '')}>
              Listeyi temizle
            </button>
          )}
        </div>
        <label>Liste (her satır bir öğe)</label>
        {items.length > 0 ? (
          <div className="xp-tick-list">
            {items.map((item, i) => (
              <div className={'xp-tick-row' + (i === mark ? ' on' : '')} key={i}
                onContextMenu={(e) => {
                  e.preventDefault()
                  const full = fullItemPath(item, n.folder)
                  setPathMenu({ x: e.clientX, y: e.clientY, item, full })
                }}
                onDoubleClick={() => {
                  const full = fullItemPath(item, n.folder)
                  if (full && window.xpAgent?.openPath) void window.xpAgent.openPath(full)
                }}
                title="Sağ tık: bulunduğu klasörü aç · Çift tık: öğeyi aç">
                <label className="xp-tick">
                  <input
                    type="checkbox"
                    checked={i === mark}
                    onChange={() => p.onUpdateNode({ startIndex: i })}
                  />
                  <span className="xp-tick-box" />
                </label>
                <input
                  className="xp-tick-path mono"
                  value={item}
                  size={Math.max(item.length, 16)}
                  spellCheck={false}
                  onChange={(e) => {
                    if (e.target.value.trim()) setItem(i, e.target.value)
                  }}
                />
              </div>
            ))}
          </div>
        ) : folderIsTemplate ? null : (
          <textarea
            className="xp-textarea mono list-area"
            value={(n.items ?? []).join('\n')}
            placeholder={'C:\\Klasör\\kedi.png\nC:\\Klasör\\alt-klasör\n…'}
            onChange={(e) => p.onUpdateNode({ items: e.target.value.split('\n'), startIndex: 0 })}
          />
        )}
        {pathMenu && (
          <div className="ctx-menu" style={{ position: 'fixed', left: pathMenu.x, top: pathMenu.y, zIndex: 60 }}
            onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
            <div className="ctx-title">{pathMenu.item}</div>
            <button
              type="button"
              disabled={!pathMenu.full}
              title={pathMenu.full || 'Yol çözülemedi: öğe göreli ve klasör alanı boş ya da şablon ({{öğe}}) içeriyor.'}
              onClick={() => {
                if (pathMenu.full) void window.xpAgent?.showInFolder?.(pathMenu.full)
                setPathMenu(null)
              }}
            >
              Yolu aç
            </button>
            <button type="button" disabled={!pathMenu.full} onClick={() => {
              if (pathMenu.full) void window.xpAgent?.openPath?.(pathMenu.full)
              setPathMenu(null)
            }}>
              Öğeyi aç
            </button>
            <button type="button" onClick={() => setPathMenu(null)}>Kapat</button>
          </div>
        )}
      </div>

      {items.length === 0 && !folderIsTemplate && (
        <div className="field">
          <label>Tekrar sayısı (liste boşken)</label>
          <input
            className="xp-input"
            type="number"
            min={1}
            value={n.count ?? 1}
            onChange={(e) => p.onUpdateNode({ count: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
          />
        </div>
      )}

    </>
  )
}

function MemoryBox(p: Props & { n: AgentNode }) {
  const { n } = p
  const m = n.memory ?? []
  if (!m.length) return null
  const last = m[0]
  return (
    <div className="memo-box">
      <label>Hafıza</label>
      <p className="hint">
        Son {m.length} turda bulunan hedef: <b>{last.src === 'ocr' ? 'yazı' : last.type}</b> “{last.text}”
        {last.win ? <> — {last.win.replace(/^web:/, 'sayfa: ')}</> : null}.
      </p>
      <button type="button" className="xp-btn" onClick={() => p.onUpdateNode({ memory: undefined })}>
        Unut
      </button>
    </div>
  )
}

function pathLabel(st: PathStep): string {
  const pt = st.rx !== undefined && st.ry !== undefined ? ` (%${Math.round(st.rx * 100)}, %${Math.round(st.ry * 100)})` : ''
  switch (st.action) {
    case 'click':
      return `tıkla${pt}`
    case 'double':
      return `çift tıkla${pt}`
    case 'right':
      return `sağ tıkla${pt}`
    case 'move':
      return `fareyi oynat${pt}`
    case 'drag':
      return `sürükle${pt}`
    case 'hotkey':
      return `tuş ${(st.keys ?? []).join('+')}`
    case 'type':
      return `yaz “${(st.text ?? '').replace(/\n/g, '⏎')}”`
    case 'scroll':
      return `kaydır ${st.direction ?? ''}`
    default:
      return 'bekle'
  }
}

function AiEditor(p: Props & { n: AgentNode }) {
  const { n } = p
  const upd = p.onUpdateNode
  const engine = n.engine ?? 'screen'
  const model = (p.settings.agentModel || p.settings.visionModel || p.settings.model).trim()
  return (
    <>
      <div className="field">
        <label>Nasıl çalışsın?</label>
        <div className="seg">
          {(
            [
              ['screen', 'Ekrana bakarak (UI-TARS gibi)'],
              ['list', 'Yazı listesiyle'],
            ] as const
          ).map(([k, label]) => (
            <button type="button" key={k} className={`seg-btn${engine === k ? ' active' : ''}`} onClick={() => upd({ engine: k })}>
              {label}
            </button>
          ))}
        </div>
        <div className="node-model-row">Model: <span className="mono">{model || '—'}</span>
          <button type="button" className="link-btn" onClick={() => p.onTab('settings')}>değiştir</button>
        </div>
      </div>
      <div className="field">
        <label>Hedef (ne olmasını istiyorsun?)</label>
        <TemplateField {...p} n={n} field="prompt" label="Hedef (ne olmasını istiyorsun?)" placeholder="Örn: Ayarlar’dan dili Türkçe yap ve kaydet" multiline />
      </div>
      <div className="field">
        <label>En fazla eylem</label>
        <input
          className="xp-input"
          type="number"
          min={1}
          max={60}
          value={n.maxActions ?? 25}
          onChange={(e) => upd({ maxActions: Math.min(60, Math.max(1, Math.floor(Number(e.target.value) || 1))) })}
        />
      </div>
      {engine === 'screen' && n.path?.length ? (
        <div className="memo-box">
          <label>Kayıtlı yol ({n.path.length} adım)</label>
          <ol className="hint-list">
            {n.path.map((st, i) => (
              <li key={i}>
                <span className="mono">{pathLabel(st)}</span>
                {st.thought ? <> — {st.thought}</> : null}
              </li>
            ))}
          </ol>
          <button type="button" className="xp-btn" onClick={() => upd({ path: undefined })}>
            Unut
          </button>
        </div>
      ) : null}
      {!p.settings.apiKey && <p className="hint warn">API anahtarı kayıtlı değil; İnisiyatif çalışmaz.</p>}
      {engine === 'list' && n.trace?.length ? (
        <div className="memo-box">
          <label>Geçen başarılı tur</label>
          <ol className="hint-list">
            {n.trace.map((t, i) => (
              <li key={i} className="mono">{t}</li>
            ))}
          </ol>
          <button type="button" className="xp-btn" onClick={() => upd({ trace: undefined })}>
            Unut
          </button>
        </div>
      ) : null}
    </>
  )
}

function flowRank(graph: AgentGraph): Map<string, number> {
  const order: string[] = []
  const seen = new Set<string>()
  const visit = (id?: string) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    order.push(id)
    const n = graph.nodes.find((x) => x.id === id)
    if (!n) return
    if (n.kind === 'loop') {
      const ids = new Set(n.members ?? [])
      const fed = new Set(graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => e.to))
      const queue = (n.members ?? []).filter((m) => !fed.has(m))
      const walk = queue.length ? [...queue] : [...(n.members ?? [])]
      const done = new Set<string>()
      while (walk.length) {
        const m = walk.shift()!
        if (done.has(m)) continue
        done.add(m)
        visit(m)
        for (const e of graph.edges) if (e.from === m && ids.has(e.to)) walk.push(e.to)
      }
    }
    for (const e of graph.edges) if (e.from === id) visit(e.to)
  }
  const start = graph.nodes.find((n) => n.kind === 'start')
  if (start) visit(start.id)
  for (const n of graph.nodes) if (!seen.has(n.id)) order.push(n.id)
  return new Map(order.map((id, i) => [id, i]))
}

function exposedIn(pkg: AgentNode): AgentNode[] {
  const inner = pkg.inner
  if (!inner) return []
  const rank = flowRank(inner)
  return inner.nodes
    .filter((n) => n.expose)
    .sort((a, b) => {
      const group = (n: AgentNode) => (n.kind === 'loop' ? 0 : 1)
      const g = group(a) - group(b)
      if (g) return g
      return (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)
    })
}

function NodeFields(p: Props & { n: AgentNode }) {
  const { n } = p
  const upd = p.onUpdateNode
  return (
    <>
      <div className="field">
        <label>Başlık</label>
        <input className="xp-input" value={n.title} onChange={(e) => upd({ title: e.target.value })} />
      </div>
      <label className="check">
        <input type="checkbox" checked={!!n.expose} onChange={(e) => upd({ expose: e.target.checked })} />
        Pakette ayarları göster
      </label>

      {n.kind === 'click' && (
        <>
          <div className="field">
            <label>Neye tıklanacak?</label>
            <TemplateField {...p} n={n} field="prompt" label="Neye tıklanacak?" placeholder="Örn: ‘Modeli İndir’ yazan butona bas" multiline />
          </div>
          <div className="field">
            <label>Tıklama türü</label>
            <div className="seg">
              {CLICK_MODES.map((m) => (
                <button
                  type="button"
                  key={m.key}
                  className={`seg-btn${(n.clickMode ?? 'left') === m.key ? ' active' : ''}`}
                  onClick={() => upd({ clickMode: m.key })}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <TargetBox {...p} n={n} />
          <MemoryBox {...p} n={n} />
        </>
      )}

      {n.kind === 'type' && (
        <>
          <div className="field">
            <label>Yazılacak metin</label>
            <TemplateField {...p} n={n} field="text" label="Yazılacak metin" placeholder="Örn: {{öğe}} veya D:\\Modeller\\{{öğe.isim}}.glb" />
          </div>
          <div className="field">
            <label>Hangi alana? (boşsa o an seçili alana yazar)</label>
            <TemplateField {...p} n={n} field="prompt" label="Hangi alana?" placeholder="Örn: ‘Ara’ kutusu" />
          </div>
          <label className="check">
            <input type="checkbox" checked={n.clearFirst !== false} onChange={(e) => upd({ clearFirst: e.target.checked })} />
            Önce alandaki yazıyı sil (Ctrl+A)
          </label>
          <label className="check">
            <input type="checkbox" checked={!!n.pressEnter} onChange={(e) => upd({ pressEnter: e.target.checked })} />
            Yazdıktan sonra Enter’a bas
          </label>
          <TargetBox {...p} n={n} />
          <MemoryBox {...p} n={n} />
        </>
      )}

      {n.kind === 'key' && (
        <div className="field">
          <label>Tuş / Kısayol</label>
          <TemplateField {...p} n={n} field="keys" label="Tuş / Kısayol" mono placeholder="win+r" />
          <div className="chips">
            {KEY_PRESETS.map((k) => (
              <button
                type="button"
                key={k.label}
                className="chip"
                onClick={() => upd({ keys: k.append ? winPrefix(n.keys) : k.keys })}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {n.kind === 'wait' && (
        <div className="field">
          <label>Süre (saniye)</label>
          <input
            className="xp-input"
            type="number"
            min={0}
            step={0.5}
            value={(n.ms ?? 0) / 1000}
            onChange={(e) => upd({ ms: Math.round(Math.max(0, Number(e.target.value) || 0) * 1000) })}
          />
          <div className="chips">
            {[1, 2, 5, 10, 30, 60].map((s) => (
              <button type="button" key={s} className="chip" onClick={() => upd({ ms: s * 1000 })}>
                {s} sn
              </button>
            ))}
          </div>
        </div>
      )}

      {n.kind === 'condition' && (
        <>
          <div className="field">
            <label>Ekranda aranacak yazı / durum (seçilen öğe varsa boş bırakılabilir)</label>
            <TemplateField {...p} n={n} field="text" label="Ekranda aranacak yazı / durum" placeholder="Örn: job finished 60/60 yazıyorsa evet ver" />
          </div>
          <TargetBox {...p} n={n} />
          <div className="field">
            <label>Görünene kadar bekle (saniye, 0 = bir kez bak)</label>
            <input
              className="xp-input"
              type="number"
              min={0}
              value={Math.round((n.timeoutMs ?? 0) / 1000)}
              onChange={(e) => upd({ timeoutMs: Math.max(0, Number(e.target.value) || 0) * 1000 })}
            />
            <div className="chips">
              {[0, 10, 30, 60, 300, 600].map((sec) => (
                <button type="button" key={sec} className="chip" onClick={() => upd({ timeoutMs: sec * 1000 })}>
                  {sec === 0 ? 'bir kez' : sec >= 60 ? `${sec / 60} dk` : `${sec} sn`}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {n.kind === 'loop' && <LoopEditor {...p} n={n} />}
      {(n.kind === 'browser' || n.kind === 'waitFile' || n.kind === 'moveFile') && (
        <p className="hint">Bu adım kaldırıldı. Node’u silip akışa devam edebilirsin.</p>
      )}
      {n.kind === 'ai' && <AiEditor {...p} n={n} />}
    </>
  )
}

function PackageExposed(p: Props & { pkg: AgentNode }) {
  const items = exposedIn(p.pkg)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  if (!items.length) {
    return <p className="hint">İç node’da “Pakette ayarları göster”i işaretle.</p>
  }
  return (
    <div className="pkg-folds">
      {items.map((node) => {
        const spec = NODE_SPECS[node.kind]
        const shown = !!open[node.id]
        return (
          <div className="pkg-fold" key={node.id}>
            <button
              type="button"
              className="pkg-fold-head"
              style={{ background: spec.color }}
              onClick={() => setOpen((s) => ({ ...s, [node.id]: !s[node.id] }))}
            >
              <span>{shown ? '▾' : '▸'}</span>
              <span>
                {spec.icon} {node.title}
              </span>
            </button>
            {shown && (
              <div className="pkg-fold-body">
                <NodeFields
                  {...p}
                  graph={p.pkg.inner ?? p.graph}
                  n={node}
                  onUpdateNode={(patch) => p.onUpdatePackaged(p.pkg.id, node.id, patch)}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function NodeInspector(p: Props) {
  const n = p.selected
  if (p.selectedEdge) {
    const from = p.graph.nodes.find((x) => x.id === p.selectedEdge!.from)
    const to = p.graph.nodes.find((x) => x.id === p.selectedEdge!.to)
    const port = from ? portLabel(from.kind, p.selectedEdge!.fromPort) : ''
    return (
      <div>
        <p className="hint">
          <b>Bağlantı:</b> {from?.title} ({port}) → {to?.title}
        </p>
        <button type="button" className="xp-btn danger" onClick={p.onDeleteEdge}>
          Bağlantıyı Sil (Del)
        </button>
      </div>
    )
  }
  if (!n) return null
  const spec = NODE_SPECS[n.kind]

  return (
    <div>
      {(p.selectedCount ?? 1) > 1 && (
        <p className="hint">
          <b>{p.selectedCount} node seçili.</b>
        </p>
      )}
      <div className="inspector-kind" style={{ background: spec.color }}>
        {spec.icon} {spec.label}
      </div>

      <NodeFields {...p} n={n} />

      {n.kind === 'package' && (
        <div className="field">
          <div className="field-row wrap">
            <button type="button" className="xp-btn primary" onClick={() => p.onEnterPackage(n.id)}>
              İçine gir
            </button>
            <button type="button" className="xp-btn" onClick={() => p.onUnpackPackage(n.id)}>
              Paketi çıkar
            </button>
          </div>
          <PackageExposed {...p} pkg={n} />
        </div>
      )}

      <button type="button" className="xp-btn danger block" onClick={p.onDeleteNode}>
        {n.kind === 'loop' ? 'Kutuyu Sil (içindekiler kalır)' : 'Node’u Sil (Del)'}
      </button>
    </div>
  )
}

function Settings(p: Props) {
  const [section, setSection] = useState<'general' | 'recovery'>('general')
  return <>
    <div className="tabs settings-subtabs" role="tablist" aria-label="Ayar bölümleri">
      <button type="button" role="tab" aria-selected={section === 'general'} className={`tab ${section === 'general' ? 'active' : ''}`} onClick={() => setSection('general')}>Genel</button>
      <button type="button" role="tab" aria-selected={section === 'recovery'} className={`tab ${section === 'recovery' ? 'active' : ''}`} onClick={() => setSection('recovery')}>Kurtarma Ajanı</button>
    </div>
    {section === 'general' ? <fieldset className="panel-fields" disabled={p.disabled}><GeneralSettings {...p} /></fieldset> : <RecoverySettingsPanel settings={p.settings} setSettings={p.setSettings}
      disabled={p.disabled} onSave={p.onSaveSettings} graph={p.rootGraph ?? p.graph} models={p.models} onLoadModels={p.onLoadModels} />}
  </>
}

const LOCAL_PRESETS = [
  { title: 'llama.cpp (8080)', url: 'http://127.0.0.1:8080/v1' },
  { title: 'Ollama (11434)', url: 'http://127.0.0.1:11434/v1' },
  { title: 'LM Studio (1234)', url: 'http://127.0.0.1:1234/v1' },
]

function GeneralSettings(p: Props) {
  const s = p.settings
  const set = (patch: Partial<AppSettings>) => p.setSettings((prev) => ({ ...prev, ...patch }))
  const model = p.models.find((m) => m.id === s.model.trim())
  const visionInfo = p.models.find((m) => m.id === s.visionModel.trim())
  const localUrl = (s.localBaseUrl ?? '').trim()
  const [localOpen, setLocalOpen] = useState(false)
  const [localNote, setLocalNote] = useState('')
  const loadLocal = async () => {
    setLocalNote('Yerel liste alınıyor…')
    try {
      await p.onLoadLocalModels?.()
      setLocalNote('Liste güncellendi; yerel satırlar "local:model" olarak eklendi.')
    } catch (e) {
      setLocalNote(`Yerel listeye ulaşılamadı: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return (
    <div className="settings-grid">

      <div className="field">
        <label htmlFor="apiKey">OpenRouter API Key</label>
        <SaveRow onSave={() => p.onSaveSettings({ apiKey: s.apiKey.trim() })}>
          <input id="apiKey" className="xp-input" type="password" value={s.apiKey} placeholder="sk-or-v1-..." onChange={(e) => set({ apiKey: e.target.value })} />
        </SaveRow>
      </div>

      <fieldset className="xp-group">
        <legend>Metin Modeli</legend>
      <div className="field">
        <label htmlFor="model">Model adı</label>
        <ModelChain
          primary={s.model}
          backups={s.modelBackups}
          listId="model-list"
          inputId="model"
          placeholder="openai/gpt-4o-mini"
          onChange={(model, modelBackups) => set({ model, modelBackups })}
        />
        <button type="button" className="xp-btn save backup-save" onClick={() => p.onSaveSettings({ model: s.model.trim(), modelBackups: s.modelBackups ?? [] })}>
          Kaydet
        </button>
        <p className="hint">Listedeki 1. model önce denenir; yedekler sırayla. Hepsi susarsa sıra başa döner.</p>
        <datalist id="model-list">
          {p.models.map((m) => (
            <option key={m.id} value={m.id} label={m.vision ? 'görsel destekli' : undefined} />
          ))}
        </datalist>
        {model && !model.id.startsWith('local:') && (
          <p className={`hint ${model.vision ? 'ok' : 'warn'}`}>
            {model.vision ? 'Bu model ekran görüntüsünü görebilir.' : 'Bu model ekran görüntüsü göremez; sadece yazı listesiyle seçer.'}
          </p>
        )}
        <div className="field-row">
          <button type="button" className="xp-btn" onClick={p.onLoadModels}>
            Model listesini getir{p.models.length ? ` (${p.models.length})` : ''}
          </button>
          <button type="button" className="xp-btn primary" onClick={p.onTestApi}>
            API Test
          </button>
          <button type="button" className="xp-btn" onClick={() => setLocalOpen((v) => !v)}>
            {localOpen ? 'Yerel modeli kapat' : '+ Yerel model'}
          </button>
        </div>
        {localOpen && (
          <div className="local-model">
            <div className="field-row">
              <select
                className="xp-input"
                value={LOCAL_PRESETS.some((l) => l.url === localUrl) ? localUrl : ''}
                onChange={(e) => e.target.value && set({ localBaseUrl: e.target.value })}
              >
                <option value="">Sunucu seç…</option>
                {LOCAL_PRESETS.map((l) => (
                  <option key={l.url} value={l.url}>{l.title}</option>
                ))}
              </select>
              <input
                className="xp-input mono"
                value={s.localBaseUrl ?? ''}
                placeholder="http://127.0.0.1:8080/v1"
                onChange={(e) => set({ localBaseUrl: e.target.value })}
              />
            </div>
            <div className="field-row">
              <button
                type="button"
                className="xp-btn save"
                onClick={() => p.onSaveSettings({
                  localBaseUrl: (s.localBaseUrl ?? '').trim(),
                  localTimeoutMs: s.localTimeoutMs ?? 180_000,
                  localVision: s.localVision === true,
                  localOff: s.localOff === true,
                })}
              >
                Yerel ayarları kaydet
              </button>
              <button type="button" className="xp-btn" onClick={() => void loadLocal()}>
                Yerel listeyi getir
              </button>
            </div>
            <div className="field-row">
              <label className="check">
                <input type="checkbox" checked={s.localVision === true} onChange={(e) => set({ localVision: e.target.checked })} />
                Yerel model ekran görüntüsü destekliyor
              </label>
              <label className="check">
                <input type="checkbox" checked={s.localOff === true} onChange={(e) => set({ localOff: e.target.checked })} />
                Şimdilik OpenRouter'a dön
              </label>
            </div>
            <div className="field-row">
              <label htmlFor="local-timeout">Yerel zaman aşımı (sn)</label>
              <input
                id="local-timeout"
                className="xp-input"
                type="number"
                min={10}
                max={900}
                value={Math.round((s.localTimeoutMs ?? 180_000) / 1000)}
                onChange={(e) => set({ localTimeoutMs: Math.max(10, Math.min(900, Math.floor(Number(e.target.value) || 180))) * 1000 })}
              />
            </div>
            <p className="hint">Adres boşsa her şey OpenRouter'da kalır. Yerel satırlar aynı listede <b>local:model</b> olarak durur; ↑ ↓ ile sırasını değiştir, × ile sil. “Şimdilik OpenRouter'a dön” açıkken yerel satırlar atlanır (adres saklı kalır).</p>
            {localNote && <p className="hint">{localNote}</p>}
          </div>
        )}
      </div>
      </fieldset>

      <label className="check">
        <input
          type="checkbox"
          checked={s.sendScreenshot}
          onChange={(e) => p.onSaveSettings({ sendScreenshot: e.target.checked })}
        />
        Normal LLM’e de numaralı ekran görüntüsü gönder
      </label>

      <fieldset className="xp-group">
        <legend>Görsel LLM (ekran görüntüsü modu)</legend>
        <div className="field">
          <label htmlFor="visionModel">Görsel model adı</label>
          <ModelChain
            primary={s.visionModel}
            backups={s.visionBackups}
            listId="vision-model-list"
            inputId="visionModel"
            placeholder="google/gemini-3.8-flash"
            onChange={(visionModel, visionBackups) => set({ visionModel, visionBackups })}
          />
          <button type="button" className="xp-btn save backup-save" onClick={() => p.onSaveSettings({ visionModel: s.visionModel.trim(), visionBackups: s.visionBackups ?? [] })}>
            Kaydet
          </button>
          <datalist id="vision-model-list">
            {p.models
              .filter((m) => m.vision)
              .map((m) => (
                <option key={m.id} value={m.id} />
              ))}
          </datalist>
          {visionInfo && !visionInfo.vision && (
            <p className="hint warn">Bu model ekran görüntüsü göremiyor; görsel destekli bir model seç.</p>
          )}
          {visionInfo?.vision && <p className="hint ok">Görsel destekli model.</p>}
          <div className="chips">
            {VISION_PRESETS.map((m) => (
              <button type="button" key={m} className="chip" onClick={() => set({ visionModel: m })}>
                {m.split('/')[1]}
              </button>
            ))}
          </div>
          <div className="field-row">
            <button type="button" className="xp-btn primary" onClick={p.onTestVision}>
              Görsel Test (ekranı anlat)
            </button>
          </div>
        </div>
      </fieldset>
      <fieldset className="xp-group">
        <legend>İnisiyatif modeli</legend>
        <div className="field">
          <label htmlFor="agentModel">Model adı</label>
          <ModelChain
            primary={s.agentModel}
            backups={s.agentBackups}
            listId="agent-model-list"
            inputId="agentModel"
            placeholder="bytedance/ui-tars-1.5-7b"
            onChange={(agentModel, agentBackups) => set({ agentModel, agentBackups })}
          />
          <button type="button" className="xp-btn save backup-save" onClick={() => p.onSaveSettings({ agentModel: s.agentModel.trim(), agentBackups: s.agentBackups ?? [] })}>
            Kaydet
          </button>
          <datalist id="agent-model-list">
            {p.models
              .filter((m) => m.vision)
              .map((m) => (
                <option key={m.id} value={m.id} />
              ))}
          </datalist>
          <div className="chips">
            {AGENT_PRESETS.map((m) => (
              <button type="button" key={m} className="chip" onClick={() => set({ agentModel: m })}>
                {m.split('/')[1]}
              </button>
            ))}
          </div>
        </div>
      </fieldset>

      <label className="check">
        <input
          type="checkbox"
          checked={s.hideWhileRunning}
          onChange={(e) => p.onSaveSettings({ hideWhileRunning: e.target.checked })}
        />
        Çalışırken bu pencereyi küçült (Ctrl+Shift+Q durdurur)
      </label>

      <div className="field">
        <label htmlFor="target">Hedef pencere</label>
        <SaveRow onSave={() => p.onSaveSettings({ targetWindow: s.targetWindow })}>
          <select id="target" className="xp-select" value={s.targetWindow} onChange={(e) => set({ targetWindow: e.target.value })}>
            <option value="">Tüm ekran</option>
            {s.targetWindow && !p.windows.some((w) => w.title === s.targetWindow) && (
              <option value={s.targetWindow}>{s.targetWindow}</option>
            )}
            {p.windows.map((w) => (
              <option key={w.handle + w.title} value={w.title}>
                {w.title}
              </option>
            ))}
          </select>
          <button type="button" className="xp-btn" onClick={p.onRefreshWindows} title="Pencereleri yenile">
            ↻
          </button>
        </SaveRow>
        {s.targetWindow && p.windows.length > 0 && !p.windows.some((w) => w.title === s.targetWindow) ? (
          <p className="hint warn">
            “{s.targetWindow}” şu an açık değil; çalışırken tüm ekran okunur.{' '}
            <button type="button" className="link-btn" onClick={() => p.onSaveSettings({ targetWindow: '' })}>
              Tüm ekran yap
            </button>
          </p>
        ) : (
          <p className="hint">Seçilirse sadece o pencere okunur ve öne getirilir. “Tüm ekran” masaüstü ve görev çubuğu dahil her şeyi okur.</p>
        )}
      </div>

      <div className="field">
        <label htmlFor="delay">Adımlar arası bekleme (ms)</label>
        <SaveRow onSave={() => p.onSaveSettings({ stepDelayMs: s.stepDelayMs })}>
          <input id="delay" className="xp-input" type="number" min={0} step={100} value={s.stepDelayMs} onChange={(e) => set({ stepDelayMs: Math.max(0, Number(e.target.value) || 0) })} />
        </SaveRow>
      </div>

      <div className="field">
        <label htmlFor="maxSteps">Maks. adım (sonsuz döngü koruması)</label>
        <SaveRow onSave={() => p.onSaveSettings({ maxSteps: s.maxSteps })}>
          <input id="maxSteps" className="xp-input" type="number" min={1} value={s.maxSteps} onChange={(e) => set({ maxSteps: Math.max(1, Number(e.target.value) || 1) })} />
        </SaveRow>
      </div>

      <button type="button" className="xp-btn save block" onClick={() => p.onSaveSettings(s)}>
        Tümünü Kaydet
      </button>
    </div>
  )
}

export default function SidePanel(p: Props) {
  return (
    <aside className="side-panel">
      <div className="tabs">
        {(
          [
            ['node', p.selectedEdge ? 'Bağlantı' : 'Node'],
            ['llm', 'LLM'],
            ['settings', 'Ayarlar'],
            ['agent', 'Ajan'],
            ['canvases', 'Tuvaller'],
          ] as [SideTab, string][]
        ).map(([k, label]) => (
          <button type="button" key={k} className={`tab ${p.tab === k ? 'active' : ''}`} onClick={() => p.onTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="panel-body" style={{ overflow: p.tab === 'node' ? 'hidden' : undefined }}>
        <div className="node-tab-content" style={{ display: p.tab === 'node' ? undefined : 'none' }}>
          <NodeNavigator graph={p.graph} name={p.locationName ?? p.canvasName} locationKey={p.locationKey ?? p.canvasKey}
            disabled={p.navigationDisabled} active={p.tab === 'node'} inspecting={!!p.selected || !!p.selectedEdge} onNavigate={p.onNavigateNode}
            onBack={p.onNavigateBack} onForward={p.onNavigateForward} onOut={p.onNavigateOut}
            canBack={p.canNavigateBack} canForward={p.canNavigateForward} canOut={p.canNavigateOut}
            stepStatus={p.stepStatus} highlightedNodeIds={p.highlightedNodeIds} runPhase={p.runPhase} />
          {p.tab === 'node' && (p.selected || p.selectedEdge) && <fieldset className="node-inspector" disabled={p.disabled}><NodeInspector {...p} /></fieldset>}
        </div>
        {p.tab === 'llm' && <fieldset className="panel-fields" disabled={p.disabled}><LlmPanel settings={p.settings} onSave={p.onSaveSettings} /></fieldset>}
        {p.tab === 'settings' && <Settings {...p} />}
        {p.tab === 'agent' && <fieldset className="panel-fields" disabled={p.disabled}><AgentTab settings={p.settings} onSaveSettings={p.onSaveSettings} /></fieldset>}
        {p.canvasPanel && <div className="canvas-tab-content" style={{ display: p.tab === 'canvases' ? undefined : 'none' }}>{p.canvasPanel}<div className="library-brand"><NubboMascot /></div></div>}
      </div>
    </aside>
  )
}
