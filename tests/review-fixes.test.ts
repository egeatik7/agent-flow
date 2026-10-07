import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode, type AppSettings, type CanvasBook } from '../electron/graph-types'
import { callTool, type ToolContext } from '../electron/tools'
import { beginRun, endRun, setStopAt, noteUserStop, stopReason } from '../electron/tool-state'

let seq = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `rv${++seq}`, from: from.id, fromPort, to: to.id })

/** Başlangıç → kutu(üyeler: a, b) → Bitir; kutu içinde a → b bağlı. */
function loopFixture() {
  const root = createNode('start', 0, 0)
  const loop = createNode('loop', 200, 0)
  loop.title = 'Kutu'
  loop.items = ['bir', 'iki']
  const a = createNode('wait', 400, 0)
  a.title = 'A'
  a.ms = 100
  const b = createNode('wait', 600, 0)
  b.title = 'B'
  b.ms = 100
  loop.members = [a.id, b.id]
  const end = createNode('end', 800, 0)
  const graph: AgentGraph = { nodes: [root, loop, a, b, end], edges: [edge(root, 'next', loop), edge(a, 'next', b), edge(loop, 'next', end)] }
  return { graph, loop, a, b }
}

function ctx(graph: AgentGraph, over: Partial<ToolContext> = {}): ToolContext {
  let book: CanvasBook = { activeId: 'c1', tabs: [{ id: 'c1', name: 'Tuval', graph }] }
  const base: ToolContext = {
    getGraph: () => graph,
    getSettings: () => ({ agentPermission: 'auto', screenCheck: 'log' }) as AppSettings,
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
    ...over,
  }
  return base
}

describe('inceleme düzeltmeleri', () => {
  it('#1 döngüye eklenen node kutu ÜYELİĞİNE de yazılır (yoksa kutu onu çalıştırmaz)', async () => {
    const f = loopFixture()
    const h = ctx(f.graph)
    const bid = String((await callTool('branch.create', { name: 'Onarım' }, h)).data?.branchId)
    // A ile B arasına yeni bir düzeltme node'u: A → yeni → B
    const ed = await callTool(
      'flow.edit',
      {
        branchId: bid,
        ops: [
          { op: 'disconnect', from: f.a.id },
          { op: 'addNode', key: 'fix', kind: 'wait', fields: { ms: 50, title: 'Düzeltme' }, connectFrom: f.a.id },
          { op: 'connect', from: 'fix', to: f.b.id },
        ],
      },
      h
    )
    expect(ed.outcome, `düzenleme reddedildi: ${ed.message}`).toBe('tamam')
    const read = await callTool('flow.read', { branchId: bid }, h)
    const d = read.data as { loops?: { id: string; members?: { id: string }[] }[]; nodes?: { id: string; title: string }[] }
    const kutu = (d.loops ?? []).find((l) => l.id === f.loop.id)
    const yeni = (d.nodes ?? []).find((n) => String(n.title).includes('Düzeltme'))
    expect(yeni, 'eklenen node okunamadı').toBeTruthy()
    const uyeler = (kutu?.members ?? []).map((m) => m.id)
    expect(uyeler, `eklenen node kutu üyeliğinde yok (kutu onu çalıştırmaz): ${JSON.stringify(uyeler)}`).toContain(String(yeni?.id))
  })

  it('#4 sınır ulaşılmadan bittiyse sonuç "sınırlı bölge tamamlandı" DEMEZ', async () => {
    const f = loopFixture()
    const kopuk = createNode('wait', 1200, 300)
    kopuk.title = 'Kopuk'
    f.graph.nodes.push(kopuk)
    const h = ctx(f.graph)
    beginRun(f.graph)
    // Sınır istendi ama hiçbir zaman ulaşılmadı (erişilemeyen sınır).
    setStopAt(kopuk.id)
    endRun({ ok: true, steps: 3 })
    const r = await callTool('run.wait', {}, h)
    expect(String(r.message), 'sınır ulaşılmadan bitti ama sonuç bunu söylemiyor').toContain('TAMAMLANMADI')
    setStopAt(null)
  })

  it('#6 merge zaman aşımında "hiçbir şey yazılmadı" denmez', async () => {
    const f = loopFixture()
    const h = ctx(f.graph, {
      applyMerge: async () => ({ ok: false, error: 'pencere 30 sn içinde yanıt vermedi (uygulanmış olabilir)' }),
    })
    const bid = String((await callTool('branch.create', { name: 'M' }, h)).data?.branchId)
    await callTool('flow.edit', { branchId: bid, ops: [{ op: 'addNode', key: 'w', kind: 'wait', fields: { ms: 10 } }] }, h)
    const r = await callTool('branch.merge', { branchId: bid, apply: true }, h, 'panel')
    expect(r.ok).toBe(false)
    expect(String(r.message)).toContain('OLABİLİR')
    expect(String(r.message), 'zaman aşımında "hiçbir şey yazılmadı" deniyor').not.toContain('hiçbir şey yazılmadı')
  })

  it('#9 koşu yokken durdurma önceki durma nedenini değiştirmez', async () => {
    const f = loopFixture()
    const h = ctx(f.graph, { isRunning: () => false })
    beginRun(f.graph)
    expect(stopReason()).toBeNull()
    await callTool('run.stop', {}, h)
    expect(stopReason(), 'koşu yokken durma nedeni yazıldı (önceki sonucun nedeni bozulur)').toBeNull()
    noteUserStop()
    expect(stopReason()).toBe('user')
    endRun({ ok: true })
  })
})
