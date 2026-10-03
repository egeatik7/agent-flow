import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode, type LogLevel } from '../electron/graph-types'
import { runGraph, type Executor } from '../electron/runner'

type Line = { level: LogLevel; message: string }

/** Sahte yürütücü: gerçek ekran yok. `failOn` içindeki tıklama metinleri hata verir. */
function fakeExecutor(failOn: string[]) {
  const logs: Line[] = []
  const clicked: string[] = []
  const ex: Executor = {
    log: (level, message) => logs.push({ level, message }),
    step: () => {},
    shouldStop: () => false,
    click: async (node: AgentNode) => {
      const what = node.prompt ?? ''
      clicked.push(what)
      if (failOn.includes(what)) throw new Error(`hedef yok: ${what}`)
    },
    type: async () => {},
    key: async () => {},
    exists: async () => true,
  }
  return { ex, logs, clicked }
}

const opts = { maxSteps: 100, stepDelayMs: 0 }
let edgeNo = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `e${++edgeNo}`, from: from.id, fromPort, to: to.id })

/** Başlangıç → Her Öğe İçin(items) → [Tıkla "{{öğe.ad}}"] */
function listGraph(items: string[]): AgentGraph {
  const start = createNode('start', 0, 0)
  const click = createNode('click', 200, 100)
  click.prompt = '{{öğe.ad}}'
  const loop = createNode('loop', 150, 50)
  loop.items = items
  loop.members = [click.id]
  return { nodes: [start, loop, click], edges: [edge(start, 'next', loop)] }
}

/** Başlangıç → dış döngü(2 öğe) → [iç döngü(3 tur) → [Tıkla "{{öğe}}"]] */
function nestedGraph(): AgentGraph {
  const start = createNode('start', 0, 0)
  const click = createNode('click', 300, 200)
  click.prompt = '{{öğe}}'
  const inner = createNode('loop', 250, 150)
  inner.count = 3
  inner.members = [click.id]
  const outer = createNode('loop', 200, 100)
  outer.items = ['x', 'y']
  outer.members = [inner.id]
  return { nodes: [start, outer, inner, click], edges: [edge(start, 'next', outer)] }
}

describe('Döngü sonucu doğru raporlanır', () => {
  it('hepsi başarılıysa mevcut mesajlar aynen kalır', async () => {
    const { ex, logs } = fakeExecutor([])
    await runGraph(listGraph(['a.png', 'b.png', 'c.png']), ex, opts)
    expect(logs.some((l) => l.level === 'success' && /bitti: 3 öğe çalıştı/.test(l.message))).toBe(true)
    const final = logs.filter((l) => /Akış tamamlandı/.test(l.message))
    expect(final).toHaveLength(1)
    expect(final[0].level).toBe('success')
    expect(final[0].message).not.toMatch(/hata/)
  })

  it('bir öğe hata verirse özet "tamam / hatalı" der, öğe adını gösterir ve yeşil başarı yazmaz', async () => {
    const { ex, logs, clicked } = fakeExecutor(['b.png'])
    await runGraph(listGraph(['a.png', 'b.png', 'c.png']), ex, opts)

    // Hatalı öğeden sonra sıradaki öğe yine çalışır (mevcut davranış korunur).
    expect(clicked).toEqual(['a.png', 'b.png', 'c.png'])

    const summary = logs.find((l) => /bitti:/.test(l.message))
    expect(summary).toBeDefined()
    expect(summary!.level).toBe('warn')
    expect(summary!.message).toMatch(/2 tamam/)
    expect(summary!.message).toMatch(/1 hatalı/)
    expect(summary!.message).toContain('b.png')
    expect(logs.some((l) => l.level === 'success' && /bitti: 3 öğe çalıştı/.test(l.message))).toBe(false)
  })

  it('akışın son satırı da hatalı sayısını söyler ve yeşil başarı olmaz', async () => {
    const { ex, logs } = fakeExecutor(['b.png'])
    await runGraph(listGraph(['a.png', 'b.png', 'c.png']), ex, opts)
    const final = logs.filter((l) => /Akış tamamlandı/.test(l.message))
    expect(final).toHaveLength(1)
    expect(final[0].level).toBe('warn')
    expect(final[0].message).toMatch(/1 öğe\/tur hatayla bitti/)
  })

  it('iç içe döngülerde hatalar toplanır', async () => {
    // İç döngünün 2. turu ({{öğe}} = "2") her dış öğede hata verir: toplam 2 hata, 6 turdan.
    const { ex, logs } = fakeExecutor(['2'])
    await runGraph(nestedGraph(), ex, opts)
    const final = logs.find((l) => /Akış tamamlandı/.test(l.message))
    expect(final).toBeDefined()
    expect(final!.level).toBe('warn')
    expect(final!.message).toMatch(/2 öğe\/tur hatayla bitti/)
  })
})
