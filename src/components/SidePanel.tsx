import type { Dispatch, ReactNode, SetStateAction } from 'react'
import {
  NODE_SPECS,
  type A11yNode,
  type AgentEdge,
  type AgentGraph,
  type AgentNode,
  type AppSettings,
} from '../types'
import TreeView from './TreeView'

export type SideTab = 'node' | 'settings' | 'tree'

type Props = {
  tab: SideTab
  onTab: (t: SideTab) => void
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  onSaveSettings: (partial: Partial<AppSettings>) => void
  windows: { title: string; handle: string }[]
  onRefreshWindows: () => void
  models: string[]
  onLoadModels: () => void
  onTestApi: () => void
  graph: AgentGraph
  selected: AgentNode | null
  selectedEdge: AgentEdge | null
  onUpdateNode: (patch: Partial<AgentNode>) => void
  onDeleteNode: () => void
  onDeleteEdge: () => void
  onCaptureForNode: () => void
  capturing: number
  tree: A11yNode | null
  treeLoading: boolean
  onRefreshTree: () => void
  onPickTreeNode: (n: A11yNode) => void
}

const KEY_PRESETS: { label: string; keys: string }[] = [
  { label: 'Enter', keys: '{ENTER}' },
  { label: 'Tab', keys: '{TAB}' },
  { label: 'Esc', keys: '{ESC}' },
  { label: 'Ctrl+A', keys: '^a' },
  { label: 'Ctrl+C', keys: '^c' },
  { label: 'Ctrl+V', keys: '^v' },
  { label: 'Alt+F4', keys: '%{F4}' },
  { label: 'F5', keys: '{F5}' },
  { label: '↓', keys: '{DOWN}' },
  { label: '↑', keys: '{UP}' },
]

function SaveRow(props: { children: ReactNode; onSave: () => void; saveLabel?: string }) {
  return (
    <div className="field-row">
      {props.children}
      <button type="button" className="xp-btn save" onClick={props.onSave}>
        {props.saveLabel ?? 'Kaydet'}
      </button>
    </div>
  )
}

function NodeInspector(p: Props) {
  const n = p.selected
  if (p.selectedEdge) {
    const from = p.graph.nodes.find((x) => x.id === p.selectedEdge!.from)
    const to = p.graph.nodes.find((x) => x.id === p.selectedEdge!.to)
    const port = from ? NODE_SPECS[from.kind].outputs.find((o) => o.key === p.selectedEdge!.fromPort)?.label : ''
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
  if (!n) {
    return (
      <div className="hint-block">
        <p className="hint"><b>Nasıl kullanılır?</b></p>
        <ul className="hint-list">
          <li>Node’un sağındaki <b>+</b> ile ileriye yeni node ekle (araya da eklenir).</li>
          <li>Sarı/renkli çıkış noktasını <b>sürükle</b>, başka bir node’un üstüne bırak → bağlanır.</li>
          <li>Son node’dan ilk node’a bağlarsan akış <b>başa döner</b>. Sayılı tekrar için <b>Döngü</b> node’u kullan.</li>
          <li>Bağlantıya tıklayıp <b>Del</b> ile sil, çift tıklayınca da silinir.</li>
          <li>Boş yere <b>sağ tık</b> → istediğin türde node ekle. Node’a sağ tık → buradan çalıştır / kopyala / sil.</li>
          <li><b>Kayıt</b> açıkken hedef uygulamada tıkladığın her öğe sıradaki “Tıkla” node’u olur.</li>
        </ul>
      </div>
    )
  }
  const spec = NODE_SPECS[n.kind]
  const upd = p.onUpdateNode
  const needsLocator = n.kind === 'click' || n.kind === 'type'

  return (
    <div>
      <div className="inspector-kind" style={{ background: spec.color }}>
        {spec.icon} {spec.label}
      </div>
      <p className="hint">{spec.description}</p>

      <div className="field">
        <label>Başlık</label>
        <input className="xp-input" value={n.title} onChange={(e) => upd({ title: e.target.value })} />
      </div>

      {needsLocator && (
        <div className="field">
          <label>{n.kind === 'type' ? 'Hangi alana? (LLM prompt’u)' : 'Neye basılacak? (LLM prompt’u)'}</label>
          <textarea
            className="xp-textarea"
            value={n.prompt ?? ''}
            placeholder={n.kind === 'type' ? 'Örn: üstteki arama kutusu' : 'Örn: tepedeki “Hunyuan Tencent” sekmesine bas'}
            onChange={(e) => upd({ prompt: e.target.value })}
          />
        </div>
      )}

      {n.kind === 'type' && (
        <>
          <div className="field">
            <label>Yazılacak metin</label>
            <input className="xp-input" value={n.text ?? ''} onChange={(e) => upd({ text: e.target.value })} />
          </div>
          <label className="check">
            <input type="checkbox" checked={!!n.pressEnter} onChange={(e) => upd({ pressEnter: e.target.checked })} />
            Yazdıktan sonra Enter’a bas
          </label>
        </>
      )}

      {n.kind === 'key' && (
        <div className="field">
          <label>Tuş (SendKeys biçimi)</label>
          <input className="xp-input mono" value={n.keys ?? ''} onChange={(e) => upd({ keys: e.target.value })} />
          <div className="chips">
            {KEY_PRESETS.map((k) => (
              <button type="button" key={k.keys} className="chip" onClick={() => upd({ keys: k.keys })}>
                {k.label}
              </button>
            ))}
          </div>
          <p className="hint">^ = Ctrl, % = Alt, + = Shift. Örn: ^s kaydet, %{'{'}TAB{'}'} pencere değiştir.</p>
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

      {(n.kind === 'waitFor' || n.kind === 'condition') && (
        <div className="field">
          <label>Ekranda aranacak yazı (öğe adı içerir)</label>
          <input className="xp-input" value={n.text ?? ''} placeholder="Örn: İndirme tamamlandı" onChange={(e) => upd({ text: e.target.value })} />
        </div>
      )}

      {n.kind === 'waitFor' && (
        <div className="field">
          <label>En fazla bekleme (saniye)</label>
          <input
            className="xp-input"
            type="number"
            min={1}
            value={Math.round((n.timeoutMs ?? 15000) / 1000)}
            onChange={(e) => upd({ timeoutMs: Math.max(1, Number(e.target.value) || 1) * 1000 })}
          />
        </div>
      )}

      {n.kind === 'loop' && (
        <div className="field">
          <label>Tekrar sayısı</label>
          <input
            className="xp-input"
            type="number"
            min={1}
            value={n.count ?? 1}
            onChange={(e) => upd({ count: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
          />
          <p className="hint">“tekrar” çıkışını başa (örn. ilk Tıkla node’una) bağla, “bitti” çıkışını devam edilecek yere.</p>
        </div>
      )}

      {needsLocator && (
        <div className="field locator-box">
          <label>Kayıtlı accessibility öğesi</label>
          {n.locator ? (
            <p className="hint">
              <b>{n.locator.controlType}</b> “{n.locator.name || '(isimsiz)'}”
              {n.locator.automationId ? <> #{n.locator.automationId}</> : null}
              <br />
              <span className="mono">{n.locator.windowTitle ? `${n.locator.windowTitle} › ` : ''}{n.locator.path}</span>
            </p>
          ) : (
            <p className="hint">Yok. Çalışırken LLM, prompt’a göre öğeyi accessibility tree’den seçer.</p>
          )}
          <div className="field-row wrap">
            <button type="button" className="xp-btn" disabled={p.capturing > 0} onClick={p.onCaptureForNode}>
              {p.capturing > 0 ? `İmleci hedefe götür… ${p.capturing}` : 'Öğe Yakala (3 sn)'}
            </button>
            <button type="button" className="xp-btn" onClick={() => p.onTab('tree')}>
              Ağaçtan Seç
            </button>
            {n.locator && (
              <button type="button" className="xp-btn" onClick={() => upd({ locator: undefined })}>
                Temizle
              </button>
            )}
          </div>
        </div>
      )}

      <button type="button" className="xp-btn danger block" onClick={p.onDeleteNode}>
        Node’u Sil (Del)
      </button>
    </div>
  )
}

function Settings(p: Props) {
  const s = p.settings
  const set = (patch: Partial<AppSettings>) => p.setSettings((prev) => ({ ...prev, ...patch }))
  return (
    <div className="settings-grid">
      <p className="hint">Her ayarın yanındaki <b>Kaydet</b> ile kalıcı olarak saklanır.</p>

      <div className="field">
        <label htmlFor="apiKey">OpenRouter API Key</label>
        <SaveRow onSave={() => p.onSaveSettings({ apiKey: s.apiKey.trim() })}>
          <input id="apiKey" className="xp-input" type="password" value={s.apiKey} placeholder="sk-or-v1-..." onChange={(e) => set({ apiKey: e.target.value })} />
        </SaveRow>
      </div>

      <div className="field">
        <label htmlFor="model">Model adı</label>
        <SaveRow onSave={() => p.onSaveSettings({ model: s.model.trim() })}>
          <input id="model" className="xp-input" list="model-list" value={s.model} placeholder="openai/gpt-4o-mini" onChange={(e) => set({ model: e.target.value })} />
        </SaveRow>
        <datalist id="model-list">
          {p.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <div className="field-row">
          <button type="button" className="xp-btn" onClick={p.onLoadModels}>
            Model listesini getir{p.models.length ? ` (${p.models.length})` : ''}
          </button>
          <button type="button" className="xp-btn primary" onClick={p.onTestApi}>
            API Test
          </button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="target">Hedef pencere</label>
        <SaveRow onSave={() => p.onSaveSettings({ targetWindow: s.targetWindow })}>
          <select id="target" className="xp-select" value={s.targetWindow} onChange={(e) => set({ targetWindow: e.target.value })}>
            <option value="">(kayıtlı öğenin penceresi)</option>
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

      <div className="field">
        <label htmlFor="depth">Accessibility tree derinliği</label>
        <SaveRow onSave={() => p.onSaveSettings({ maxTreeDepth: s.maxTreeDepth })}>
          <input id="depth" className="xp-input" type="number" min={3} max={25} value={s.maxTreeDepth} onChange={(e) => set({ maxTreeDepth: Math.min(25, Math.max(3, Number(e.target.value) || 12)) })} />
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
            ['settings', 'Ayarlar'],
            ['tree', 'Ağaç'],
          ] as [SideTab, string][]
        ).map(([k, label]) => (
          <button type="button" key={k} className={`tab ${p.tab === k ? 'active' : ''}`} onClick={() => p.onTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {p.tab === 'node' && <NodeInspector {...p} />}
        {p.tab === 'settings' && <Settings {...p} />}
        {p.tab === 'tree' && (
          <div>
            <div className="field-row">
              <button type="button" className="xp-btn" onClick={p.onRefreshTree} disabled={p.treeLoading}>
                {p.treeLoading ? 'Okunuyor…' : 'Ağacı Yenile'}
              </button>
            </div>
            <p className="hint">
              {p.selected && (p.selected.kind === 'click' || p.selected.kind === 'type')
                ? `Bir öğeye tıkla → “${p.selected.title}” node’una bağlanır.`
                : 'Bir Tıkla/Yazı Yaz node’u seç, sonra buradan öğeye tıkla.'}
            </p>
            {p.tree ? (
              <TreeView node={p.tree} onPick={p.onPickTreeNode} depth={0} />
            ) : (
              <p className="hint">{p.treeLoading ? 'Hedef pencerenin accessibility tree’si okunuyor…' : 'Hedef pencereyi seçip “Ağacı Yenile”ye bas.'}</p>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
