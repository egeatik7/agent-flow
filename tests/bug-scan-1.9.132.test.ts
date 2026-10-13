import { describe, expect, it } from 'vitest'
import { judgeScreen } from '../electron/confirm'
import { createNode, normalizeGraph, type AgentGraph } from '../electron/graph-types'
import { matchFuzzy, matchText, type ScreenItem } from '../electron/matcher'
import { runGraph } from '../electron/runner'
import { applyPlan } from '../electron/tool-edit'
import { withFastFind } from '../electron/tools'
import type { AppSettings } from '../electron/graph-types'

const item = (patch: Partial<ScreenItem> & Pick<ScreenItem, 'id' | 'text'>): ScreenItem => ({
  type: 'Button', src: 'uia', x: 0, y: 0, w: 40, h: 20, ...patch,
})

describe('1.9.132 bug taraması', () => {
  it('İndir aynı satırdaki İndirim kutusunu seçmez', () => {
    const line: ScreenItem = item({
      id: 1, text: 'İndirim İndir', src: 'ocr', type: 'Text', w: 140,
      words: [
        { t: 'İndirim', x: 0, y: 0, w: 80, h: 20 },
        { t: 'İndir', x: 90, y: 0, w: 50, h: 20 },
      ],
    })
    const hit = matchText([line], 'İndir', { minScore: 60 })
    expect(hit?.x).toBe(90)
    expect(matchFuzzy([item({ id: 2, text: 'Kaydetme' })], 'Kaydet', { minScore: 80 })).toBeNull()
    expect(matchFuzzy([item({ id: 3, text: 'Opera' })], 'Operaya', { minScore: 50 })?.item.id).toBe(3)
  })

  it('Yüklendi yükleniyor sayılmaz; Yükleniyor sayılır', () => {
    expect(judgeScreen([], ['Yüklendi'], 'Yüklendi').kind).toBe('ready')
    expect(judgeScreen([], ['Yüklenenler'], 'Yüklenenler').kind).toBe('ready')
    expect(judgeScreen([], ['Yükleniyor'], 'Yüklendi').kind).toBe('loading')
  })

  it('paket çıkışı döngünün içinde de dışarıdaki adımı açar', async () => {
    const s = createNode('start', 0, 0)
    const pkg = createNode('package', 80, 0)
    const out = createNode('click', 200, 0)
    const ps = createNode('start', 0, 0)
    const loop = createNode('loop', 40, 0)
    const c = createNode('condition', 80, 40)
    out.prompt = 'OUT'
    c.text = 'Ready'
    c.timeoutMs = 0
    loop.items = ['a', 'b']
    loop.members = [c.id]
    pkg.inner = { nodes: [ps, loop, c], edges: [{ id: 'e1', from: ps.id, fromPort: 'next', to: loop.id }] }
    pkg.packageExit = { from: c.id, fromPort: 'true' }
    const graph: AgentGraph = {
      nodes: [s, pkg, out],
      edges: [
        { id: 'e2', from: s.id, fromPort: 'next', to: pkg.id },
        { id: 'e3', from: pkg.id, fromPort: 'next', to: out.id },
      ],
    }
    const actions: string[] = []
    const ex = { log: () => {}, step: () => {}, shouldStop: () => false, click: async (n: { prompt?: string }) => { actions.push(n.prompt ?? '') }, type: async () => {}, key: async () => {}, exists: async () => true }
    const ok = await runGraph(graph, ex, { maxSteps: 100, stepDelayMs: 0 })
    expect(actions).toEqual(['OUT'])
    expect(ok.incomplete).toBeUndefined()
    actions.length = 0
    ex.exists = async () => false
    const miss = await runGraph(graph, ex, { maxSteps: 100, stepDelayMs: 0 })
    expect(actions).toEqual([])
    expect(miss.incomplete).toBe(true)
  })

  it('plan yaması döngü üyeliğini kutunun dışına taşımaz', () => {
    const loop = createNode('loop', 0, 0)
    const a = createNode('click', 40, 40)
    const b = createNode('click', 120, 40)
    loop.members = [a.id]
    const graph: AgentGraph = {
      nodes: [loop, a, b],
      edges: [{ id: 'out', from: a.id, fromPort: 'next', to: b.id }],
    }
    const next = applyPlan(graph, {
      adds: [],
      patches: [{ id: a.id, fields: { prompt: 'yeni' } }],
      edges: [],
      cuts: [],
    })
    expect(next.nodes.find((n) => n.id === loop.id)?.members).toEqual([a.id])
  })

  it('hızlı bakış kapatılmış UIA aşamasını geri açmaz', () => {
    const fast = withFastFind({ findOrder: ['uia', 'onnx', 'tars'], findOff: ['uia'] } as unknown as AppSettings)
    expect(fast.findOrder).toEqual(['onnx'])
    expect(fast.findOff).toEqual(['uia'])
  })

  it('Başlangıç eklerken döngü üyesini değil kutuyu seçer', () => {
    const click = createNode('click', 400, 80)
    const loop = createNode('loop', 200, 40)
    loop.members = [click.id]
    const graph = normalizeGraph({ nodes: [click, loop], edges: [] })
    const start = graph.nodes.find((n) => n.kind === 'start')
    const edge = graph.edges.find((e) => e.from === start?.id)
    expect(edge?.to).toBe(loop.id)
  })
})
