import { describe, expect, it } from 'vitest'
import { createNode, type AgentEdge, type AgentGraph, type AgentNode } from '../electron/graph-types'
import { applyPlan, describePlan, diffGraphs, graphStamp, planOps, type EditOp } from '../electron/tool-edit'

function edge(from: AgentNode, port: string, to: AgentNode): AgentEdge {
  return { id: `e-${from.id}-${port}-${to.id}`, from: from.id, fromPort: port, to: to.id }
}

function fixture() {
  const start = createNode('start', 0, 0)
  const click = createNode('click', 300, 0)
  click.prompt = 'Remesh başlat'
  const cond = createNode('condition', 600, 0)
  cond.text = 'Remesh bitti'
  const end = createNode('end', 900, 0)
  const graph: AgentGraph = {
    nodes: [start, click, cond, end],
    edges: [edge(start, 'next', click), edge(click, 'next', cond), edge(cond, 'true', end)],
  }
  return { graph, start, click, cond, end }
}

function run(graph: AgentGraph, ops: EditOp[]) {
  const check = planOps(graph, ops)
  const after = check.ok ? applyPlan(graph, check.plan) : null
  return { check, after }
}

describe('düzenleme planı', () => {
  it('node ekler, sonraki işlemlerden ona anahtarla atıf yapar ve bağlar', () => {
    const { graph, click, cond } = fixture()
    const { check, after } = run(graph, [
      { op: 'disconnect', from: click.id },
      { op: 'addNode', key: 'bekle', kind: 'wait', fields: { ms: 1500 }, connectFrom: click.id },
      { op: 'patchNode', id: 'bekle', fields: { title: 'Remesh için bekle' } },
      { op: 'connect', from: 'bekle', to: cond.id },
      { op: 'addNode', key: 'bilgi', kind: 'key', fields: { keys: '{ESC}' } },
      { op: 'connect', from: cond.id, to: 'bilgi', fromPort: 'false' },
    ])

    expect(check.errors).toEqual([])
    expect(check.ok).toBe(true)
    expect(after).not.toBeNull()
    const nodes = (after as AgentGraph).nodes
    const added = nodes.filter((n) => n.title === 'Remesh için bekle')
    expect(added).toHaveLength(1)
    expect(added[0].kind).toBe('wait')
    expect(added[0].ms).toBe(1500)
    const portName = added[0].id
    const keys = nodes.find((n) => n.kind === 'key' && n.keys === '{ESC}')
    expect(keys).toBeTruthy()

    const edges = (after as AgentGraph).edges
    // click'in eski çıkışı kaldırıldı, yenisi bekle'ye gidiyor.
    expect(edges.some((e) => e.from === click.id && e.fromPort === 'next' && e.to === added[0].id)).toBe(true)
    expect(edges.some((e) => e.from === click.id && e.fromPort === 'next' && e.to === cond.id)).toBe(false)
    expect(edges.some((e) => e.from === added[0].id && e.fromPort === 'next' && e.to === cond.id)).toBe(true)
    expect(edges.some((e) => e.from === cond.id && e.fromPort === 'false' && e.to === (keys as AgentNode).id)).toBe(true)
    expect(portName).toBeTruthy()
  })

  it('hedefsiz yazı adımını ekler ama açıkça uyarır', () => {
    const { graph, cond } = fixture()
    const blind = run(graph, [{ op: 'addNode', key: 't', kind: 'type', fields: { text: 'deneme' }, connectFrom: cond.id, fromPort: 'false' }])
    expect(blind.check.ok).toBe(true)
    expect(blind.check.warnings.join(' ')).toContain('hedefsiz')

    const aimed = run(graph, [
      { op: 'addNode', key: 't', kind: 'type', fields: { text: 'deneme', prompt: 'Kaydet' }, connectFrom: cond.id, fromPort: 'false' },
    ])
    expect(aimed.check.ok).toBe(true)
    expect(aimed.check.warnings).toEqual([])
  })

  it('verilen grafiği değiştirmez; yeni grafik döndürür', () => {
    const { graph, click, cond } = fixture()
    const before = JSON.stringify(graph)
    const { check, after } = run(graph, [{ op: 'addNode', kind: 'wait', fields: { ms: 500 }, connectFrom: click.id }])
    expect(check.ok).toBe(true)
    expect(JSON.stringify(graph)).toBe(before)
    expect((after as AgentGraph).nodes).toHaveLength(graph.nodes.length + 1)
    expect((after as AgentGraph).edges.some((e) => e.to === cond.id)).toBe(true)
  })

  it('hedef kanıtına ve koşu durumuna dokunmayı reddeder', () => {
    const { graph, click } = fixture()
    for (const banned of ['locator', 'memory', 'anchor', 'path', 'trace', 'icon', 'iconKey', 'loopIndex', 'startIndex', 'inner']) {
      const { check } = run(graph, [{ op: 'patchNode', id: click.id, fields: { [banned]: 'x' } }])
      expect(check.ok).toBe(false)
      expect(check.errors[0]).toContain(banned)
    }
  })

  it('eklenemeyen türleri reddeder, yanlış alan tipini yakalar', () => {
    const { graph, click } = fixture()
    for (const kind of ['start', 'package', 'loop', 'browser', 'waitFile', 'yok']) {
      const { check } = run(graph, [{ op: 'addNode', kind: kind as never }])
      expect(check.ok).toBe(false)
    }
    const bad = run(graph, [{ op: 'patchNode', id: click.id, fields: { ms: 'çok' } }])
    expect(bad.check.ok).toBe(false)
    expect(bad.check.errors[0]).toContain('sayı')
    const badItems = run(graph, [{ op: 'patchNode', id: click.id, fields: { items: [1, 2] } }])
    expect(badItems.check.ok).toBe(false)
    const badMode = run(graph, [{ op: 'patchNode', id: click.id, fields: { clickMode: 'middle' } }])
    expect(badMode.check.ok).toBe(false)
    const negative = run(graph, [{ op: 'patchNode', id: click.id, fields: { count: -2 } }])
    expect(negative.check.ok).toBe(false)
    const emptyFields = run(graph, [{ op: 'patchNode', id: click.id, fields: {} }])
    expect(emptyFields.check.ok).toBe(false)
  })

  it('bilinmeyen node ve olmayan çıkış adını açıkça söyler', () => {
    const { graph, click, cond } = fixture()
    const missing = run(graph, [{ op: 'connect', from: 'yok-boyle', to: click.id }])
    expect(missing.check.ok).toBe(false)
    expect(missing.check.errors[0]).toContain('bulunamadı')

    const wrongPort = run(graph, [{ op: 'connect', from: click.id, to: cond.id, fromPort: 'true' }])
    expect(wrongPort.check.ok).toBe(false)
    expect(wrongPort.check.errors[0]).toContain('true')
    expect(wrongPort.check.errors[0]).toContain('next')
  })

  it('dolu çıkışa ikinci bağlantıyı reddeder: motor ilk oku izler', () => {
    const { graph, click, end } = fixture()
    const { check, after } = run(graph, [{ op: 'connect', from: click.id, to: end.id }])
    expect(check.ok).toBe(false)
    expect(check.errors[0]).toContain('zaten bir bağlantı')
    expect(after).toBeNull()

    // Aynı listede iki kez bağlamak da olmaz.
    const twice = run(graph, [
      { op: 'addNode', key: 'a', kind: 'wait' },
      { op: 'connect', from: 'a', to: click.id },
      { op: 'connect', from: 'a', to: end.id },
    ])
    expect(twice.check.ok).toBe(false)
  })

  it('bağlantı kaldırır: tek oku ya da çıkışın tamamını', () => {
    const { graph, cond, end } = fixture()
    const one = run(graph, [{ op: 'disconnect', from: cond.id, fromPort: 'true', to: end.id }])
    expect(one.check.ok).toBe(true)
    expect((one.after as AgentGraph).edges).toHaveLength(2)
    const none = run(graph, [{ op: 'disconnect', from: cond.id, fromPort: 'false' }])
    expect(none.check.ok).toBe(false)
    expect(none.check.errors[0]).toContain('bulunamadı')
  })

  it('yeni node’u çakışmayacak bir yere koyar', () => {
    const { graph, click } = fixture()
    const { check, after } = run(graph, [{ op: 'addNode', kind: 'wait', connectFrom: click.id }])
    expect(check.ok).toBe(true)
    const added = (after as AgentGraph).nodes.find((n) => n.kind === 'wait') as AgentNode
    expect(added.x).toBeGreaterThan(click.x)
    const clash = (after as AgentGraph).nodes.some((n) => n.id !== added.id && Math.abs(n.x - added.x) < 10 && Math.abs(n.y - added.y) < 10)
    expect(clash).toBe(false)

    // Kendi eklediği node'lar da üst üste binmez.
    const two = run(graph, [
      { op: 'addNode', key: 'a', kind: 'wait', connectFrom: click.id },
      { op: 'addNode', key: 'b', kind: 'wait', connectFrom: click.id },
    ])
    const waits = (two.after as AgentGraph).nodes.filter((n) => n.kind === 'wait')
    expect(waits).toHaveLength(2)
    expect(Math.abs(waits[0].y - waits[1].y) >= 100).toBe(true)
  })

  it('halkayı engellemez ama söyler', () => {
    const { graph, cond } = fixture()
    const ring = run(graph, [
      { op: 'addNode', key: 'a', kind: 'wait', connectFrom: cond.id, fromPort: 'false' },
      { op: 'addNode', key: 'b', kind: 'wait', connectFrom: 'a' },
      { op: 'connect', from: 'b', to: 'a' },
    ])
    expect(ring.check.errors).toEqual([])
    expect(ring.check.ok).toBe(true)
    expect(ring.check.warnings.join(' ')).toContain('halka')

    const clean = run(graph, [{ op: 'addNode', kind: 'wait', connectFrom: cond.id, fromPort: 'false' }])
    expect(clean.check.warnings).toEqual([])
  })

  it('Başlangıç’a ok çekmeyi ve kendine bağlanmayı reddeder', () => {
    const { graph, start, cond } = fixture()
    const intoStart = run(graph, [{ op: 'connect', from: cond.id, to: start.id, fromPort: 'false' }])
    expect(intoStart.check.ok).toBe(false)
    expect(intoStart.check.errors[0]).toContain('Başlangıç')

    const self = run(graph, [{ op: 'connect', from: cond.id, to: cond.id, fromPort: 'false' }])
    expect(self.check.ok).toBe(false)
    expect(self.check.errors[0]).toContain('kendine')
  })

  it('işlem sayısına ve boş listeye sınır koyar', () => {
    const { graph, click } = fixture()
    const many: EditOp[] = Array.from({ length: 51 }, () => ({ op: 'patchNode', id: click.id, fields: { title: 'x' } }))
    expect(run(graph, many).check.errors[0]).toContain('50')
    expect(run(graph, []).check.errors[0]).toContain('boş')
    expect(planOps(graph, 'bu liste değil').errors[0]).toContain('liste')
  })

  it('farkı ve insan satırlarını yazar', () => {
    const { graph, click } = fixture()
    const { check, after } = run(graph, [
      { op: 'patchNode', id: click.id, fields: { prompt: 'Remesh başlat (yeniden)' } },
      { op: 'addNode', key: 'w', kind: 'wait', fields: { ms: 800 }, connectFrom: click.id },
      { op: 'disconnect', from: click.id },
    ])
    expect(check.ok).toBe(true)
    const diff = diffGraphs(graph, after as AgentGraph)
    expect(diff.addedNodes).toHaveLength(1)
    expect(diff.changedNodes[0].fields).toEqual(['prompt'])
    expect(diff.summary).toContain('node eklendi')
    expect(diff.summary).toContain('node değişti')

    const lines = describePlan(graph, check.plan)
    expect(lines.some((l) => l.startsWith('+ Zamanlayıcı'))).toBe(true)
    expect(lines.some((l) => l.includes('→'))).toBe(true)
    expect(describePlan(graph, planOps(graph, []).plan)).toEqual([])
  })

  it('parmak izi anlamı ölçer, yerleşimi ve koşu durumunu ölçmez', () => {
    const { graph, click, cond } = fixture()
    const stamp = graphStamp(graph)

    const moved = structuredClone(graph)
    const movedClick = moved.nodes.find((n) => n.id === click.id) as AgentNode
    movedClick.x += 500
    movedClick.y += 120
    movedClick.loopIndex = 3
    movedClick.startIndex = 2
    movedClick.templated = true
    expect(graphStamp(moved)).toBe(stamp)

    const edited = structuredClone(graph)
    ;(edited.nodes.find((n) => n.id === click.id) as AgentNode).prompt = 'başka'
    expect(graphStamp(edited)).not.toBe(stamp)

    const rewired = structuredClone(graph)
    rewired.edges.push(edge(cond, 'false', click))
    expect(graphStamp(rewired)).not.toBe(stamp)

    const renamed = structuredClone(graph)
    ;(renamed.nodes.find((n) => n.id === click.id) as AgentNode).title = 'Başka başlık'
    expect(graphStamp(renamed)).not.toBe(stamp)
  })
})
