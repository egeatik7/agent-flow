import { expect, it } from 'vitest'
import { normalizePrompts, promptOf, WORD_CHOICE_PROMPT, LEGACY_WORD_CHOICE_PROMPT } from '../electron/llm-flow'

it('allows any matching word within one label while distinguishing unrelated controls', () => {
  expect(WORD_CHOICE_PROMPT).toContain('User Perspective')
  expect(WORD_CHOICE_PROMPT).toContain('several valid words within one label are not a reason to return null')
  expect(WORD_CHOICE_PROMPT).toContain('Do not assume all words on one OCR line share a control')
})
it('migrates only the exact old default; preserves genuinely custom prompts', () => {
  expect(promptOf(normalizePrompts({ wordChoice: LEGACY_WORD_CHOICE_PROMPT }), 'wordChoice')).toBeUndefined()
  const custom = LEGACY_WORD_CHOICE_PROMPT + '\nMy own rule.'
  expect(promptOf(normalizePrompts({ wordChoice: custom }), 'wordChoice')).toBe(custom)
})
