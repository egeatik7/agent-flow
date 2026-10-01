import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import LlmPanel from './LlmPanel'
import NubboMascot from './NubboMascot'
import ProbeMark from './ProbeMark'
import {
  NODE_SPECS,
  TEMPLATE_VARS,
  portLabel,
  VISION_KINDS,
  listItems,
  loopStartIndex,
  type AgentEdge,
  type AgentGraph,
  type AgentNode,
  type AppSettings,
  type PathStep,
  type ClickMode,
  type ModelInfo,
} from '../types'

export type SideTab = 'node' | 'llm' | 'settings'

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
  onFillFromFolder: (nodeId: string) => void
  onLoopFolder: (nodeId: string, folder: string) => void
  onEnterPackage: (id: string) => void
  onUnpackPackage: (id: string) => void
  onUpdatePackaged: (packageId: string, nodeId: string, patch: Partial<AgentNode>) => void
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

function BackupModels(props: { backups: string[] | undefined; listId: string; onChange: (next: string[]) => void }) {
  const rows = props.backups ?? []
  return (
    <div className="backup-box">
      {rows.map((name, i) => (
        <div className="backup-row" key={i}>
          <span className="backup-n">{i + 2}</span>
          <input
            className="xp-input"
            list={props.listId}
            value={name}
            placeholder="yedek model adı"
            onChange={(e) => {
              const next = rows.slice()
              next[i] = e.target.value
              props.onChange(next)
            }}
          />
          <button
            type="button"
            className="xp-btn backup-x"
            title="Bu yedeği sil"
            onClick={() => props.onChange(rows.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="xp-btn backup-add" disabled={rows.length >= 4} onClick={() => props.onChange([...rows, ''])}>
        + Yedek
      </button>
    </div>
  )
}

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
      <p className="hint">
        Her çalıştırmada liste baştan sona gider. İlk turda <span className="mono">{'{{öğe}}'}</span> birinci öğenin tam yoludur, ikinci turda
        ikinci öğenin. <span className="mono">{'{{öğe.isim}}'}</span> uzantısız addır (kedi.png → kedi). Yükleme adımının metni{' '}
        <span className="mono">{'{{öğe}}'}</span> olmalı. İlk adım, kutunun içinde kimsenin bağlanmadığı node’dur.
      </p>
      {members === 0 && <p className="hint warn">Kutu boş. Tekrar edecek node’ları çerçevenin içine sürükle ya da seçip Ctrl+G.</p>}
      <div className="field">
        <label htmlFor="loop-folder">Klasör</label>
        <input
          id="loop-folder"
          className="xp-input mono"
          value={folder}
          spellCheck={false}
          placeholder={'C:\\Klasör   veya   D:\\İş\\{{öğe}}'}
          onChange={(e) => p.onLoopFolder(n.id, e.target.value)}
        />
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
        {folderIsTemplate && (
          <p className="hint">
            <span className="mono">{'{{öğe}}'}</span> bir dıştaki Her Öğe İçin’in öğesidir. Liste, o kutunun işaretli satırındaki klasörden gelir. Paketin içinde olsa da dışarıdaki kutuya bakar.
          </p>
        )}
        <label>Liste (her satır bir öğe)</label>
        {items.length > 0 ? (
          <div className="xp-tick-list">
            {items.map((item, i) => (
              <div className={'xp-tick-row' + (i === mark ? ' on' : '')} key={i}>
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
        {items.length > 0 && (
          <p className="hint">
            İşaretli satır, Seçiliden Çalıştır’ın başlayacağı öğedir; liste oradan sona gider. Ajanı Çalıştır her zaman birinci satırdan başlar.
            Çalışırken işaret, turdaki öğeye kayar.
          </p>
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
            <>Ekrandaki yazıların numaralı listesinden seçer. Yazı ağırlıklı formlarda ve web sayfalarında hızlıdır.</>
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

      {n.kind === 'probe' && (
        <div className="field">
          <p className="hint">Akışa dokunmaz. Bir değişkene tıklayınca, bu node’un durduğu kutudaki işaretli satırın değeri görünür.</p>
          <ProbeMark graph={p.graph} node={n} onPick={(token) => upd({ text: token })} />
        </div>
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
    return <p className="hint">Bir node’u açıp başlığının altındaki “Pakette ayarları göster” kutusunu işaretlersen, ayarları burada açılır.</p>
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
  if (!n) {
    return (
      <div className="hint-block">
        <div>
          <p className="hint"><b>Nasıl kullanılır?</b></p>
          <ul className="hint-list">
            <li>“Tıkla” node’una ekranda gördüğün yazıyı yaz: <b>Opera’ya tıkla</b>, <b>Model Seç’e bas</b>. Ajan ekranı okuyup o yazının üstüne tıklar.</li>
            <li>Yazıyı tırnak içine alırsan (<b>“Modeli İndir” yazan yere bas</b>) birebir aranır, LLM’e gerek kalmaz.</li>
            <li><b>Ekrandan Seç</b> ile ekrandaki yazıları görüp doğrudan birini seçebilirsin.</li>
            <li>Node’un sağındaki <b>+</b> ile ileriye node ekle; renkli noktayı sürükleyip başka node’a bırakarak bağla.</li>
            <li>Tekrar eden işler için <b>Her Öğe İçin</b> kutusu: node’ları çerçevenin içine sürükle ya da seçip <b>Ctrl+G</b>. Her çalıştırmada liste baştan sona gider; sıradaki dosya <b>{'{{öğe}}'}</b> olur.</li>
            <li>Birkaç adımlık işi tarif etmek istersen <b>İnisiyatif</b>: hedefi yaz, model ekrana bakarak yapar.</li>
            <li>Çalışırken uygulama küçülür; <b>Ctrl+Shift+Q</b> ile durdurursun.</li>
          </ul>
        </div>
        <div className="nubbo-slot">
          <NubboMascot />
        </div>
      </div>
    )
  }
  const spec = NODE_SPECS[n.kind]

  return (
    <div>
      {(p.selectedCount ?? 1) > 1 && (
        <p className="hint">
          <b>{p.selectedCount} node seçili.</b> Birini sürükleyince hepsi birlikte gider. Shift ile tıklayınca seçime eklenir ya da çıkar. Boş yerde sürüklemek kutu çizer; Shift basılıyken çizilen kutu seçime eklenir.
        </p>
      )}
      <div className="inspector-kind" style={{ background: spec.color }}>
        {spec.icon} {spec.label}
      </div>
      <p className="hint">{spec.description}</p>

      <NodeFields {...p} n={n} />

      {n.kind === 'package' && (
        <div className="field">
          <p className="hint">
            Bu node’un içinde ayrı bir akış durur. Çalışınca orası kendi Başlangıç’ından bitişine kadar gider, sonra bu node’un “sonra” çıkışı devam eder.
          </p>
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
        <SaveRow onSave={() => p.onSaveSettings({ model: s.model.trim(), modelBackups: s.modelBackups ?? [] })}>
          <input id="model" className="xp-input" list="model-list" value={s.model} placeholder="openai/gpt-4o-mini" onChange={(e) => set({ model: e.target.value })} />
        </SaveRow>
        <BackupModels listId="model-list" backups={s.modelBackups} onChange={(modelBackups) => set({ modelBackups })} />
        <p className="hint">Üstteki 1. modeldir. Olmazsa 2, 3, 4, 5 denenir. Hepsi susarsa sıra başa döner. Durdurmak için Ctrl+Shift+Q.</p>
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
          <SaveRow onSave={() => p.onSaveSettings({ visionModel: s.visionModel.trim(), visionBackups: s.visionBackups ?? [] })}>
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
          <BackupModels listId="vision-model-list" backups={s.visionBackups} onChange={(visionBackups) => set({ visionBackups })} />
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
          <SaveRow onSave={() => p.onSaveSettings({ agentModel: s.agentModel.trim(), agentBackups: s.agentBackups ?? [] })}>
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
          <BackupModels listId="vision-model-list" backups={s.agentBackups} onChange={(agentBackups) => set({ agentBackups })} />
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
          ] as [SideTab, string][]
        ).map(([k, label]) => (
          <button type="button" key={k} className={`tab ${p.tab === k ? 'active' : ''}`} onClick={() => p.onTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {p.tab === 'node' && <NodeInspector {...p} />}
        {p.tab === 'llm' && <LlmPanel settings={p.settings} onSave={p.onSaveSettings} />}
        {p.tab === 'settings' && <Settings {...p} />}
      </div>
    </aside>
  )
}
