import type { Dispatch, SetStateAction } from 'react'
import type { A11yNode, AgentNode, AppSettings } from '../types'
import TreeView from './TreeView'

type Props = {
  tab: 'settings' | 'node' | 'tree'
  onTab: (t: 'settings' | 'node' | 'tree') => void
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  onSaveSettings: (partial: Partial<AppSettings>) => Promise<void>
  windows: { title: string; handle: string }[]
  onRefreshWindows: () => void
  selected: AgentNode | null
  onUpdateNode: (patch: Partial<AgentNode>) => void
  onClearRecorded: () => void
  tree: A11yNode | null
  onPickTreeNode: (n: A11yNode) => void
  onTestApi: () => void
}

export default function SidePanel(props: Props) {
  const { settings, selected } = props

  return (
    <aside className="side-panel">
      <div className="tabs">
        <button
          type="button"
          className={`tab ${props.tab === 'settings' ? 'active' : ''}`}
          onClick={() => props.onTab('settings')}
        >
          Ayarlar
        </button>
        <button
          type="button"
          className={`tab ${props.tab === 'node' ? 'active' : ''}`}
          onClick={() => props.onTab('node')}
        >
          Node
        </button>
        <button
          type="button"
          className={`tab ${props.tab === 'tree' ? 'active' : ''}`}
          onClick={() => props.onTab('tree')}
        >
          Ağaç
        </button>
      </div>
      <div className="panel-body">
        {props.tab === 'settings' && (
          <div className="settings-grid">
            <p className="hint">
              OpenRouter anahtarı ve model adı kaydedilir. Kayıt gerektiren her
              alanın yanında kayıt tuşu var.
            </p>
            <div className="field">
              <label htmlFor="apiKey">OpenRouter API Key</label>
              <div className="field-row">
                <input
                  id="apiKey"
                  className="xp-input"
                  type="password"
                  value={settings.apiKey}
                  placeholder="sk-or-..."
                  onChange={(e) =>
                    props.setSettings((s) => ({ ...s, apiKey: e.target.value }))
                  }
                />
                <button
                  type="button"
                  className="xp-btn save"
                  onClick={() => void props.onSaveSettings({ apiKey: settings.apiKey })}
                >
                  Kaydet
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="model">Model adı</label>
              <div className="field-row">
                <input
                  id="model"
                  className="xp-input"
                  value={settings.model}
                  placeholder="openai/gpt-4o-mini"
                  onChange={(e) =>
                    props.setSettings((s) => ({ ...s, model: e.target.value }))
                  }
                />
                <button
                  type="button"
                  className="xp-btn save"
                  onClick={() => void props.onSaveSettings({ model: settings.model })}
                >
                  Kaydet
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="target">Hedef pencere</label>
              <div className="field-row">
                <select
                  id="target"
                  className="xp-select"
                  value={settings.targetWindow}
                  onChange={(e) =>
                    props.setSettings((s) => ({
                      ...s,
                      targetWindow: e.target.value,
                    }))
                  }
                >
                  <option value="">(odaklı / demo)</option>
                  {props.windows.map((w) => (
                    <option key={w.handle + w.title} value={w.title}>
                      {w.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="xp-btn"
                  onClick={props.onRefreshWindows}
                  title="Pencereleri yenile"
                >
                  ↻
                </button>
                <button
                  type="button"
                  className="xp-btn save"
                  onClick={() =>
                    void props.onSaveSettings({
                      targetWindow: settings.targetWindow,
                    })
                  }
                >
                  Kaydet
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="depth">Ağaç derinliği</label>
              <div className="field-row">
                <input
                  id="depth"
                  className="xp-input"
                  type="number"
                  min={3}
                  max={15}
                  value={settings.maxTreeDepth}
                  onChange={(e) =>
                    props.setSettings((s) => ({
                      ...s,
                      maxTreeDepth: Number(e.target.value) || 8,
                    }))
                  }
                />
                <button
                  type="button"
                  className="xp-btn save"
                  onClick={() =>
                    void props.onSaveSettings({
                      maxTreeDepth: settings.maxTreeDepth,
                    })
                  }
                >
                  Kaydet
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="delay">Aşama gecikmesi (ms)</label>
              <div className="field-row">
                <input
                  id="delay"
                  className="xp-input"
                  type="number"
                  min={0}
                  step={100}
                  value={settings.stepDelayMs}
                  onChange={(e) =>
                    props.setSettings((s) => ({
                      ...s,
                      stepDelayMs: Number(e.target.value) || 0,
                    }))
                  }
                />
                <button
                  type="button"
                  className="xp-btn save"
                  onClick={() =>
                    void props.onSaveSettings({
                      stepDelayMs: settings.stepDelayMs,
                    })
                  }
                >
                  Kaydet
                </button>
              </div>
            </div>
            <div className="field-row">
              <button type="button" className="xp-btn primary" onClick={props.onTestApi}>
                API Test
              </button>
              <button
                type="button"
                className="xp-btn save"
                onClick={() => void props.onSaveSettings(settings)}
              >
                Tümünü Kaydet
              </button>
            </div>
          </div>
        )}

        {props.tab === 'node' && (
          <div>
            {!selected ? (
              <p className="hint">Canvas’tan bir node seç veya yeni ekle.</p>
            ) : (
              <>
                <div className="field">
                  <label>Başlık</label>
                  <input
                    className="xp-input"
                    value={selected.title}
                    onChange={(e) => props.onUpdateNode({ title: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Aşama prompt’u</label>
                  <textarea
                    className="xp-textarea"
                    value={selected.prompt}
                    placeholder='Örn: Tepeye "Hunyuan Tencent" yazısına bas'
                    onChange={(e) => props.onUpdateNode({ prompt: e.target.value })}
                  />
                </div>
                {selected.recorded ? (
                  <div className="field">
                    <label>Kayıtlı a11y öğesi</label>
                    <p className="hint">
                      {selected.recorded.controlType} — {selected.recorded.name}
                      <br />
                      path: {selected.recorded.path}
                    </p>
                    <button
                      type="button"
                      className="xp-btn"
                      onClick={props.onClearRecorded}
                    >
                      Kayıtı temizle (LLM ile çöz)
                    </button>
                  </div>
                ) : (
                  <p className="hint">
                    Kayıtlı öğe yoksa ajan, OpenRouter ile accessibility tree’den
                    prompt’a göre öğeyi seçer.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {props.tab === 'tree' && (
          <div>
            <p className="hint">
              Öğeye tıkla → seçili node’un prompt’una ve kayıtlı path’ine yazılır.
            </p>
            {props.tree ? (
              <TreeView node={props.tree} onPick={props.onPickTreeNode} />
            ) : (
              <p className="hint">Toolbar’dan “Accessibility Tree” çek.</p>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
