import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode, type AppSettings, type CanvasBook } from '../electron/graph-types'
import { callTool, type ToolContext } from '../electron/tools'

let seq = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `s${++seq}`, from: from.id, fromPort, to: to.id })

/** Kök → Paket (içinde: Başlangıç → Tıkla). Paketin içi ayrı bir graftır. */
function fixture() {
  const root = createNode('start', 0, 0)
  const pkg = createNode('package', 200, 0)
  pkg.title = 'Paket'
  const innerStart = createNode('start', 0, 0)
  const click = createNode('click', 100, 0)
  click.prompt = 'Kaydet'
  pkg.inner = { nodes: [innerStart, click], edges: [edge(innerStart, 'next', click)] }
  const graph: AgentGraph = { nodes: [root, pkg], edges: [edge(root, 'next', pkg)] }
  return { graph, pkg, click }
}

function ctx(graph: AgentGraph): ToolContext {
  let book: CanvasBook = { activeId: 'c1', tabs: [{ id: 'c1', name: 'Tuval', graph }] }
  const base: ToolContext = {
    getGraph: () => graph,
    getSettings: () => ({ agentPermission: 'auto' }) as AppSettings,
    log: () => {},
    isRunning: () => false,
    userStop: () => false,
    sendStep: () => {},
    permission: () => 'auto',
    askApproval: async () => true,
    requestStop: () => {},
    startRun: async () => ({ ok: true }),
    getCanvases: () => structuredClone(book),
    saveCanvases: (next) => {
      book = structuredClone(next)
    },
    applyMerge: async () => ({ ok: true }),
  }
  return base
}

describe('flow.suggest paket farkındalığı', () => {
  it('paketin içindeki node, packagePath verilince denetlenir (bulunamadı denmez)', async () => {
    const f = fixture()
    const r = await callTool('flow.suggest', { packagePath: [f.pkg.id], ops: [{ op: 'patchNode', id: f.click.id, fields: { prompt: 'Kaydet ve kapat' } }] }, ctx(f.graph))
    expect(r.data?.valid, `paket yolu verilince plan geçersiz sayıldı: ${r.message}`).toBe(true)
  })

  it('packagePath verilmezse kökte aranır ve dürüstçe bulunamadı der', async () => {
    const f = fixture()
    const r = await callTool('flow.suggest', { ops: [{ op: 'patchNode', id: f.click.id, fields: { prompt: 'x' } }] }, ctx(f.graph))
    expect(r.outcome).toBe('plan-gecersiz')
    expect(String(r.message)).toContain('bulunamadı')
  })

  it('bilgi metni paketlerin düzenlenebildiğini söyler (eskimiş cümle kalmadı)', async () => {
    const f = fixture()
    const r = await callTool('flow.suggest', {}, ctx(f.graph))
    expect(String(r.message)).toContain('packagePath ile düzenlenebilir')
    expect(String(r.message)).not.toContain('bu sürümde düzenlenemez')
  })
})
