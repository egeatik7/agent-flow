import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as T from '../electron/timing-constants'

describe('timing constants keep the values they replaced', () => {
  // A changed value here is a behaviour change, not a refactor. Change it only with a measured reason.
  it('has the exact waits the agent used before they were named', () => {
    expect({ ...T }).toEqual({
      FOCUS_SETTLE_MS: 420,
      REFRESH_RETRY_MS: 3000,
      REACTION_SETTLE_MS: 900,
      LOADING_RECHECK_MS: 2000,
      NEXT_ITEM_WAIT_MS: 2500,
      ENTER_GAP_MS: 240,
      LOCK_POLL_MS: 5000,
      UNLOCK_SETTLE_MS: 1500,
    })
  })

  it('agent.ts no longer contains a bare numeric wait (every pause uses a named constant)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../electron/agent.ts'), 'utf8')
    const bare = [...src.matchAll(/pause\(\s*\d+\s*\)/g)].map((m) => m[0])
    expect(bare).toEqual([])
  })
})
