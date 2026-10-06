import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode } from '../electron/graph-types'
import { beginProbe, beginRun, endProbe, endRun, noteError, noteStep, probing, snapshot } from '../electron/tool-state'

let seq = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `e${++seq}`, from: from.id, fromPort, to: to.id })

/** Kök: Başlangıç → kutu(Gruplar, 3 öğe) → [Paket → içi: Başlangıç → Tıkla] */
function fixture() {
  const root = createNode('start', 0, 0)
  const loop = createNode('loop', 100, 0)
  loop.title = 'Gruplar'
  loop.items = ['g1', 'g2', 'g3']
  const pkg = createNode('package', 200, 0)
  pkg.title = 'Blender grubu'
  const innerStart = createNode('start', 0, 0)
  const click = createNode('click', 0, 0)
  click.title = 'Remesh başlat'
  pkg.inner = { nodes: [innerStart, click], edges: [edge(innerStart, 'next', click)] }
  loop.members = [pkg.id]
  const graph: AgentGraph = { nodes: [root, loop, pkg], edges: [edge(root, 'next', loop)] }
  return { graph, loop, pkg, click }
}

describe('koşu gözlemi', () => {
  it('adım olaylarından node’u, kutuyu ve öğeyi çıkarır', () => {
    const { graph, loop, click } = fixture()
    loop.startIndex = 1
    beginRun(graph)

    noteStep({ id: click.id, status: 'running' })
    const s = snapshot()
    expect(s.nodeId).toBe(click.id)
    expect(s.nodeTitle).toBe('Remesh başlat')
    expect(s.loops.map((l) => l.title)).toEqual(['Gruplar'])
    expect(s.loops[0].item).toBe('g2')
    expect(s.packagePath).toEqual([fixturePkgId(graph)])
    expect(s.steps).toEqual({ done: 0, errors: 0 })

    noteStep({ id: click.id, status: 'done' })
    expect(snapshot().steps.done).toBe(1)
    expect(snapshot().nodeId).toBeUndefined()

    endRun()
    expect(snapshot().loops).toEqual([])
    expect(snapshot().probing).toBe(false)
  })

  it('hata satırını ve tek adım bayrağını taşır', () => {
    const { graph, click } = fixture()
    beginRun(graph)
    noteError('hedef bulunamadı')
    noteStep({ id: click.id, status: 'error' })
    expect(snapshot().lastError).toBe('hedef bulunamadı')
    expect(snapshot().steps.errors).toBe(1)

    beginProbe(click.id)
    expect(probing()).toBe(true)
    expect(snapshot().nodeId).toBe(click.id)
    expect(snapshot().probing).toBe(true)

    endProbe()
    expect(probing()).toBe(false)
    endRun()
  })

  it('bozuk adım yükünü yok sayar', () => {
    const { graph } = fixture()
    beginRun(graph)
    noteStep(null)
    noteStep({ status: 'done' })
    noteStep({ id: 5, status: 'done' })
    expect(snapshot().steps).toEqual({ done: 0, errors: 0 })
    endRun()
  })
})

/** The single package id of the fixture, without repeating the literal in assertions. */
function fixturePkgId(graph: AgentGraph): string {
  const pkg = graph.nodes.find((n) => n.kind === 'package')
  return pkg ? pkg.id : ''
}
