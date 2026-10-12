import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNode, NODE_SPECS, type AgentGraph } from '../electron/graph-types'

/**
 * Ölçülen istek (1.9.104): Zamanlayıcı adımı sürerken masaüstü bilgi kartının İÇİNDE canlı geri sayım
 * görünsün ve adım bitince kaybolsun. Node adı zaten yöntem satırında (aşağıda) yazıyor.
 */
const source = ts.createSourceFile('main.ts', readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const FUNCS = ['sn', 'pushCountdown', 'stopHudCountdown', 'startHudCountdown', 'pushMethod', 'hudStep']
const CONSTS = ['HUD_COUNTDOWN_MS', 'LOGGED_STEP_KINDS', 'hudCountdown']
const parts: string[] = []
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && FUNCS.includes(node.name.text)) parts.push(node.getText(source))
  if (ts.isVariableStatement(node)) {
    const name = node.declarationList.declarations[0]?.name
    if (ts.isIdentifier(name) && CONSTS.includes(name.text)) parts.push(node.getText(source))
  }
  ts.forEachChild(node, visit)
}
visit(source)
if (parts.length !== FUNCS.length + CONSTS.length) throw Error(`main.ts içinde beklenen gövdeler bulunamadı: ${FUNCS.join(', ')}`)

const compiled = ts.transpileModule(`${parts.join('\n')}\n({ hudStep, sn });`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

type Harness = {
  hudStep(payload: unknown): void
  sn(ms: number): string
  /** Kartın geri sayım satırının SON hâli (boş = satır yok). */
  countdown(): string
  methods: string[]
  cards: { level: string; text: string }[]
  state: { running: boolean; derived: boolean }
  tikSayisi: () => number
}

function harness(graph: AgentGraph): Harness {
  const methods: string[] = []
  const cards: { level: string; text: string }[] = []
  let sayac = ''
  let tik = 0
  const state = { running: true, derived: false }
  const context = {
    state,
    methods,
    cards,
    // Sahte zamanlayıcı: vi.useFakeTimers ile birlikte çalışsın diye ana ortamdan verilir.
    setInterval: (fn: () => void, ms: number) => { tik += 1; return setInterval(fn, ms) },
    clearInterval: (id: unknown) => clearInterval(id as ReturnType<typeof setInterval>),
    // VM'in kendi Date'i sahte saati görmez; bu yüzden ana ortamın (sahte) Date'i verilir.
    Date: { now: () => Date.now() },
    findPlace: (g: AgentGraph, id: string) => {
      for (const n of g.nodes) {
        if (n.id === id) return { node: n }
        const inner = (n as { inner?: { nodes?: { id: string }[] } }).inner?.nodes?.find((x) => x.id === id)
        if (inner) return { node: inner }
      }
      return null
    },
    NODE_SPECS,
    viewerState: { event: () => {} },
    get running() { return state.running },
    get derivedRun() { return state.derived },
    get recoveryActive() { return false },
    get hudRunGraph() { return graph },
    hudWindow: { isDestroyed: () => false },
    pushHud: (level: string, text: string) => { cards.push({ level, text }) },
    deliverHud: (channel: string, payload: { text?: string }) => {
      if (channel === 'hud:method') methods.push(String(payload.text ?? ''))
      if (channel === 'hud:countdown') sayac = String(payload.text ?? '')
    },
  }
  const cb = runInNewContext(compiled, context) as { hudStep(payload: unknown): void; sn(ms: number): string }
  return { hudStep: cb.hudStep, sn: cb.sn, countdown: () => sayac, methods, cards, state, tikSayisi: () => tik }
}

const graphOf = (...nodes: ReturnType<typeof createNode>[]): AgentGraph => ({ nodes, edges: [] })
const zamanlayici = (ms: number, title = 'Zamanlayıcı 1') => ({ ...createNode('wait', 0, 0), title, ms })
const tikla = () => ({ ...createNode('click', 0, 0), title: 'Tıkla 1' })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('bilgi kartında zamanlayıcı geri sayımı', () => {
  it('zamanlayıcı adımı başlayınca kartta kalan süre görünür ve her 200 ms tazelenir', () => {
    const zaman = zamanlayici(5000)
    const h = harness(graphOf(zaman))
    h.hudStep({ id: zaman.id, status: 'running' })
    expect(h.countdown()).toBe('Zamanlayıcı · Zamanlayıcı 1 · kalan 5,0 / 5,0 sn')
    vi.advanceTimersByTime(2000)
    expect(h.countdown()).toBe('Zamanlayıcı · Zamanlayıcı 1 · kalan 3,0 / 5,0 sn')
    vi.advanceTimersByTime(1000)
    expect(h.countdown()).toBe('Zamanlayıcı · Zamanlayıcı 1 · kalan 2,0 / 5,0 sn')
    // Adı aşağıdaki yöntem satırında da yazıyor.
    expect(h.methods.at(-1)).toBe('Zamanlayıcı · Zamanlayıcı 1')
  })

  it('adım bitince (done) ve sıradaki adım başlayınca geri sayım kaybolur', () => {
    const zaman = zamanlayici(9000)
    const tik = tikla()
    const h = harness(graphOf(zaman, tik))
    h.hudStep({ id: zaman.id, status: 'running' })
    expect(h.countdown()).not.toBe('')
    h.hudStep({ id: zaman.id, status: 'done' })
    expect(h.countdown()).toBe('')
    h.hudStep({ id: tik.id, status: 'running' })
    expect(h.countdown()).toBe('')
    expect(h.methods.at(-1)).toBe('Tıkla · Tıkla 1')
  })

  it('süre bitince sayaç kendini bırakır ve satır "0,0" olarak kalır', () => {
    const zaman = zamanlayici(1000)
    const h = harness(graphOf(zaman))
    h.hudStep({ id: zaman.id, status: 'running' })
    vi.advanceTimersByTime(1400)
    expect(h.countdown()).toBe('Zamanlayıcı · Zamanlayıcı 1 · kalan 0,0 / 1,0 sn')
    const tik = h.tikSayisi()
    vi.advanceTimersByTime(2000)
    expect(h.countdown()).toBe('Zamanlayıcı · Zamanlayıcı 1 · kalan 0,0 / 1,0 sn')
    expect(h.tikSayisi()).toBe(tik) // yeni sayaç kurulmadı: kendini bıraktı
  })

  it('süresi 0 olan zamanlayıcıda geri sayım satırı hiç açılmaz, kart satırı yazılmaz', () => {
    const zaman = zamanlayici(0, 'Sıfır Zamanlayıcı')
    const h = harness(graphOf(zaman))
    h.hudStep({ id: zaman.id, status: 'running' })
    expect(h.countdown()).toBe('')
    // Zamanlayıcı kendi günlük satırını yazar: kart metni burada çiftlenmez.
    expect(h.cards).toHaveLength(0)
    expect(h.methods.at(-1)).toBe('Zamanlayıcı · Sıfır Zamanlayıcı')
  })

  it('zamanlayıcıdan sonra gelen zamanlayıcı önceki sayacı devralmaz, yeni toplamla başlar', () => {
    const birinci = zamanlayici(5000, 'Birinci')
    const ikinci = zamanlayici(2000, 'İkinci')
    const h = harness(graphOf(birinci, ikinci))
    h.hudStep({ id: birinci.id, status: 'running' })
    vi.advanceTimersByTime(3000)
    expect(h.countdown()).toContain('kalan 2,0 / 5,0')
    h.hudStep({ id: ikinci.id, status: 'running' })
    expect(h.countdown()).toBe('Zamanlayıcı · İkinci · kalan 2,0 / 2,0 sn')
    vi.advanceTimersByTime(1000)
    expect(h.countdown()).toBe('Zamanlayıcı · İkinci · kalan 1,0 / 2,0 sn')
  })

  it('koşu sürerken değilken ve türetilmiş koşuda sayaç kurulmaz', () => {
    const zaman = zamanlayici(5000)
    const h = harness(graphOf(zaman))
    h.state.running = false
    h.hudStep({ id: zaman.id, status: 'running' })
    expect(h.countdown()).toBe('')
    h.state.running = true
    h.state.derived = true
    h.hudStep({ id: zaman.id, status: 'running' })
    expect(h.countdown()).toBe('')
  })

  it('saniye biçimi Türkçe ondalık virgülle yazılır', () => {
    const h = harness(graphOf(zamanlayici(1000)))
    expect(h.sn(5000)).toBe('5,0')
    expect(h.sn(3200)).toBe('3,2')
    expect(h.sn(0)).toBe('0,0')
    expect(h.sn(-40)).toBe('0,0')
  })
})
