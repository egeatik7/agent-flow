import { METHOD_TABS } from '../../electron/node-methods'
import { listPromptFor, TARS_TEMPLATE, SCREEN_PROMPT, VISUAL_TARGET_RULES, VISUAL_TARGET_TARS_PROMPT, VISUAL_TARGET_JSON_PROMPT, VISUAL_POINTER_JSON_CONTRACT, VISUAL_POINTER_TARS_CONTRACT } from '../../electron/llm-flow'
import { WORD_TARGET_RULES, CONDITION_TARGET_RULES, OCR_READER_RULES } from '../../electron/word-targets'
import { useEffect, useState, type SetStateAction } from 'react'
import { DEFAULT_FIND_OFF, normalizeFind } from '../../electron/llm-flow'
import { stageHint } from '../../electron/model-chain'
import {
  DEFAULT_PROMPTS,
  FIND_STAGES,
  type AppSettings,
  type FindStageId,
  type LlmPrompts,
  type PromptId,
  type NodeKind,
} from '../types'

type Props = {
  settings: AppSettings
  onSave: (partial: Partial<AppSettings>) => void
  saveStatus?: string
  onDraft?: (partial: Partial<AppSettings>) => void
}

function move(list: FindStageId[], index: number, dir: -1 | 1): FindStageId[] {
  const j = index + dir
  if (j < 0 || j >= list.length) return list
  const next = list.slice()
  const [row] = next.splice(index, 1)
  next.splice(j, 0, row)
  return next
}

export default function LlmPanel(p: Props) {
  const [nodeTab, setNodeTab] = useState<NodeKind>('click')
  const [order, setOrderState] = useState<FindStageId[]>(() => normalizeFind(p.settings.findOrder, p.settings.findOff).order)
  const [off, setOffState] = useState<FindStageId[]>(() => normalizeFind(p.settings.findOrder, p.settings.findOff).off)
  const [prompts, setPromptsState] = useState<LlmPrompts>({ ...p.settings.llmPrompts })

  useEffect(() => {
    const find = normalizeFind(p.settings.findOrder, p.settings.findOff)
    setOrderState(find.order)
    setOffState(find.off)
    setPromptsState({ ...p.settings.llmPrompts })
  }, [p.settings.findOrder, p.settings.findOff, p.settings.llmPrompts])

  const setOrder = (action: SetStateAction<FindStageId[]>) => {
    const value = typeof action === 'function' ? action(order) : action
    setOrderState(value); p.onDraft?.({ findOrder: value })
  }
  const setOff = (action: SetStateAction<FindStageId[]>) => {
    const value = typeof action === 'function' ? action(off) : action
    setOffState(value); p.onDraft?.({ findOff: value })
  }
  const setPrompts = (action: SetStateAction<LlmPrompts>) => {
    const value = typeof action === 'function' ? action(prompts) : action
    setPromptsState(value); p.onDraft?.({ llmPrompts: value })
  }

  const text = (id: PromptId) => prompts[id] ?? DEFAULT_PROMPTS[id]
  const setText = (id: PromptId, value: string) => setPrompts((prev) => ({ ...prev, [id]: value }))
  const enabled = (id: FindStageId) => !off.includes(id)
  const toggle = (id: FindStageId) => setOff((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const resetStage = (id: FindStageId) => {
    const spec = FIND_STAGES.find((s) => s.id === id)
    setPrompts((prev) => {
      if (!spec?.prompt) return prev
      const next = { ...prev }
      delete next[nodeTab === 'type' && spec.prompt === 'list' ? 'typeList' : spec.prompt]
      return next
    })
    setOff((prev) => {
      const without = prev.filter((x) => x !== id)
      return DEFAULT_FIND_OFF.includes(id) ? [...without, id] : without
    })
    setOrder((prev) => {
      const rest = prev.filter((x) => x !== id)
      const at = FIND_STAGES.findIndex((s) => s.id === id)
      rest.splice(Math.max(0, Math.min(at, rest.length)), 0, id)
      return rest
    })
  }

  const resetAll = () => {
    setOrder(FIND_STAGES.map((s) => s.id))
    setOff([...DEFAULT_FIND_OFF])
    setPrompts({})
  }

  const save = () => {
    const clean: LlmPrompts = {}
    for (const id of Object.keys(DEFAULT_PROMPTS) as PromptId[]) {
      const value = prompts[id]
      if (typeof value === 'string' && value.trim() && value.trim() !== DEFAULT_PROMPTS[id].trim()) clean[id] = value
    }
    p.onSave({ findOrder: order, findOff: off, llmPrompts: clean })
  }

  const sharedFind = nodeTab === 'click' || nodeTab === 'type'
  const selectedTab = METHOD_TABS.find(tab => tab.id === nodeTab)!
  const resetPrompt = (id: PromptId) => setPrompts(prev => { const next = { ...prev }; delete next[id]; return next })
  const fixedRules = (title: string, value: string) => <details className="llm-fixed"><summary>{title}</summary><pre>{value}</pre></details>
  const promptBox = (id: PromptId, title: string, note: string, value = text(id)) => (
    <div className="llm-stage" key={id}>
      <div className="llm-stage-head"><b>{title}</b><button type="button" className="xp-btn" onClick={() => resetPrompt(id)}>Sıfırla</button></div>
      <p className="llm-note">{note}</p>
      <textarea aria-label={title} className="xp-input llm-prompt" rows={7} value={value} onChange={e => setText(id, e.target.value)} spellCheck={false} />
    </div>
  )

  return (
    <div className="llm-panel">
      <p className="llm-note">Değişiklikler otomatik kaydedilir; Kaydet düğmesi yeniden kayıt için kalır.</p>
      {p.saveStatus && <p className="llm-note" role="status">{p.saveStatus}</p>}
      <div className="llm-node-tabs" role="tablist" aria-label="Node yöntemleri" onKeyDown={e => {
        const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
        const index = buttons.indexOf(e.target as HTMLButtonElement)
        if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
        e.preventDefault()
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
        buttons[next].click(); buttons[next].focus()
      }}>
        {METHOD_TABS.map(tab => <button key={tab.id} id={`method-tab-${tab.id}`} type="button" role="tab" aria-selected={nodeTab === tab.id} aria-controls="method-panel" tabIndex={nodeTab === tab.id ? 0 : -1} className={`xp-btn${nodeTab === tab.id ? ' active' : ''}`} onClick={() => setNodeTab(tab.id)}>{tab.title}</button>)}
      </div>
      <section id="method-panel" role="tabpanel" aria-labelledby={`method-tab-${nodeTab}`}>
      <p className="llm-note">{selectedTab.note}</p>
      {sharedFind && <>
      <p className="llm-note">{stageHint(p.settings, 'list')}</p>
      <p className="llm-note">{stageHint(p.settings, 'visual')} {stageHint(p.settings, 'pointer')}</p>
      <ol className="llm-stages">
        {order.map((id, index) => {
          const spec = FIND_STAGES.find((s) => s.id === id)
          if (!spec) return null
          const visual = id === 'tars'
          const prompt = nodeTab === 'type' && spec.prompt === 'list' ? 'typeList' : spec.prompt
          const stageText = prompt ? (visual ? (prompts.tars === TARS_TEMPLATE ? '' : prompts.tars ?? '') : prompt === 'typeList' ? (prompts.typeList ?? listPromptFor('type', prompts.list)) : text(prompt)) : ''
          return (
            <li key={id} className={`llm-stage${enabled(id) ? '' : ' off'}`}>
              <div className="llm-stage-head">
                <label className="llm-check"><input type="checkbox" checked={enabled(id)} onChange={() => toggle(id)} /><b>{index + 1}. {id === 'uia' ? 'Uygulama öğesi (UIA)' : id === 'tars' ? 'Görsel hedefleme' : spec.title}</b></label>
                <span className="llm-move">
                  <button type="button" className="xp-btn" aria-label={`${spec.title} yukarı`} disabled={index === 0} onClick={() => setOrder(list => move(list, index, -1))}>↑</button>
                  <button type="button" className="xp-btn" aria-label={`${spec.title} aşağı`} disabled={index === order.length - 1} onClick={() => setOrder(list => move(list, index, 1))}>↓</button>
                  <button type="button" className="xp-btn" onClick={() => resetStage(id)}>Sıfırla</button>
                </span>
              </div>
              <p className="llm-note">{id === 'uia' ? 'Kayıtlı öğe veya yazılı hedefe uyan düğme/yazılabilir alan yerelde aranır. LLM yok.' : id === 'offset' ? 'Eski konum yalnız tanılama için okunur; tek başına hedef kanıtı veya tıklama yöntemi değildir. LLM yok.' : visual ? 'Ekran görüntüsünden tek hedef aranır. UI-TARS ile diğer görsel modellerin talimatları aşağıda ayrı gösterilir.' : spec.note}</p>
              {prompt && <textarea aria-label={visual ? 'UI-TARS ek talimatı' : spec.title + ' promptu'} className="xp-input llm-prompt" rows={7} value={stageText} onChange={e => setText(prompt, e.target.value)} spellCheck={false} />}
              {id === 'chrome' && <p className="llm-note">Model gerektiğinde aşağıdaki ortak Kelime listesi promptu kullanılır.</p>}
              {id === 'list' && fixedRules('Model isteğine eklenen sabit liste/OCR kuralları', WORD_TARGET_RULES + '\n\n' + OCR_READER_RULES)}
              {visual && <>
                <p className="llm-note">Yukarıdaki kutu UI-TARS’a ek talimattır. Boşsa aşağıdaki yerleşik hedef promptu kullanılır.</p>
                {fixedRules('UI-TARS yerleşik hedef promptu', VISUAL_TARGET_TARS_PROMPT)}
                {promptBox('screen', 'Diğer görsel modeller — ek talimat', 'Bu kutu ortak görsel hedefleme ek talimatıdır; boşsa yerleşik JSON hedef promptu kullanılır.', prompts.screen === SCREEN_PROMPT ? '' : prompts.screen ?? '')}
                {fixedRules('JSON yerleşik hedef promptu', VISUAL_TARGET_JSON_PROMPT)}
                {fixedRules('Her görsel isteğe eklenen hedef kuralları', VISUAL_TARGET_RULES)}
                {nodeTab === 'click' && promptBox('visualPointer', 'Görsel konum doğrulama — önce fareyi taşı', 'Yalnız görsel modelle bulunan tıklama hedefinde: fare taşınır, gerçek imleç işaretli yeni kare modele gönderilir. Onaylanan konumdan seçili modla tıklanır. En fazla iki konum düzeltmesi; belirsizlikte tıklama yok. UIA/OCR ve Fareyi Oynat modunda bu çağrı yapılmaz.')}
                {nodeTab === 'click' && fixedRules('Konum doğrulaması — sabit JSON ve UI-TARS yanıt sözleşmeleri', VISUAL_POINTER_JSON_CONTRACT + '\n\n' + VISUAL_POINTER_TARS_CONTRACT)}
              </>}
            </li>
          )
        })}
      </ol>
      <div className="llm-stage"><b>Girdi gönderme — LLM yok</b><p className="llm-note">{nodeTab === 'click' ? 'Bulunan hedefe seçilen tıklama veya fareyi oynatma eylemi gönderilir.' : 'Hedef varsa alan seçilir; Ctrl+A / Delete, yazı ve istenirse Enter gönderilir. Alan seçimi için ayrı LLM çağrısı yapılmaz.'}</p></div>
      <div className="llm-stage"><b>Hedef bulunamazsa</b><p className="llm-note">3 saniye bekleyip tüm ekranda bir kez daha arar. Yine bulunamazsa Takılma modelinden plan istenebilir.</p></div>
      {nodeTab === 'click' && <>
        <p className="llm-note">{stageHint(p.settings, 'word')} Ayarlar → Genel → OCR kelime seçimi.</p>
        {promptBox('wordChoice', 'OCR kelime seçimi — kısa ikinci istek', 'Liste modelinin seçtiği çok kelimeli OCR satırındaki kelimeler ve tam node talimatı gönderilir. Screenshot ve sohbet geçmişi yoktur. Cevap yalnız id veya null; seçimi program değiştirmez. Düşünme kapalı istenir. Tek kelime ve UIA/DOM hedeflerinde çağrılmaz.')}
      </>}
      {nodeTab === 'click' && promptBox('reaction', 'Tıklama sonrası tepki', 'Ekran kontrolü Açık olduğunda ve yerel değerlendirme belirsizse önce/sonra kareleri görsel modeline gönderilir. Kapalı ve Yalnız günlük modunda bu model çağrılmaz.')}
      {promptBox('stall', 'Takılma planı', 'Hedef bulma veya tıklama değerlendirmesi toparlanamazsa bekleme/devam/durma kararı. Ortak Tıkla/Yazı Yaz promptu; görsel model zinciri kullanılır.')}
      </>}
      {nodeTab === 'condition' && <>
        <p className="llm-note">Koşul kutusuna ne aradığını normal cümleyle yaz. Bir kez tüm ekranda UIA öğeleri, karar doğrulanmazsa bir kez Windows + ONNX OCR okunur ve kararı bu sekmelerdeki metin modeli promptları verir. Tırnak, birebir eşleşme veya yerel arama yoktur. Pencere / uygulama bağlamı yalnız modele bilgi verir; pencere seçilmez. Koşul beklemez veya kendi içinde tekrar denemez; tekrar için Zamanlayıcı ile döngü kur. Eski ekran seçimi taşıyan koşullar uyumluluk hatası verir. {stageHint(p.settings, 'condition')}</p>
        {promptBox('conditionUia', '1. UIA — koşul değerlendirmesi', 'Güncel uygulama öğeleri okunur. Metin, düğme ve diğer kontrol türleri kanıt olabilir. Normal tarif bu promptla metin modeline gider; boş liste de modele gönderilir. Model koşulun sağlanıp sağlanmadığını doğrudan değerlendirir.')}
        {promptBox('conditionOcr', '2. Windows + ONNX OCR — koşul değerlendirmesi', 'UIA’da açık kanıt yoksa düz ve 90° OCR okuması kullanılır. Bu aşamanın ayrı promptu vardır. Bu aşama da tek okumadır; boş sonuç modele gönderilir.')}
        {fixedRules('Her koşul listesine eklenen sabit kanıt/OCR kuralları', CONDITION_TARGET_RULES + '\n\n' + OCR_READER_RULES)}
        <div className="llm-stage"><b>Ekran görüntüsünden karar — kapalı</b><p className="llm-note">Koşul şu an görsel modele görüntü göndermez.</p></div>
      </>}
      {nodeTab === 'ai' && <>
        <p className="llm-note">{stageHint(p.settings, 'yap')}</p>
        {promptBox('yap', 'Yap — araç kullanan ajan', 'Node’daki görev, döngü öğesi, tuval bağlamı ve sonraki adımlar ayrı görev mesajında gönderilir. Ekran okuma ve Windows araçları modelin seçtiği sırayla çalışır.')}
        <div className="llm-stage"><b>Araç yürütme — LLM yok</b><p className="llm-note">Seçilen araç sırayla çalıştırılır; sonucu modele döner. Güncel ekranlar varsa son iki görüntü tutulur. Araç/adım ve süre sınırları node ayarlarından gelir.</p></div>
        <div className="llm-stage"><b>Tamamlanma — araç kararı</b><p className="llm-note">Model task_complete çağırınca motor mevcut gözlem ve araç sınırlarını değerlendirir. Eski kayıtlı İnisiyatif yolları oynatılmaz.</p></div>
      </>}
      {!sharedFind && nodeTab !== 'condition' && nodeTab !== 'ai' && <div className="llm-stage"><b>Yerel yürütme — LLM yok</b><p className="llm-note">{selectedTab.note}</p></div>}
      </section>
      <div className="llm-save-row"><button type="button" className="xp-btn" onClick={resetAll}>Tüm yöntemleri sıfırla</button><button type="button" className="xp-btn save" onClick={save}>Kaydet</button></div>
    </div>
  )
}
