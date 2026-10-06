import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode, type LogLevel } from '../electron/graph-types'
import { runGraph, type Executor } from '../electron/runner'

/** The manual gesture: the run broke inside a package, so the user selects that exact node and starts from it. */
function recorder() {
  const clicked: string[] = []
  const logs: { level: LogLevel; message: string }[] = []
  const ex: Executor = {
    log: (level, message) => logs.push({ level, message }),
    step: () => {},
    shouldStop: () => false,
    click: async (node: AgentNode) => {
      clicked.push(node.prompt ?? '')
    },
    type: async () => {},
    key: async () => {},
    exists: async () => true,
  }
  return { ex, clicked, logs }
}

let seq = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `e${++seq}`, from: from.id, fromPort, to: to.id })

describe('paketin içinde koptuğu yerden elle devam', () => {
  /** Kök: Başlangıç → Her Öğe İçin (g1, g2) → [Paket → içi: Başlangıç → A → B → C] */
  function build() {
    const root = createNode('start', 0, 0)
    const loop = createNode('loop', 200, 100)
    loop.items = ['g1', 'g2']
    const pkg = createNode('package', 300, 150)
    const innerStart = createNode('start', 0, 0)
    const a = createNode('click', 100, 0)
    a.prompt = 'A'
    const b = createNode('click', 200, 0)
    b.prompt = 'B'
    const c = createNode('click', 300, 0)
    c.prompt = 'C'
    pkg.inner = { nodes: [innerStart, a, b, c], edges: [edge(innerStart, 'next', a), edge(a, 'next', b), edge(b, 'next', c)] }
    loop.members = [pkg.id]
    const graph: AgentGraph = { nodes: [root, loop, pkg], edges: [edge(root, 'next', loop)] }
    return { graph, loop, a, b, c, pkg }
  }

  it('B’de kopmuşsa B’den devam eder, A tekrar edilmez, sonra sıradaki öğe baştan işlenir', async () => {
    const { graph, pkg, b } = build()
    const { ex, clicked } = recorder()

    await runGraph(graph, ex, { maxSteps: 100, stepDelayMs: 0, startId: b.id, packagePath: [pkg.id], resume: true })

    expect(clicked).toEqual(['B', 'C', 'A', 'B', 'C'])
  })

  it('paket yoksa da aynı mantık: kutunun içindeki koptuğu node’dan devam edilir', async () => {
    const root = createNode('start', 0, 0)
    const loop = createNode('loop', 200, 100)
    loop.items = ['g1', 'g2']
    const a = createNode('click', 100, 0)
    a.prompt = 'A'
    const b = createNode('click', 200, 0)
    b.prompt = 'B'
    const c = createNode('click', 300, 0)
    c.prompt = 'C'
    loop.members = [a.id, b.id, c.id]
    const graph: AgentGraph = { nodes: [root, loop, a, b, c], edges: [edge(root, 'next', loop), edge(a, 'next', b), edge(b, 'next', c)] }
    const { ex, clicked } = recorder()

    await runGraph(graph, ex, { maxSteps: 100, stepDelayMs: 0, startId: b.id, resume: true })

    // g1 için B ve C işlenir (A tekrar edilmez), sonra g2 baştan işlenir.
    expect(clicked).toEqual(['B', 'C', 'A', 'B', 'C'])
  })

  it('paketi seçip çalıştırırsan paket kendi başından başlar', async () => {
    const { graph, pkg } = build()
    const { ex, clicked } = recorder()

    await runGraph(graph, ex, { maxSteps: 100, stepDelayMs: 0, startId: pkg.id, resume: true })

    // İşaretli öğe için paket baştan: A, B, C. Sonra sıradaki öğe de baştan: A, B, C.
    expect(clicked).toEqual(['A', 'B', 'C', 'A', 'B', 'C'])
  })

  it('hatırlanan öğe 2. ise: iç node seçilirse o node’dan, hatırlanan öğe için devam edilir', async () => {
    const { graph, loop, pkg, b } = build()
    loop.startIndex = 1 // döngü 2. öğede (g2) kalmış
    const { ex, clicked } = recorder()

    await runGraph(graph, ex, { maxSteps: 100, stepDelayMs: 0, startId: b.id, packagePath: [pkg.id], resume: true })

    // Yalnız hatırlanan öğe (g2) işlenir ve B’den başlanır: A tekrar yok, g1 de tekrar yok.
    expect(clicked).toEqual(['B', 'C'])
  })

  it('hatırlanan öğe 2. ise: paket seçilirse aynı öğe kullanılır, paket baştan başlar', async () => {
    const { graph, loop, pkg } = build()
    loop.startIndex = 1 // döngü 2. öğede (g2) kalmış
    const { ex, clicked } = recorder()

    await runGraph(graph, ex, { maxSteps: 100, stepDelayMs: 0, startId: pkg.id, resume: true })

    // Yalnız hatırlanan öğe (g2) işlenir; paket kendi başından: A, B, C. g1 tekrar yok.
    expect(clicked).toEqual(['A', 'B', 'C'])
  })
})
