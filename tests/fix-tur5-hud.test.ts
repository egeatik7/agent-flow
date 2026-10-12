import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { createNode, NODE_SPECS, type AgentGraph } from '../electron/graph-types'

/**
 * Ölçülen kusur (1.9.100): masaüstü bilgi kartının yöntem satırı yalnız Tıkla/Yaz/Koşul yollarında
 * yazılıyordu ve hiçbir node başlangıcında sıfırlanmıyordu; Koşul'dan Zamanlayıcı'ya geçildiğinde
 * kartta hâlâ "Koşul: …" yazıyordu. Kart artık her adım başlangıcında çalışan node'u adıyla yazar.
 */
const source = ts.createSourceFile('main.ts', readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const parts: string[] = []
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && ['pushMethod', 'hudStep'].includes(node.name.text)) parts.push(node.getText(source))
  if (ts.isVariableStatement(node)) {
    const name = node.declarationList.declarations[0]?.name
    if (ts.isIdentifier(name) && name.text === 'LOGGED_STEP_KINDS') parts.push(node.getText(source))
  }
  ts.forEachChild(node, visit)
}
visit(source)
if (parts.length !== 3) throw Error('hudStep, pushMethod ve LOGGED_STEP_KINDS main.ts içinde bulunmalı.')

const compiled = ts.transpileModule(`${parts.join('\n')}\n({ hudStep, pushMethod, LOGGED_STEP_KINDS });`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

type Harness = {
  hudStep(payload: unknown): void
  methods: string[]
  cards: { level: string; text: string }[]
  state: { running: boolean; derived: boolean; recovery: boolean }
}

function harness(graph: AgentGraph): Harness {
  const methods: string[] = []
  const cards: { level: string; text: string }[] = []
  const state = { running: true, derived: false, recovery: false }
  const context = {
    state,
    methods,
    cards,
    findPlace: (g: AgentGraph, id: string) => {
      for (const n of g.nodes) {
        if (n.id === id) return { node: n }
        if (n.inner?.nodes?.some((inner) => inner.id === id)) return { node: n.inner.nodes.find((inner) => inner.id === id) }
      }
      return null
    },
    NODE_SPECS,
    viewerState: { event: () => {} },
    get running() { return state.running },
    get derivedRun() { return state.derived },
    get recoveryActive() { return state.recovery },
    get hudRunGraph() { return graph },
    hudWindow: { isDestroyed: () => false },
    // Kart metni (hud:status) kaydı: gerçek pushHud'un HUD satırına yazdığı yer.
    pushHud: (level: string, text: string) => { cards.push({ level, text }) },
    deliverHud: (channel: string, payload: { text?: string; level?: string }) => {
      if (channel === 'hud:method') methods.push(String(payload.text ?? ''))
    },
  }
  const callbacks = runInNewContext(compiled, context) as { hudStep(payload: unknown): void }
  return { hudStep: callbacks.hudStep, methods, cards, state }
}

const graphOf = (...nodes: ReturnType<typeof createNode>[]): AgentGraph => ({ nodes, edges: [] })

describe('masaüstü bilgi kartı node değişimini gösterir', () => {
  it('Koşuldan Zamanlayıcıya geçince yöntem satırı yeni node adını yazar', () => {
    const kosul = { ...createNode('condition', 0, 0), title: 'Koşul 1' }
    const zaman = { ...createNode('wait', 0, 0), title: 'Zamanlayıcı 1' }
    const h = harness(graphOf(kosul, zaman))
    h.hudStep({ id: kosul.id, status: 'running' })
    expect(h.methods.at(-1)).toBe('Koşul · Koşul 1')
    h.hudStep({ id: zaman.id, status: 'running' })
    expect(h.methods.at(-1)).toBe('Zamanlayıcı · Zamanlayıcı 1')
    expect(h.methods.at(-1)).not.toContain('Koşul')
  })

  it('kendi günlük satırı olmayan node türlerinde kart metni de güncellenir, olanlarda çift satır yazılmaz', () => {
    const zaman = { ...createNode('wait', 0, 0), title: 'Zamanlayıcı 1' }
    const tikla = { ...createNode('click', 0, 0), title: 'Tıkla 1' }
    const dongu = { ...createNode('loop', 0, 0), title: 'Her Öğe İçin 1' }
    const h = harness(graphOf(zaman, tikla, dongu))
    h.hudStep({ id: zaman.id, status: 'running' })
    expect(h.cards).toHaveLength(0)
    h.hudStep({ id: tikla.id, status: 'running' })
    expect(h.cards).toHaveLength(0)
    h.hudStep({ id: dongu.id, status: 'running' })
    expect(h.cards.at(-1)?.text).toBe('Her Öğe İçin: Her Öğe İçin 1')
    expect(h.methods.at(-1)).toBe('Her Öğe İçin · Her Öğe İçin 1')
  })

  it('aynı adlı node etiketi tekrar yazılmaz ve yalnız "running" adımı kartı tazeler', () => {
    const tikla = { ...createNode('click', 0, 0) }
    const h = harness(graphOf(tikla))
    expect(tikla.title).toBe(`${NODE_SPECS.click.label} 1`)
    h.hudStep({ id: tikla.id, status: 'running' })
    expect(h.methods.at(-1)).toBe('Tıkla · Tıkla 1')
    const before = h.methods.length
    h.hudStep({ id: tikla.id, status: 'done' })
    h.hudStep({ id: 'yok-boyle-node', status: 'running' })
    expect(h.methods.length).toBe(before)
  })

  it('koşu sürerken değilken ve türetilmiş (branch) koşuda kart güncellenmez', () => {
    const tikla = { ...createNode('click', 0, 0) }
    const h = harness(graphOf(tikla))
    h.state.running = false
    h.hudStep({ id: tikla.id, status: 'running' })
    expect(h.methods).toHaveLength(0)
    h.state.running = true
    h.state.derived = true
    h.hudStep({ id: tikla.id, status: 'running' })
    expect(h.methods).toHaveLength(0)
  })

  it('kurtarma sürerken yöntem satırı kurtarma bağlamıyla yazılır', () => {
    const tikla = { ...createNode('click', 0, 0), title: 'Tıkla 1' }
    const h = harness(graphOf(tikla))
    h.state.recovery = true
    h.hudStep({ id: tikla.id, status: 'running' })
    expect(h.methods.at(-1)).toBe('Kurtarma ajanı · Tıkla · Tıkla 1')
  })

  it('paket içindeki node da adıyla gösterilir', () => {
    const inner = { ...createNode('wait', 0, 0), title: 'İç Zamanlayıcı' }
    const paket = { ...createNode('package', 0, 0), title: 'Paket 1', inner: { nodes: [inner], edges: [] } }
    const h = harness(graphOf(paket))
    h.hudStep({ id: inner.id, status: 'running' })
    expect(h.methods.at(-1)).toBe('Zamanlayıcı · İç Zamanlayıcı')
  })
})
