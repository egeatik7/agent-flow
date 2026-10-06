import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode, type LogLevel } from '../electron/graph-types'
import { probeOnce } from '../electron/tool-probe'
import type { Executor } from '../electron/runner'

let seq = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `e${++seq}`, from: from.id, fromPort, to: to.id })

function recorder() {
  const clicked: string[] = []
  const logs: { level: LogLevel; message: string }[] = []
  const base: Executor = {
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
  return { base, clicked, logs }
}

const click = (prompt: string) => {
  const n = createNode('click', 0, 0)
  n.prompt = prompt
  return n
}

describe('tek adım: izole çalıştırma', () => {
  it('yalnız seçilen node çalışır; kutunun sonraki üyesi çalışmaz', async () => {
    const root = createNode('start', 0, 0)
    const loop = createNode('loop', 100, 0)
    loop.items = ['g1', 'g2']
    const a = click('A')
    const b = click('B')
    loop.members = [a.id, b.id]
    const graph: AgentGraph = { nodes: [root, loop, a, b], edges: [edge(root, 'next', loop), edge(a, 'next', b)] }
    const { base, clicked } = recorder()

    const r = await probeOnce(graph, a.id, base, { maxSteps: 50, stepDelayMs: 0 })

    expect(clicked).toEqual(['A'])
    expect(r).toEqual({ reachedNode: true, nodeStatus: 'done', interrupted: false })
  })

  it('kutunun işareti ve tur sayacı değişmez', async () => {
    const root = createNode('start', 0, 0)
    const loop = createNode('loop', 100, 0)
    loop.items = ['g1', 'g2']
    loop.startIndex = 1
    const a = click('A')
    const b = click('B')
    loop.members = [a.id, b.id]
    const graph: AgentGraph = { nodes: [root, loop, a, b], edges: [edge(root, 'next', loop), edge(a, 'next', b)] }
    const { base, clicked } = recorder()

    await probeOnce(graph, b.id, base, { maxSteps: 50, stepDelayMs: 0 })

    expect(clicked).toEqual(['B'])
    expect(loop.startIndex).toBe(1)
    expect(loop.loopIndex).toBeUndefined()
  })

  it('paketin içindeki node çalışır, paketten sonraki adım çalışmaz', async () => {
    const root = createNode('start', 0, 0)
    const pkg = createNode('package', 100, 0)
    const after = click('AFTER')
    const innerStart = createNode('start', 0, 0)
    const c = click('C')
    pkg.inner = { nodes: [innerStart, c], edges: [edge(innerStart, 'next', c)] }
    const graph: AgentGraph = { nodes: [root, pkg, after], edges: [edge(root, 'next', pkg), edge(pkg, 'next', after)] }
    const { base, clicked } = recorder()

    const r = await probeOnce(graph, c.id, base, { maxSteps: 50, stepDelayMs: 0, packagePath: [pkg.id] })

    expect(clicked).toEqual(['C'])
    expect(r.nodeStatus).toBe('done')
  })

  it('kullanıcı durdurduysa hiçbir şey çalışmaz ve durum bildirilir', async () => {
    const root = createNode('start', 0, 0)
    const a = click('A')
    const graph: AgentGraph = { nodes: [root, a], edges: [edge(root, 'next', a)] }
    const { base, clicked } = recorder()

    const r = await probeOnce(graph, a.id, base, { maxSteps: 50, stepDelayMs: 0, userStop: () => true })

    expect(clicked).toEqual([])
    expect(r).toEqual({ reachedNode: false, nodeStatus: 'none', interrupted: true })
  })

  it('node hata verirse hata dışarı çıkar, sessizce yutulmaz', async () => {
    const root = createNode('start', 0, 0)
    const a = click('A')
    const graph: AgentGraph = { nodes: [root, a], edges: [edge(root, 'next', a)] }
    const { base } = recorder()
    const failing: Executor = {
      ...base,
      click: async () => {
        throw new Error('tıklama patladı')
      },
    }

    await expect(probeOnce(graph, a.id, failing, { maxSteps: 50, stepDelayMs: 0 })).rejects.toThrow('tıklama patladı')
  })
})
