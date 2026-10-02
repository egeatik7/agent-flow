import { useEffect, useState } from 'react'
import {
  DEFAULT_PROMPTS,
  EXTRA_PROMPTS,
  FIND_STAGES,
  type AppSettings,
  type FindStageId,
  type LlmPrompts,
  type PromptId,
} from '../types'

type Props = {
  settings: AppSettings
  onSave: (partial: Partial<AppSettings>) => void
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
  const [order, setOrder] = useState<FindStageId[]>(p.settings.findOrder)
  const [off, setOff] = useState<FindStageId[]>(p.settings.findOff)
  const [prompts, setPrompts] = useState<LlmPrompts>({ ...p.settings.llmPrompts })

  useEffect(() => {
    setOrder(p.settings.findOrder)
    setOff(p.settings.findOff)
    setPrompts({ ...p.settings.llmPrompts })
  }, [p.settings])

  const text = (id: PromptId) => prompts[id] ?? DEFAULT_PROMPTS[id]
  const setText = (id: PromptId, value: string) => setPrompts((prev) => ({ ...prev, [id]: value }))
  const enabled = (id: FindStageId) => !off.includes(id)
  const toggle = (id: FindStageId) => setOff((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const resetStage = (id: FindStageId) => {
    const spec = FIND_STAGES.find((s) => s.id === id)
    setPrompts((prev) => {
      if (!spec?.prompt) return prev
      const next = { ...prev }
      delete next[spec.prompt]
      return next
    })
    setOff((prev) => {
      const without = prev.filter((x) => x !== id)
      return id === 'list' ? [...without, id] : without
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
    setOff(['list'])
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

  return (
    <div className="llm-panel">
      <p className="hint">
        Hedef yukarıdan aşağı aranır. İşareti kalkan aşama atlanır. Kelime listesi yazı modeline, UI-TARS ise düz ekran görüntüsüne gider. Kaydet’e basınca kalır.
      </p>
      <ol className="llm-stages">
        {order.map((id, index) => {
          const spec = FIND_STAGES.find((s) => s.id === id)
          if (!spec) return null
          return (
            <li key={id} className={`llm-stage${enabled(id) ? '' : ' off'}`}>
              <div className="llm-stage-head">
                <label className="llm-check">
                  <input type="checkbox" checked={enabled(id)} onChange={() => toggle(id)} />
                  <b>
                    {index + 1}. {spec.title}
                  </b>
                </label>
                <span className="llm-move">
                  <button type="button" className="xp-btn" disabled={index === 0} onClick={() => setOrder((list) => move(list, index, -1))}>
                    ↑
                  </button>
                  <button type="button" className="xp-btn" disabled={index === order.length - 1} onClick={() => setOrder((list) => move(list, index, 1))}>
                    ↓
                  </button>
                  <button type="button" className="xp-btn" title="Bu aşamayı varsayılana çevir" onClick={() => resetStage(id)}>
                    Sıfırla
                  </button>
                </span>
              </div>
              <p className="llm-note">{spec.note}</p>
              {spec.prompt && (
                <textarea className="xp-input llm-prompt" rows={7} value={text(spec.prompt)} onChange={(e) => setText(spec.prompt!, e.target.value)} spellCheck={false} />
              )}
            </li>
          )
        })}
      </ol>
      <h3 className="llm-extra-title">Diğer LLM çağrıları</h3>
      {EXTRA_PROMPTS.map((spec) => (
        <div key={spec.id} className="llm-stage">
          <div className="llm-stage-head">
            <b>{spec.title}</b>
            <button type="button" className="xp-btn" title="Bu promptu varsayılana çevir" onClick={() => setText(spec.id, DEFAULT_PROMPTS[spec.id])}>
              Sıfırla
            </button>
          </div>
          <p className="llm-note">{spec.note}</p>
          <textarea className="xp-input llm-prompt" rows={6} value={text(spec.id)} onChange={(e) => setText(spec.id, e.target.value)} spellCheck={false} />
        </div>
      ))}
      <div className="llm-save-row">
        <button type="button" className="xp-btn" onClick={resetAll}>
          Tümünü sıfırla
        </button>
        <button type="button" className="xp-btn save" onClick={save}>
          Kaydet
        </button>
      </div>
    </div>
  )
}
