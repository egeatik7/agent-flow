import { useEffect, useState, type SetStateAction } from 'react'
import { DEFAULT_FIND_OFF, normalizeFind } from '../../electron/llm-flow'
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
      delete next[spec.prompt]
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

  return (
    <div className="llm-panel">
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
