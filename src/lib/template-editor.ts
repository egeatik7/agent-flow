/** The editor displays values but all offsets and clipboard data use the raw template. */
export type TemplatePart = { text: string; start: number; end: number; token: boolean }
export type TextRange = { start: number; end: number }
export function templateParts(value: string): TemplatePart[] {
  const parts: TemplatePart[] = []
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g
  let at = 0
  for (const m of value.matchAll(re)) {
    const start = m.index!
    if (at < start) parts.push({ text: value.slice(at, start), start: at, end: start, token: false })
    at = start + m[0].length
    parts.push({ text: m[0], start, end: at, token: true })
  }
  if (at < value.length) parts.push({ text: value.slice(at), start: at, end: value.length, token: false })
  return parts
}
export function atomicRange(value: string, range: TextRange): TextRange {
  let start = Math.max(0, Math.min(range.start, range.end, value.length))
  let end = Math.max(start, Math.min(Math.max(range.start, range.end), value.length))
  for (const part of templateParts(value)) {
    if (!part.token) continue
    if (start === end && start > part.start && start < part.end) start = end = part.end
    else if (start < part.end && end > part.start) {
      start = Math.min(start, part.start); end = Math.max(end, part.end)
    }
  }
  return { start, end }
}
export function replaceRange(value: string, range: TextRange, text: string) {
  const { start, end } = atomicRange(value, range)
  return { value: value.slice(0, start) + text + value.slice(end), caret: start + text.length }
}
export function rawText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? ''
  if (node instanceof HTMLElement && node.dataset.template !== undefined) return node.dataset.template
  if (node.nodeName === 'BR') return '\n'
  let text = ''
  Array.from(node.childNodes).forEach((child, i) => {
    if (i && /^(DIV|P)$/.test(child.nodeName) && !text.endsWith('\n')) text += '\n'
    text += rawText(child)
  })
  return text
}
function pointOffset(root: Node, target: Node, offset: number): number {
  if (root === target) {
    if (root.nodeType === 3) return Math.min(offset, (root.textContent ?? '').length)
    return Array.from(root.childNodes).slice(0, offset).reduce((sum, node) => sum + rawText(node).length, 0)
  }
  let before = 0
  for (const child of Array.from(root.childNodes)) {
    if (child === target || child.contains(target)) {
      if (child instanceof HTMLElement && child.dataset.template !== undefined) return before + child.dataset.template.length
      return before + pointOffset(child, target, offset)
    }
    before += rawText(child).length
  }
  return before
}
export function editorSelection(root: HTMLElement): TextRange | null {
  const s = root.ownerDocument.getSelection()
  if (!s?.anchorNode || !s.focusNode || !root.contains(s.anchorNode) || !root.contains(s.focusNode)) return null
  const a = pointOffset(root, s.anchorNode, s.anchorOffset), b = pointOffset(root, s.focusNode, s.focusOffset)
  return atomicRange(rawText(root), { start: Math.min(a, b), end: Math.max(a, b) })
}
function domPoint(root: HTMLElement, offset: number): [Node, number] {
  let at = 0
  for (let i = 0; i < root.childNodes.length; i++) {
    const child = root.childNodes[i], length = rawText(child).length
    if (offset <= at + length) {
      if (child.nodeType === 3) return [child, Math.max(0, offset - at)]
      return [root, offset <= at ? i : i + 1]
    }
    at += length
  }
  return [root, root.childNodes.length]
}
export function restoreSelection(root: HTMLElement, selection: TextRange) {
  const s = root.ownerDocument.getSelection()
  if (!s) return
  const normalized = atomicRange(rawText(root), selection)
  const range = root.ownerDocument.createRange()
  range.setStart(...domPoint(root, normalized.start)); range.setEnd(...domPoint(root, normalized.end))
  s.removeAllRanges(); s.addRange(range)
}
