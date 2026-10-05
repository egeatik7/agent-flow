import { beforeEach, describe, expect, it, vi } from 'vitest'

// Sahte Windows köprüsü: gerçek worker yok. Worker'ın "pressEnter" ile Enter bastığı da burada sayılır.
const fake = vi.hoisted(() => {
  const state = {
    enterByWorker: 0,
    enterByAgent: 0,
    typeCalls: [] as { pressEnter: boolean; fieldToken?: string }[],
    secondResult: {} as Record<string, unknown>,
    fieldValue: '' as string | null,
  }
  return state
})

vi.mock('electron', () => ({
  screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }) },
}))

vi.mock('../electron/a11y-bridge', () => ({
  isLocked: async () => false,
  foreground: async () => null,
  inputTarget: async () => ({ hwnd: '100', pid: 10, title: 'Pencere A', rect: { x: 0, y: 0, w: 1000, h: 700 } }),
  assertInputTarget: async () => {},
  focusedValue: async () => fake.fieldValue,
  sendKeys: async (keys: string) => {
    if (keys === '{ENTER}') fake.enterByAgent++
  },
  typeText: async (_text: string, pressEnter: boolean, _clear: boolean, _at?: unknown, fieldToken?: string) => {
    fake.typeCalls.push({ pressEnter, fieldToken })
    if (pressEnter) fake.enterByWorker++
    // İlk çağrı (alan seçilmeden): öndeki pencerede iki yazı kutusu var, seçim gerekiyor.
    if (fieldToken === undefined) {
      return {
        needChoice: true,
        choices: [
          { id: 7, token: 'token-a', window: 'Pencere A', type: 'Edit', name: 'Kaynak klasör' },
          { id: 8, token: 'token-b', window: 'Pencere A', type: 'Edit', name: 'Ara' },
        ],
      }
    }
    return fake.secondResult
  },
  clickAt: async () => {},
  scan: async () => ({ items: [], texts: [] }),
  discardShot: () => {},
  windowRect: async () => ({ x: 0, y: 0, w: 100, h: 100 }),
}))

vi.mock('../electron/browser', () => ({}))
vi.mock('../electron/shots', () => ({ rememberShot: () => {} }))

vi.mock('../electron/openrouter', async (importOriginal) => {
  const real = await importOriginal<typeof import('../electron/openrouter')>()
  return { ...real, chooseTypeField: async () => ({ id: 7, reason: 'test' }) }
})

import { createAgent } from '../electron/agent'
import { createNode } from '../electron/graph-types'

function makeAgent() {
  const logs: string[] = []
  const { executor } = createAgent({
    log: (_level, message) => logs.push(message),
    send: () => {},
    settings: () => ({ apiKey: 'test-key', model: 'test/model' }) as never,
    shouldStop: () => false,
  })
  return { executor, logs }
}

/** Sıradaki adım bir Koşul: ekran taraması yapılmadan eylem doğrudan çalışır. */
function conditionAhead() {
  return { next: createNode('condition', 0, 0) }
}

describe('Yazı Yaz: birden fazla pencerede yazı kutusu varken Enter', () => {
  beforeEach(() => {
    fake.enterByWorker = 0
    fake.enterByAgent = 0
    fake.typeCalls = []
    fake.secondResult = {}
    fake.fieldValue = 'C:\\Resimler'
  })

  it('klavye yolunda Enter yalnızca bir kez basılır', async () => {
    const { executor } = makeAgent()
    const node = createNode('type', 0, 0)
    node.text = 'C:\\Resimler'
    node.pressEnter = true
    fake.secondResult = {}
    await executor.type(node, 1, conditionAhead())
    expect(fake.typeCalls.length).toBe(2)
    // Seçilen alan, numarayla değil worker'ın verdiği anahtarla (token) çağrılır; worker Enter basmaz.
    expect(fake.typeCalls[1]).toEqual({ pressEnter: false, fieldToken: 'token-a' })
    expect(fake.enterByWorker + fake.enterByAgent).toBe(1)
  })

  it('değer doğrudan yazıldığında (via: value) Enter yalnızca bir kez basılır', async () => {
    const { executor } = makeAgent()
    const node = createNode('type', 0, 0)
    node.text = 'C:\\Resimler'
    node.pressEnter = true
    fake.secondResult = { via: 'value', where: 'Pencere A' }
    await executor.type(node, 1, conditionAhead())
    expect(fake.enterByWorker + fake.enterByAgent).toBe(1)
  })

  it('Enter istenmediyse hiç Enter basılmaz', async () => {
    const { executor } = makeAgent()
    const node = createNode('type', 0, 0)
    node.text = 'C:\\Resimler'
    node.pressEnter = false
    fake.secondResult = { via: 'value' }
    await executor.type(node, 1, conditionAhead())
    expect(fake.enterByWorker + fake.enterByAgent).toBe(0)
  })
})
