import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import {
  NODE_SPECS,
  TEMPLATE_VARS,
  portLabel,
  VISION_KINDS,
  listItems,
  type AgentEdge,
  type AgentGraph,
  type AgentNode,
  type AppSettings,
  type PathStep,
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
  selectedCount?: number
  selectedEdge: AgentEdge | null
  onUpdateNode: (patch: Partial<AgentNode>) => void
  onDeleteNode: () => void
  onDeleteEdge: () => void
  onCaptureForNode: () => void
  onOpenScanner: () => void
  onFillFromFolder: (extensions: string[]) => void
  onPickDir: () => Promise<string | null>
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

const AGENT_PRESETS = ['bytedance/ui-tars-1.5-7b', 'google/gemini-3.8-flash', 'anthropic/claude-sonnet-5']

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
        <>
          <p className="hint">
            Yakalanan: <b>{loc.text || loc.name ? `“${loc.text || loc.name}”` : 'yazısız öğe'}</b> ({loc.controlType})
            {loc.windowTitle ? <> — {loc.windowTitle}</> : null}
          </p>
          {loc.icon && (
            <>
              <img className="icon-preview" alt="Seçilen öğenin resmi" src={`data:image/png;base64,${loc.icon}`} />
              <p className="hint">
                Çalışırken sırayla: uygulamanın kendi öğesi, bu resmin ekrandaki aynısı, yazı, en son görsel model (bu resimle birlikte) denenir.
              </p>
            </>
          )}
        </>
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
  const members = (n.members ?? []).length
  return (
    <>
      <p className="hint">
        Her çalıştırmada liste baştan sona gider. İlk turda <span className="mono">{'{{öğe}}'}</span> birinci dosyanın tam yoludur, ikinci turda
        ikinci dosyanın. <span className="mono">{'{{öğe.isim}}'}</span> uzantısız addır (kedi.png → kedi). Yükleme adımının metni{' '}
        <span className="mono">{'{{öğe}}'}</span> olmalı. İlk adım, kutunun içinde kimsenin bağlanmadığı node’dur.
      </p>
      {members === 0 && <p className="hint warn">Kutu boş. Tekrar edecek node’ları çerçevenin içine sürükle ya da seçip Ctrl+G.</p>}
      <div className="field">
        <label>Liste (her satır bir öğe)</label>
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
            <button type="button" className="xp-btn" onClick={() => p.onUpdateNode({ items: [], folder: undefined })}>
              Listeyi temizle
            </button>
          )}
        </div>
        {n.folder && <p className="hint mono">{n.folder}</p>}
      </div>

      {items.length === 0 && (
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
        {last.win ? <> — {last.win.replace(/^web:/, 'sayfa: ')}</> : null}. Her tur ekran yine taze okunur; hafıza sadece benzer adaylar arasında
        karar verirken ve bu tur çok farklı bir şey bulunduğunda devreye girer.
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
        <p className="hint">
          {engine === 'screen' ? (
            <>
              Her adımda ekran görüntüsü alınır, model tıklanacak noktayı doğrudan verir: yazısız ikonlar, 3D görünüm, menüler dahil. Sürükleme,
              kaydırma ve tuş kombinasyonları da yapabilir (Blender’da Shift+A gibi). Model:{' '}
              <span className="mono">{model || '—'}</span>{' '}
              <button type="button" className="link-btn" onClick={() => p.onTab('settings')}>
                değiştir
              </button>
            </>
          ) : (
            <>Ekrandaki (tarayıcıdaysa sayfadaki) yazıların numaralı listesinden seçer. Yazı ağırlıklı formlarda ve web sayfalarında hızlıdır.</>
          )}
        </p>
      </div>
      <div className="field">
        <label>Hedef (ne olmasını istiyorsun?)</label>
        <textarea
          className="xp-textarea"
          value={n.prompt ?? ''}
          placeholder={'Örn: Ayarlar’dan dili Türkçe yap ve kaydet\nveya: çıkan çerez penceresini kapat, sonra “Giriş yap”a bas'}
          onChange={(e) => upd({ prompt: e.target.value })}
        />
        <VarChips onInsert={(v) => upd({ prompt: append(n.prompt, v) })} />
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
      <p className="hint">
        Hedefe ulaşınca <b>tamam</b>, ulaşamazsa <b>olmadı</b> çıkışından devam eder. Model “bitti” dediğinde son ekran görsel modelle ayrıca kontrol
        edilir. Ekran birkaç adımdır değişmiyorsa modele başka yol denemesi söylenir. Ctrl+Shift+Q her an durdurur.
        {engine === 'screen'
          ? ' Başarılı turun adımları kaydedilir; sonraki turda önce bu yol modelsiz oynatılır, ekran kayıttakinden farklılaştığı anda model devreye girer.'
          : ' Başarılı turun eylemleri sonraki turda modele ipucu olarak verilir.'}
      </p>
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

function BrowserEditor(p: Props & { n: AgentNode }) {
  const { n } = p
  const upd = p.onUpdateNode
  return (
    <>
      <div className="field">
        <label>Adres</label>
        <input className="xp-input mono" value={n.url ?? ''} placeholder="https://..." onChange={(e) => upd({ url: e.target.value })} />
        <VarChips onInsert={(v) => upd({ url: append(n.url, v) })} />
      </div>
      <div className="field">
        <label>Tarayıcı</label>
        <div className="seg">
          {(
            [
              ['auto', 'Otomatik'],
              ['msedge', 'Edge'],
              ['chrome', 'Chrome'],
            ] as const
          ).map(([k, label]) => (
            <button type="button" key={k} className={`seg-btn${(n.browser ?? 'auto') === k ? ' active' : ''}`} onClick={() => upd({ browser: k })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="hint">
        Tarayıcı programın kendi profiliyle açılır; siteye bir kez elle giriş yaparsan sonra hep açık kalır. Bu tarayıcı öndeyken Tıkla ve
        Yazı Yaz hedefi sayfanın içinden bulur; bulamazsa ekrana bakar. Dosya seçme penceresine yol doğrudan verilir. İndirmeler
        İndirilenler klasörüne düşer; <b>Dosyayı Bekle</b> ve <b>Dosyayı Taşı</b> ile ad verebilirsin. Açıkken aynı node tekrar gelirse sadece adrese gider.
      </p>
    </>
  )
}

function WaitFileEditor(p: Props & { n: AgentNode }) {
  const { n } = p
  const upd = p.onUpdateNode
  return (
    <>
      <div className="field">
        <label>Klasör (boşsa İndirilenler)</label>
        <div className="field-row">
          <input className="xp-input mono" value={n.folder ?? ''} placeholder="İndirilenler" onChange={(e) => upd({ folder: e.target.value })} />
          <button
            type="button"
            className="xp-btn"
            onClick={async () => {
              const d = await p.onPickDir()
              if (d) upd({ folder: d })
            }}
          >
            Seç…
          </button>
        </div>
      </div>
      <div className="field">
        <label>Dosya türü (boşsa her dosya)</label>
        <input className="xp-input mono" value={n.pattern ?? ''} placeholder="*.glb; *.zip" onChange={(e) => upd({ pattern: e.target.value })} />
      </div>
      <div className="field">
        <label>En fazla bekleme (saniye)</label>
        <input
          className="xp-input"
          type="number"
          min={1}
          value={Math.round((n.timeoutMs ?? 300000) / 1000)}
          onChange={(e) => upd({ timeoutMs: Math.max(1, Number(e.target.value) || 1) * 1000 })}
        />
      </div>
      <p className="hint">
        Akış başladığında klasörde olan dosyalar sayılmaz. Yeni gelen dosya yarım (.crdownload, .part) değilse ve boyutu durduysa hazır sayılır;
        sonraki adımlarda <span className="mono">{'{{dosya}}'}</span> olarak kullanılır.
      </p>
    </>
  )
}

function MoveFileEditor(p: Props & { n: AgentNode }) {
  const { n } = p
  const upd = p.onUpdateNode
  return (
    <>
      <div className="field">
        <label>Hangi dosya?</label>
        <input className="xp-input mono" value={n.source ?? ''} placeholder="{{dosya}}" onChange={(e) => upd({ source: e.target.value })} />
      </div>
      <div className="field">
        <label>Nereye, hangi adla?</label>
        <input
          className="xp-input mono"
          value={n.text ?? ''}
          placeholder="D:\\Modeller\\{{öğe.isim}}.glb"
          onChange={(e) => upd({ text: e.target.value })}
        />
        <VarChips onInsert={(v) => upd({ text: append(n.text, v) })} />
      </div>
      <p className="hint">
        Klasör yoksa oluşturulur. Uzantı yazmazsan dosyanın kendi uzantısı kalır. Aynı adda dosya varsa sonuna (2) eklenir. Sonuna \ koyarsan
        dosya o klasöre kendi adıyla gider.
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
    condition: 'Önce yazı, seçilen öğe ve simge resmi aranır; bulunamazsa görsel LLM’e (seçilen simgenin resmiyle) sorulur. Beklerken en fazla 5 sn’de bir sorar.',
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
  if (!n) {
    return (
      <div className="hint-block">
        <p className="hint"><b>Nasıl kullanılır?</b></p>
        <ul className="hint-list">
          <li>“Tıkla” node’una ekranda gördüğün yazıyı yaz: <b>Opera’ya tıkla</b>, <b>Model Seç’e bas</b>. Ajan ekranı okuyup o yazının üstüne tıklar.</li>
          <li>Yazıyı tırnak içine alırsan (<b>“Modeli İndir” yazan yere bas</b>) birebir aranır, LLM’e gerek kalmaz.</li>
          <li><b>Ekrandan Seç</b> ile ekrandaki yazıları görüp doğrudan birini seçebilirsin.</li>
          <li>Node’un sağındaki <b>+</b> ile ileriye node ekle; renkli noktayı sürükleyip başka node’a bırakarak bağla.</li>
          <li>Tekrar eden işler için <b>Her Öğe İçin</b> kutusu: node’ları çerçevenin içine sürükle ya da seçip <b>Ctrl+G</b>. Her çalıştırmada liste baştan sona gider; sıradaki dosya <b>{'{{öğe}}'}</b> olur.</li>
          <li>Web sitelerinde önce <b>Tarayıcıyı Aç</b>: sayfanın içi okunur, dosya pencereleri ve indirmeler kendiliğinden halledilir.</li>
          <li>Birkaç adımlık işi tarif etmek istersen <b>İnisiyatif</b>: hedefi yaz, model ekrana bakarak yapar.</li>
          <li>Çalışırken uygulama küçülür; <b>Ctrl+Shift+Q</b> ile durdurursun.</li>
        </ul>
      </div>
    )
  }
  const spec = NODE_SPECS[n.kind]
  const upd = p.onUpdateNode

  return (
    <div>
      {(p.selectedCount ?? 1) > 1 && (
        <p className="hint">
          <b>{p.selectedCount} node seçili.</b> Birini sürükleyince hepsi birlikte gider. Ctrl ile seçime ekle ya da çıkar.
        </p>
      )}
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
          <MemoryBox {...p} n={n} />
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
          <p className="hint">
            Tıklama, silme ve yazma arasında kısa beklemeler var. Yazdıktan sonra alanın içi okunur; başka bir şey yazıyorsa bir kez daha yazılır.
            Tarayıcıda dosya penceresi açıksa ve metin bir dosya yoluysa, yol pencereye doğrudan verilir.
          </p>
          <label className="check">
            <input type="checkbox" checked={!!n.pressEnter} onChange={(e) => upd({ pressEnter: e.target.checked })} />
            Yazdıktan sonra Enter’a bas
          </label>
          {!n.useVision && <TargetBox {...p} n={n} />}
          <MemoryBox {...p} n={n} />
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

      {n.kind === 'condition' && (
        <>
          <div className="field">
            <label>{n.useVision ? 'Ekranda ne görünmeli? (yazı ya da serbest tarif)' : 'Ekranda aranacak yazı (seçilen öğe varsa boş bırakılabilir)'}</label>
            <input
              className="xp-input"
              value={n.text ?? ''}
              placeholder={n.useVision ? 'Örn: indirme çubuğu %100 olmuş' : 'Örn: İndirme tamamlandı'}
              onChange={(e) => upd({ text: e.target.value })}
            />
            <VarChips onInsert={(v) => upd({ text: append(n.text, v) })} />
          </div>
          {!n.useVision && <TargetBox {...p} n={n} />}
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
            <p className="hint">
              Yazı ya da seçilen öğe (uygulamanın kendi öğesi veya resmi) görünürse <b>var</b>, görünmezse <b>yok</b> çıkışından devam eder.
              Süre verirsen o süre boyunca tekrar tekrar bakar; süre dolunca “yok” bağlı değilse adım hata verir. Kutunun içindeyse o tur orada kalır, sıradaki öğeye geçilir.
              Kendin de kurabilirsin: “yok” → Zamanlayıcı → tekrar bu Koşul; ama süre vermek daha hızlı tepki verir (her saniye bakar).
              Pasif (soluk) düğmeler “var” sayılmaz. Yazı alanına ekranda gerçekten görünen yazıyı yaz; öğe adındaki “caret-down” gibi ekler ekranda görünmez.
              Günlükte “… gördü:” satırı neyin “var” dediğini gösterir.
            </p>
          </div>
        </>
      )}

      {n.kind === 'loop' && <LoopEditor {...p} n={n} />}
      {n.kind === 'ai' && <AiEditor {...p} n={n} />}
      {n.kind === 'browser' && <BrowserEditor {...p} n={n} />}
      {n.kind === 'waitFile' && <WaitFileEditor {...p} n={n} />}
      {n.kind === 'moveFile' && <MoveFileEditor {...p} n={n} />}

      <button type="button" className="xp-btn danger block" onClick={p.onDeleteNode}>
        {n.kind === 'loop' ? 'Kutuyu Sil (içindekiler kalır)' : 'Node’u Sil (Del)'}
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
      <fieldset className="xp-group">
        <legend>İnisiyatif modeli</legend>
        <p className="hint">
          “Ekrana bakarak” çalışan İnisiyatif bu modeli kullanır (aynı OpenRouter anahtarı). UI-TARS ekran görüntüsünden doğrudan koordinat verir;
          başka bir görsel model de yazabilirsin (Gemini, Claude, GPT). Bitti kontrolü yukarıdaki görsel modelle yapılır.
        </p>
        <div className="field">
          <label htmlFor="agentModel">Model adı</label>
          <SaveRow onSave={() => p.onSaveSettings({ agentModel: s.agentModel.trim() })}>
            <input
              id="agentModel"
              className="xp-input"
              list="vision-model-list"
              value={s.agentModel}
              placeholder="bytedance/ui-tars-1.5-7b"
              onChange={(e) => set({ agentModel: e.target.value })}
            />
          </SaveRow>
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
