import { describe, expect, it } from 'vitest'
import { createNode, itemVars } from '../electron/graph-types'
import { renderNode } from '../electron/runner'

describe('renderNode template origin', () => {
  it('keeps template origin across recovery rerender without mutating the saved node', () => {
    const original = { ...createNode('click', 0, 0), prompt: '{{öğe}}' }
    const first = renderNode(original, itemVars('A.glb', 0, 2))
    expect(first.prompt).toBe('A.glb')
    expect(first.templated).toBe(true)
    expect(renderNode(first, itemVars('B.glb', 1, 2)).templated).toBe(true)
    expect(original.prompt).toBe('{{öğe}}')
    expect(original.templated).not.toBe(true)
  })
  it('literal targets remain literal', () => {
    expect(renderNode({ ...createNode('click', 0, 0), prompt: 'Kaydet' }, {}).templated).toBe(false)
  })
})
