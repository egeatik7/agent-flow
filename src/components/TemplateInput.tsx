import { useLayoutEffect, useRef, useState } from 'react'
import { TEMPLATE_VARS, type AgentGraph } from '../types'
import { revealAt, revealTip } from '../../electron/reveal'
import { atomicRange, editorSelection, rawText, replaceRange, restoreSelection, templateParts, type TextRange } from '../lib/template-editor'

type Props = {
  value: string
  onChange: (value: string) => void
  graph: AgentGraph
  nodeId: string
  label: string
  id?: string
  placeholder?: string
  multiline?: boolean
  mono?: boolean
  disabled?: boolean
}

/** Tokens are visual only. Graph data, selection offsets and clipboard keep {{…}}. */
export default function TemplateInput(p: Props) {
  const root = useRef<HTMLDivElement>(null)
  const current = useRef(p.value)
  const selection = useRef<TextRange>({ start: p.value.length, end: p.value.length })
  const composing = useRef(false)
  const pendingSelection = useRef(false)
  const history = useRef({ values: [p.value], index: 0 })
  const [revision, redraw] = useState(0)
  const remember = () => {
    const el = root.current
    if (el) selection.current = editorSelection(el) ?? selection.current
  }
  const commit = (value: string, range: TextRange, record = true) => {
    if (p.disabled) return
    current.current = value
    selection.current = range
    pendingSelection.current = true
    if (record) {
      const h = history.current
      if (h.values[h.index] !== value) {
        h.values = [...h.values.slice(0, h.index + 1), value].slice(-100)
        h.index = h.values.length - 1
      }
    }
    p.onChange(value)
    redraw(x => x + 1)
  }
  const insert = (text: string) => {
    if (p.disabled) return
    remember()
    const next = replaceRange(current.current, selection.current, text)
    root.current?.focus()
    commit(next.value, { start: next.caret, end: next.caret })
  }
  useLayoutEffect(() => {
    const el = root.current
    if (!el || composing.current) return
    if (p.value !== current.current) {
      current.current = p.value
      history.current = { values: [p.value], index: 0 }
    }
    const focused = el === el.ownerDocument.activeElement
    if (focused && !pendingSelection.current) remember()
    pendingSelection.current = false
    el.replaceChildren()
    for (const part of templateParts(p.value)) {
      if (!part.token) { el.append(el.ownerDocument.createTextNode(part.text)); continue }
      const reveal = revealAt(p.graph, p.nodeId, part.text)
      const chip = el.ownerDocument.createElement('span')
      chip.className = `template-token${reveal.resolved ? '' : ' unresolved'}`
      chip.contentEditable = 'false'
      chip.dataset.template = part.text
      chip.dataset.start = String(part.start)
      chip.dataset.end = String(part.end)
      chip.dataset.manualTitle = part.text
      chip.dataset.manualText = revealTip(part.text, reveal)
      const value = el.ownerDocument.createElement('span')
      value.className = 'template-token-value'
      value.textContent = reveal.resolved ? reveal.value || '(boş)' : `${part.text} · ${reveal.value}`
      const remove = el.ownerDocument.createElement('button')
      remove.type = 'button'
      remove.disabled = !!p.disabled
      remove.className = 'template-token-remove'
      remove.dataset.removeToken = 'true'
      remove.setAttribute('aria-label', `${part.text} değişkenini sil`)
      remove.dataset.manualTitle = 'Değişkeni sil'
      remove.dataset.manualText = `Bu ${part.text} kutusunu metinden siler. Diğer kutular ve metin kalır.`
      remove.textContent = '×'
      chip.append(value, remove); el.append(chip)
    }
    if (focused) restoreSelection(el, selection.current)
  }, [p.value, p.graph, p.nodeId, p.disabled, revision])

  return <div className="template-field" data-template-field="true">
    <div ref={root} id={p.id} data-template-editor="true"
      className={`template-input ${p.multiline ? 'multiline' : ''}${p.mono ? ' mono' : ''}`}
      role="textbox" aria-label={p.label} aria-multiline={!!p.multiline}
      data-placeholder={p.placeholder} contentEditable={!p.disabled} aria-disabled={!!p.disabled}
      tabIndex={p.disabled ? -1 : 0} suppressContentEditableWarning spellCheck={false}
      data-manual-title={p.label} data-manual-text="Değişken düğmesi imlecin olduğu yere eklenir. Kutuda karşılığı gösterilir; akışta {{…}} saklanır. Tam değer için kutunun üzerine gel."
      onMouseUp={remember} onKeyUp={remember} onBlur={remember}
      onMouseDown={e => {
        if ((e.target as Element).closest('[data-remove-token]')) { remember(); e.preventDefault() }
      }}
      onClick={e => {
        const remove = (e.target as Element).closest('[data-remove-token]')
        const chip = remove?.closest<HTMLElement>('[data-template]')
        if (!chip) return
        const next = replaceRange(current.current, { start: Number(chip.dataset.start), end: Number(chip.dataset.end) }, '')
        root.current?.focus(); commit(next.value, { start: next.caret, end: next.caret })
      }}
      onCompositionStart={() => { composing.current = true }}
      onCompositionEnd={() => {
        composing.current = false; remember()
        commit(rawText(root.current!), selection.current)
      }}
      onInput={() => {
        if (composing.current) return
        remember(); commit(rawText(root.current!), selection.current)
      }}
      onPaste={e => {
        e.preventDefault()
        const text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')
        insert(p.multiline ? text : text.replace(/\n/g, ''))
      }}
      onDrop={e => {
        e.preventDefault()
        const text = e.dataTransfer.getData('text/plain').replace(/\r\n?/g, '\n')
        if (text) insert(p.multiline ? text : text.replace(/\n/g, ''))
      }}
      onCopy={e => {
        remember(); const r = atomicRange(current.current, selection.current)
        if (r.start === r.end) return
        e.preventDefault(); e.clipboardData.setData('text/plain', current.current.slice(r.start, r.end))
      }}
      onCut={e => {
        remember(); const r = atomicRange(current.current, selection.current)
        if (r.start === r.end) return
        e.preventDefault(); e.clipboardData.setData('text/plain', current.current.slice(r.start, r.end)); insert('')
      }}
      onBeforeInput={e => {
        const input = e.nativeEvent as InputEvent
        if (input.inputType === 'insertParagraph' || input.inputType === 'insertLineBreak') {
          e.preventDefault(); if (p.multiline) insert('\n')
        }
      }}
      onKeyDown={e => {
        if (p.disabled) return
        if ((e.target as Element).closest('[data-remove-token]')) return
        if (composing.current || e.nativeEvent.isComposing) return
        const modifier = e.ctrlKey || e.metaKey
        if (modifier && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
          e.preventDefault(); const h = history.current
          const forward = e.key.toLowerCase() === 'y' || e.shiftKey
          h.index = Math.max(0, Math.min(h.values.length - 1, h.index + (forward ? 1 : -1)))
          const value = h.values[h.index]; commit(value, { start: value.length, end: value.length }, false)
          return
        }
        if (e.key === 'Enter') { e.preventDefault(); if (p.multiline) insert('\n'); return }
        if (modifier || e.altKey || (e.key !== 'Backspace' && e.key !== 'Delete')) return
        remember()
        let { start, end } = selection.current
        if (start === end) {
          const part = templateParts(current.current).find(part => part.token && (e.key === 'Backspace' ? part.end === start : part.start === start))
          if (part) { start = part.start; end = part.end }
          else if (e.key === 'Backspace') start -= Array.from(current.current.slice(0, start)).slice(-1)[0]?.length ?? 0
          else end += Array.from(current.current.slice(end))[0]?.length ?? 0
        }
        e.preventDefault()
        const next = replaceRange(current.current, { start, end }, '')
        commit(next.value, { start: next.caret, end: next.caret })
      }} />
    <div className="var-chips">
      {TEMPLATE_VARS.map(token => {
        const reveal = revealAt(p.graph, p.nodeId, token)
        return <button type="button" key={token} className="chip var" disabled={p.disabled}
          data-manual-title={token} data-manual-text={revealTip(token, reveal)}
          onMouseDown={e => { remember(); e.preventDefault() }} onClick={() => insert(token)}>{token}</button>
      })}
    </div>
  </div>
}
