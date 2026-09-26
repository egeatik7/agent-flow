import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import {
  NODE_SPECS,
  TEMPLATE_VARS,
  VISION_KINDS,
  baseName,
  listItems,
  type AgentEdge,
  type AgentGraph,
  type AgentNode,
  type AppSettings,
  type ClickMode,
  type ModelInfo,
} from '../types'

export type SideTab = 'node' | 'settings'

type Props = {
  tab: SideTab
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
  selected: AgentNode | null
  selectedEdge: AgentEdge | null
  onUpdateNode: (patch: Partial<AgentNode>) => void
  onDeleteNode: () => void
  onDeleteEdge: () => void
  onCaptureForNode: () => void
  onOpenScanner: () => void
  onFillFromFolder: (extensions: string[]) => void
  capturing: number
}

const KEY_PRESETS: { label: string; keys: string }[] = [
  { label: 'Enter', keys: '{ENTER}' },
  { label: 'Tab', keys: '{TAB}' },
  { label: 'Esc', keys: '{ESC}' },
  { label: 'Ctrl+A', keys: '^a' },
  { label: 'Ctrl+C', keys: '^c' },
  { label: 'Ctrl+V', keys: '^v' },
  { label: 'Ctrl+S', keys: '^s' },
  { label: 'Alt+F4', keys: '%{F4}' },
  { label: 'Win', keys: '^{ESC}' },
  { label: 'F5', keys: '{F5}' },
  { label: '↓', keys: '{DOWN}' },
  { label: '↑', keys: '{UP}' },
]

const VISION_PRESETS = [
  'google/gemini-3.8-flash',
  'google/gemini-3.5-flash-lite',
  'google/gemini-2.5-flash',
  'anthropic/claude-sonnet-5',
  'qwen/qwen2.5-vl-72b-instruct',
]

const CLICK_MODES: { key: ClickMode; label: string }[] = [
  { key: 'left', label: 'Tek tık' },
  { key: 'double', label: 'Çift tık' },
  { key: 'right', label: 'Sağ tık' },
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
        <p className="hint">
          Kayıtlı: <b>“{loc.text || loc.name || loc.controlType}”</b> ({loc.controlType})
          {loc.windowTitle ? <> — {loc.windowTitle}</> : null}
        </p>
      ) : n.anchor ? (
        <p className="hint">Son bilinen konum: {n.anchor.x}, {n.anchor.y} (aynı yazı birden çok yerdeyse buna en yakın olan seçilir)</p>
      ) : (
        <p className="hint">Çalışırken ekran okunur, prompt’taki yazı aranır; bulunamazsa LLM ekrandaki yazılardan seçer.</p>
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

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff']

function VarChips({ onInsert }: { onInsert: (v: string) => void }) {
  return (
    <div className="var-chips">
      <span>Değişken:</span>
      {TEMPLATE_VARS.map((v) => (
        <button type="button" key={v} className="chip var" onClick={() => onInsert(v)} title="Alanın sonuna ekle">
          {v}
        </button>
      ))}
    </div>
  )
}

const append = (cur: string | undefined, v: string) => {
  const c = cur ?? ''
  return c && !/\s$/.test(c) && !/[\\/]$/.test(c) ? `${c} ${v}` : c + v
}

function LoopEditor(p: Props & { n: AgentNode }) {
  const { n } = p
  const [imagesOnly, setImagesOnly] = useState(true)
  const items = listItems(n)
  const idx = items.length ? Math.min(Math.max(0, n.loopIndex ?? 0), items.length - 1) : 0
  return (
    <>
      <div className="field">
        <label>Liste (her satır bir tur)</label>
        <textarea
          className="xp-textarea mono list-area"
          value={(n.items ?? []).join('\n')}
          placeholder={'C:\\Resimler\\kedi.png\nC:\\Resimler\\köpek.png\n…'}
          onChange={(e) => p.onUpdateNode({ items: e.target.value.split('\n') })}
        />
        <div className="field-row wrap">
          <button type="button" className="xp-btn primary" onClick={() => p.onFillFromFolder(imagesOnly ? IMAGE_EXTS : [])}>
            Klasörden doldur…
          </button>
          <label className="check inline">
            <input type="checkbox" checked={imagesOnly} onChange={(e) => setImagesOnly(e.target.checked)} />
            sadece resimler
          </label>
          {items.length > 0 && (
            <button type="button" className="xp-btn" onClick={() => p.onUpdateNode({ items: [], folder: undefined, loopIndex: 0 })}>
              Listeyi temizle
            </button>
          )}
        </div>
        {n.folder && <p className="hint mono">{n.folder}</p>}
      </div>

      {items.length > 0 ? (
        <div className="field loop-progress">
          <label>İlerleme</label>
          <div className="progress">
            <div className="progress-bar" style={{ width: `${(idx / items.length) * 100}%` }} />
          </div>
          <p className="hint">
            Sıradaki: <b>{idx + 1}/{items.length}</b> — {baseName(items[idx])}
            {idx > 0 ? ' (öncekiler bitti, kaldığı yerden devam eder)' : ''}
          </p>
          {idx > 0 && (
            <button type="button" className="xp-btn" onClick={() => p.onUpdateNode({ loopIndex: 0 })}>
              Baştan başla
            </button>
          )}
        </div>
      ) : (
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

      <p className="hint">
        Döngüyü tekrar eden kısmın <b>sonuna</b> koy, “tekrar” çıkışını o kısmın <b>ilk</b> node’una bağla. Değişen yerlere{' '}
        <span className="mono">{'{{öğe}}'}</span> yaz: her turda listenin sıradaki satırı gelir.{' '}
        <span className="mono">{'{{öğe.isim}}'}</span> uzantısız dosya adıdır (kedi.png → kedi).
      </p>
    </>
  )
}

function VisionToggle(p: Props & { n: AgentNode }) {
  const { n } = p
  const on = !!n.useVision
  const model = (p.settings.visionModel || p.settings.model).trim()
  const what: Partial<Record<AgentNode['kind'], string>> = {
    click: 'Tıklanacak yeri görsel LLM ekran görüntüsüne bakarak bulur (ikon, resim, yazısız butonlar dahil).',
    type: 'Yazılacak alanı görsel LLM ekran görüntüsüne bakarak bulur.',
    key: 'Tuşlardan önce aşağıdaki yere ekran görüntüsüne bakarak tıklar (odaklanmak için).',
    waitFor: 'Her kontrolde ekran görüntüsü alınır, görsel LLM’e “bu durum var mı?” diye sorulur.',
    condition: 'Ekran görüntüsü alınır, görsel LLM’e “bu durum var mı?” diye sorulur.',
  }
  return (
    <div className={`vision-box${on ? ' on' : ''}`}>
      <label className="check vision-check">
        <input type="checkbox" checked={on} onChange={(e) => p.onUpdateNode({ useVision: e.target.checked })} />
        <span>
          <b>Ekran görüntüsüne bakarak yap</b>
          <small>{what[n.kind]}</small>
        </span>
      </label>
      {on && (
        <p className="hint">
          Model: <span className="mono">{model || '—'}</span>{' '}
          <button type="button" className="link-btn" onClick={() => p.onTab('settings')}>
            değiştir
          </button>
          {!p.settings.apiKey && <><br /><b className="warn-text">API anahtarı kayıtlı değil.</b></>}
        </p>
      )}
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
          <li>“Tıkla” node’una ekranda gördüğün yazıyı yaz: <b>Opera’ya tıkla</b>, <b>Model Seç’e bas</b>. Ajan ekranı okuyup o yazının üstüne tıklar.</li>
          <li>Yazıyı tırnak içine alırsan (<b>“Modeli İndir” yazan yere bas</b>) birebir aranır, LLM’e gerek kalmaz.</li>
          <li><b>Ekrandan Seç</b> ile ekrandaki yazıları görüp doğrudan birini seçebilirsin.</li>
          <li>Node’un sağındaki <b>+</b> ile ileriye node ekle; renkli noktayı sürükleyip başka node’a bırakarak bağla.</li>
          <li>Son node’u ilk aşamaya bağlarsan akış başa döner; sayılı tekrar için <b>Döngü</b>.</li>
          <li>Çalışırken uygulama küçülür; <b>Ctrl+Shift+Q</b> ile durdurursun.</li>
        </ul>
      </div>
    )
  }
  const spec = NODE_SPECS[n.kind]
  const upd = p.onUpdateNode

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

      {VISION_KINDS.includes(n.kind) && <VisionToggle {...p} n={n} />}

      {n.kind === 'click' && (
        <>
          <div className="field">
            <label>Neye tıklanacak?</label>
            <textarea
              className="xp-textarea"
              value={n.prompt ?? ''}
              placeholder={
              n.useVision
                ? 'Örn: sağ üstteki dişli simgesine tıkla\nveya: ilk videonun küçük resmine bas'
                : 'Örn: Opera’ya tıkla\nveya: “Modeli İndir” yazan butona bas'
            }
              onChange={(e) => upd({ prompt: e.target.value })}
            />
            <VarChips onInsert={(v) => upd({ prompt: append(n.prompt, v) })} />
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
            <p className="hint">Masaüstü simgeleri genelde çift tık ister.</p>
          </div>
          {!n.useVision && <TargetBox {...p} n={n} />}
        </>
      )}

      {n.kind === 'type' && (
        <>
          <div className="field">
            <label>Yazılacak metin</label>
            <input
              className="xp-input"
              value={n.text ?? ''}
              placeholder="Örn: {{öğe}}  veya  D:\Modeller\{{öğe.isim}}.glb"
              onChange={(e) => upd({ text: e.target.value })}
            />
            <VarChips onInsert={(v) => upd({ text: append(n.text, v) })} />
          </div>
          <div className="field">
            <label>Hangi alana? (boşsa o an seçili alana yazar)</label>
            <input
              className="xp-input"
              value={n.prompt ?? ''}
              placeholder="Örn: “Ara” kutusu"
              onChange={(e) => upd({ prompt: e.target.value })}
            />
          </div>
          <label className="check">
            <input type="checkbox" checked={n.clearFirst !== false} onChange={(e) => upd({ clearFirst: e.target.checked })} />
            Önce alandaki yazıyı sil (Ctrl+A)
          </label>
          <label className="check">
            <input type="checkbox" checked={!!n.pressEnter} onChange={(e) => upd({ pressEnter: e.target.checked })} />
            Yazdıktan sonra Enter’a bas
          </label>
          {!n.useVision && (n.prompt?.trim() || n.locator) && <TargetBox {...p} n={n} />}
        </>
      )}

      {n.kind === 'key' && (
        <div className="field">
          <label>Tuş (SendKeys biçimi)</label>
          <input className="xp-input mono" value={n.keys ?? ''} onChange={(e) => upd({ keys: e.target.value })} />
          <VarChips onInsert={(v) => upd({ keys: append(n.keys, v) })} />
          <div className="chips">
            {KEY_PRESETS.map((k) => (
              <button type="button" key={k.keys} className="chip" onClick={() => upd({ keys: k.keys })}>
                {k.label}
              </button>
            ))}
          </div>
          <p className="hint">^ = Ctrl, % = Alt, + = Shift. Örn: ^s kaydet, %{'{'}TAB{'}'} pencere değiştir.</p>
          {n.useVision && (
            <>
              <label>Önce tıklanacak yer (görsel)</label>
              <input
                className="xp-input"
                value={n.prompt ?? ''}
                placeholder="Örn: adres çubuğu"
                onChange={(e) => upd({ prompt: e.target.value })}
              />
            </>
          )}
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
          <label>{n.useVision ? 'Ekranda ne görünmeli? (serbest tarif)' : 'Ekranda aranacak yazı'}</label>
          <div className="field-row">
            <input
              className="xp-input"
              value={n.text ?? ''}
              placeholder={n.useVision ? 'Örn: indirme çubuğu %100 olmuş' : 'Örn: İndirme tamamlandı'}
              onChange={(e) => upd({ text: e.target.value })}
            />
            {!n.useVision && (
              <button type="button" className="xp-btn" onClick={p.onOpenScanner}>
                Ekrandan
              </button>
            )}
          </div>
          <VarChips onInsert={(v) => upd({ text: append(n.text, v) })} />
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

      {n.kind === 'loop' && <LoopEditor {...p} n={n} />}

      <button type="button" className="xp-btn danger block" onClick={p.onDeleteNode}>
        Node’u Sil (Del)
      </button>
    </div>
  )
}

function Settings(p: Props) {
  const s = p.settings
  const set = (patch: Partial<AppSettings>) => p.setSettings((prev) => ({ ...prev, ...patch }))
  const model = p.models.find((m) => m.id === s.model.trim())
  const visionInfo = p.models.find((m) => m.id === s.visionModel.trim())
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
            <option key={m.id} value={m.id} label={m.vision ? 'görsel destekli' : undefined} />
          ))}
        </datalist>
        {model && (
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
        </div>
      </div>

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
        <p className="hint">
          “Ekran görüntüsüne bakarak yap” açık olan node’lar bu modeli kullanır. Aynı OpenRouter anahtarı kullanılır; model
          görsel destekli olmalı.
        </p>
        <div className="field">
          <label htmlFor="visionModel">Görsel model adı</label>
          <SaveRow onSave={() => p.onSaveSettings({ visionModel: s.visionModel.trim() })}>
            <input
              id="visionModel"
              className="xp-input"
              list="vision-model-list"
              value={s.visionModel}
              placeholder="google/gemini-3.8-flash"
              onChange={(e) => set({ visionModel: e.target.value })}
            />
          </SaveRow>
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
            ['settings', 'Ayarlar'],
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
      </div>
    </aside>
  )
}
