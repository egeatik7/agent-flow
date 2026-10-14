import { expect, it } from 'vitest'
import { VisualModelSession } from '../electron/visual-session'
it('keeps the accepted model for unchanged settings but applies edited orders to the next request', () => {
  const session = new VisualModelSession(['A', 'B', 'C'], 1, 'Görsel LLM')
  session.accept('B')
  session.refresh(['A', 'B', 'C'], 2, 'Görsel LLM')
  expect(session.models).toEqual(['B', 'C'])
  expect(session.revision).toBe(2)
  session.refresh(['C', 'B', 'A'], 3, 'Görsel LLM')
  expect(session.models).toEqual(['C', 'B', 'A'])
  expect(session.revision).toBe(3)
})
it('changes to unrelated lists do not restart a visual fallback', () => {
  const session = new VisualModelSession(['A', 'B'], 1, 'Metin Modeli')
  session.accept('B')
  session.refresh(['A', 'B'], 99, 'Metin Modeli')
  expect(session.models).toEqual(['B'])
  session.refresh(['A', 'B'], 100, 'Görsel LLM')
  expect(session.models).toEqual(['A', 'B'])
})
