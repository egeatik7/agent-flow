import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode, type AppSettings, type CanvasBook } from '../electron/graph-types'
import { callTool, type ToolContext } from '../electron/tools'
import { beginRun, endRun, frozenReport, noteStep, setDebugRun, setErrorStopHook } from '../electron/tool-state'

let seq = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `b${++seq}`, from: from.id, fromPort, to: to.id })

function fixture() {
  const root = createNode('start', 0, 0)
  const click = createNode('click', 200, 0)
  click.title = 'Kaydet'
  click.prompt = 'Kaydet'
  const wait = createNode('wait', 400, 0)
  wait.ms = 500
  const end = createNode('end', 600, 0)
  const graph: AgentGraph = { nodes: [root, click, wait, end], edges: [edge(root, 'next', click), edge(click, 'next', wait), edge(wait, 'next', end)] }
  return { graph, root, click, wait, end }
}

function ctx(graph: AgentGraph, over: Partial<ToolContext> = {}) {
  let book: CanvasBook = { activeId: 'canvas-1', tabs: [{ id: 'canvas-1', name: 'Tuval 1', graph }] }
  const saves: CanvasBook[] = []
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
      saves.push(structuredClone(next))
    },
    applyMerge: async () => ({ ok: true }),
    ...over,
  }
  return { ctx: base, saves, book: () => book }
}

describe('bug bataryası: bilinmeyen kimlikler dürüstçe reddedilir, çökmez', () => {
  it('branch.* bilinmeyen kimlikte net reddeder', async () => {
    const h = ctx(fixture().graph)
    for (const [tool, args] of [
      ['branch.drop', { branchId: 'yok' }],
      ['branch.diff', { branchId: 'yok' }],
      ['branch.show', { branchId: 'yok' }],
      ['flow.undo', { branchId: 'yok' }],
      ['flow.edit', { branchId: 'yok', ops: [{ op: 'disconnect', from: 'x' }] }],
      ['branch.merge', { branchId: 'yok' }],
    ] as const) {
      const r = await callTool(tool as string, args as Record<string, unknown>, h.ctx)
      expect(r.ok, `${tool} bilinmeyen kimlikte ok:true döndü`).toBe(false)
      expect(String(r.message).length, `${tool} mesajı boş`).toBeGreaterThan(5)
    }
  })

  it('run.from bilinmeyen node/sınır ve eksik onaylarda başlatmaz', async () => {
    const h = ctx(fixture().graph)
    const cases: [string, Record<string, unknown>][] = [
      ['bilinmeyen node', { nodeId: 'yok' }],
      ['baştan onaysız', {}],
      ['bilinmeyen sınır', { nodeId: 'n1', untilNodeId: 'yok' }],
      ['sınır başlangıçla aynı', { nodeId: 'n1', untilNodeId: 'n1' }],
      ['sınırsız başlangıç', { untilNodeId: 'n2' }],
      ['boş branchId', { branchId: '', fromStart: true }],
    ]
    for (const [ad, args] of cases) {
      const r = await callTool('run.from', args, h.ctx)
      expect(r.ok, `${ad}: koşu başlatıldı!`).toBe(false)
    }
  })

  it('run.report bilinmeyen koşu kimliğinde uydurmaz', async () => {
    const h = ctx(fixture().graph)
    const r = await callTool('run.report', { runId: 'yok-boyle-kosu' }, h.ctx)
    expect(r.ok).toBe(true)
    expect(r.data?.frozen).toBeNull()
    expect(String(r.message)).toContain('bulunamadı')
  })
})

describe('bug bataryası: argümanlar', () => {
  it('boş/eksik argümanlar net reddedilir', async () => {
    const h = ctx(fixture().graph)
    for (const [tool, args, parca] of [
      ['act.click', {}, 'target'],
      ['act.type', { text: '   ' }, 'text'],
      ['act.key', { keys: '  ' }, 'keys'],
    ] as const) {
      const r = await callTool(tool as string, args as Record<string, unknown>, h.ctx)
      expect(r.ok, `${tool}: boş argümanla geçti`).toBe(false)
      expect(String(r.message).toLowerCase(), `${tool}: mesaj beklenen alanı anmıyor`).toContain(String(parca).toLowerCase())
    }
    // Geçerli bir branch'te işlemsiz düzenleme: reddedilmeli (boş plan sessizce "oldu" dememeli).
    const id = String((await callTool('branch.create', { name: 'B' }, h.ctx)).data?.branchId)
    const bosPlan = await callTool('flow.edit', { branchId: id }, h.ctx)
    expect(bosPlan.ok, 'işlemsiz düzenleme kabul edildi').toBe(false)
  })

  // BİLİNEN HATA (ölçüldü, düzeltilmedi): flow.suggest bir planı DENETLEMESİ gerekirken
  // patchNode içindeki `locator` alanını kabul ediyor; oysa flow.edit aynı alanı
  // EDITABLE_FIELDS denetimiyle reddediyor (tool-edit.ts:129). Düzelene kadar bu test kırmızıdır.
  it.fails('flow.suggest yasak alanı reddetmeli (BİLİNEN HATA)', async () => {
    const { graph, click } = fixture()
    const h = ctx(graph)
    const r = await callTool('flow.suggest', { ops: [{ op: 'patchNode', id: click.id, fields: { locator: { x: 1, y: 2 } } }] }, h.ctx)
    expect(r.ok, 'flow.suggest hedef kanıtı alanını kabul etti').toBe(false)
  })
})

describe('bug bataryası: sınırlar ve dolu çıkışlar', () => {
  // BİLİNEN HATA (ölçüldü, düzeltilmedi): dolu çıkış denetimi (tool-edit.ts:240-248) branch
  // bağlamında yalnız branch'in kendi eklemelerini görüyor; temel akışta o çıkış zaten dolu olsa
  // bile `addNode.connectFrom` kabul ediliyor. Motor bir çıkışta ilk oku izlediği için bu, "eklenen
  // node hiç çalışmaz" demektir. Düzelene kadar kırmızı.
  it.fails('dolu çıkışa ikinci bağlantı reddedilmeli (BİLİNEN HATA)', async () => {
    const { graph, root } = fixture()
    const h = ctx(graph)
    const id = String((await callTool('branch.create', { name: 'B' }, h.ctx)).data?.branchId)
    const dolu = await callTool('flow.edit', { branchId: id, ops: [{ op: 'addNode', key: 'w', kind: 'wait', fields: { ms: 100 }, connectFrom: root.id }] }, h.ctx)
    expect(dolu.ok, 'dolu çıkışa ikinci bağlantı kabul edildi').toBe(false)
  })

  it('tek planda kopar-bağla çalışır', async () => {
    const { graph, root, wait } = fixture()
    const h = ctx(graph)
    const id = String((await callTool('branch.create', { name: 'B' }, h.ctx)).data?.branchId)
    const tekPlan = await callTool(
      'flow.edit',
      {
        branchId: id,
        ops: [
          { op: 'disconnect', from: root.id },
          { op: 'addNode', key: 'w', kind: 'wait', fields: { ms: 100 }, connectFrom: root.id },
          { op: 'connect', from: 'w', to: wait.id },
        ],
      },
      h.ctx
    )
    expect(tekPlan.ok, `tek planda kopar-bağla reddedildi: ${tekPlan.message}`).toBe(true)
  })

  it('branch ve grup sınırları taşmaz, mevcut tarif bozulmaz', async () => {
    const f = fixture()
    const h = ctx(f.graph)
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const r = await callTool('branch.create', { name: `B${i}` }, h.ctx)
      expect(r.ok).toBe(true)
      ids.push(String(r.data?.branchId))
    }
    const dorduncu = await callTool('branch.create', { name: 'B3' }, h.ctx)
    expect(dorduncu.ok, 'dördüncü branch açıldı (sınır yok)').toBe(false)
    // 40 düzenleme sınırı: sonrası reddedilmeli ve mevcut gruplar silinmemeli.
    const hedef = ids[0]
    let kabul = 0
    for (let i = 0; i < 45; i++) {
      const r = await callTool('flow.edit', { branchId: hedef, ops: [{ op: 'patchNode', id: f.wait.id, fields: { ms: 100 + i } }] }, h.ctx)
      if (r.ok) kabul++
      else {
        expect(String(r.message)).toContain('dolu')
        break
      }
    }
    expect(kabul, 'hiç düzenleme kabul edilmedi (yanlış node kimliği?)').toBeGreaterThan(0)
    const liste = await callTool('branch.list', {}, h.ctx)
    const b0 = (liste.data?.branches as { branchId: string; groups: number }[]).find((b) => b.branchId === hedef)
    expect(b0?.groups, 'sınır aşılınca ilk gruplar silinmiş').toBe(kabul)
  })
})

describe('bug bataryası: eşzamanlılık ve haklar', () => {
  it('koşu sürerken hiçbir masaüstü aracı başlamaz', async () => {
    const h = ctx(fixture().graph, { isRunning: () => true })
    for (const [tool, args] of [
      ['act.click', { target: 'Kaydet' }],
      ['act.type', { text: 'x' }],
      ['act.key', { keys: 'enter' }],
      ['run.from', { fromStart: true }],
    ] as const) {
      const r = await callTool(tool as string, args as Record<string, unknown>, h.ctx)
      expect(r.ok, `${tool}: koşu sürerken başladı`).toBe(false)
      expect(String(r.message)).toContain('sürüyor')
    }
    // act.wait masaüstüne dokunmaz ama yine de koşuya karışmamalı.
    const beklet = await callTool('act.wait', { ms: 10 }, h.ctx)
    expect(beklet.ok, 'koşu sürerken act.wait çalıştı').toBe(false)
  })

  it('merge uygulaması yalnız panelden; deneme her zaman serbest', async () => {
    const h = ctx(fixture().graph)
    const id = String((await callTool('branch.create', { name: 'B' }, h.ctx)).data?.branchId)
    await callTool('flow.edit', { branchId: id, ops: [{ op: 'disconnect', from: fixture().root.id }] }, h.ctx)
    const deneme = await callTool('branch.merge', { branchId: id }, h.ctx, 'agent')
    expect(deneme.ok).toBe(true)
    const uygula = await callTool('branch.merge', { branchId: id, apply: true }, h.ctx, 'agent')
    expect(uygula.ok, 'ajan merge uygulayabildi (yalnız panel olmalı)').toBe(false)
    expect(String(uygula.message)).toContain('Nubbo penceresini')
  })

  it('geri alma hakkı bir kez: ikinci merge.undo reddeder', async () => {
    const h = ctx(fixture().graph)
    const id = String((await callTool('branch.create', { name: 'B' }, h.ctx)).data?.branchId)
    await callTool('flow.edit', { branchId: id, ops: [{ op: 'disconnect', from: fixture().root.id }] }, h.ctx)
    const ilk = await callTool('merge.undo', {}, h.ctx)
    expect(ilk.ok).toBe(false) // hiç merge yapılmadı: uydurmamalı
  })
})

describe('bug bataryası: değişmezler', () => {
  it('araç katmanı yalnız branches yazar; tuvaller bayt bayt aynı kalır', async () => {
    const { graph } = fixture()
    const h = ctx(graph)
    const oncekiTuvaller = JSON.stringify(h.book().tabs)
    const id = String((await callTool('branch.create', { name: 'B' }, h.ctx)).data?.branchId)
    await callTool('flow.edit', { branchId: id, ops: [{ op: 'patchNode', id: fixture().click.id, fields: { title: 'Yeni' } }] }, h.ctx)
    await callTool('flow.undo', { branchId: id }, h.ctx)
    await callTool('branch.show', { branchId: id }, h.ctx)
    await callTool('branch.drop', { branchId: id }, h.ctx)
    expect(h.saves.length).toBeGreaterThan(0)
    expect(JSON.stringify(h.book().tabs), 'araç katmanı tuvallere yazdı!').toBe(oncekiTuvaller)
    expect(JSON.stringify(h.book().branches)).toBe('[]')
  })

  it('hedef aramayan node türleri için preview "bulamadım" demez', async () => {
    const { graph, wait, end, root } = fixture()
    const loop = createNode('loop', 100, 200)
    loop.title = 'Kutu'
    loop.items = ['a']
    graph.nodes.push(loop)
    const h = ctx(graph)
    for (const [id, ad] of [
      [wait.id, 'bekleme'],
      [end.id, 'bitir'],
      [loop.id, 'kutu'],
      [root.id, 'başlangıç'],
    ] as const) {
      const r = await callTool('target.preview', { nodeId: id }, h.ctx)
      expect(r.ok, `${ad} için preview reddetti`).toBe(true)
      expect(String(r.message), `${ad}: "bulunamadı" dedi`).not.toContain('ekranda bulunamadı')
    }
  })

  it('debug kapanı ve arşiv: üst üste koşular önceki kanıtı silmez', () => {
    const { graph } = fixture()
    let durdur = 0
    setErrorStopHook(() => durdur++)
    beginRun(graph)
    setDebugRun(true)
    noteStep({ id: 'a', status: 'error' })
    const ilk = frozenReport()?.runId as string
    endRun({ ok: false })
    setDebugRun(false)
    setDebugRun(true)
    beginRun(graph)
    expect(frozenReport(ilk), 'ikinci koşu ilk kanıtı sildi').not.toBeNull()
    expect(durdur).toBeGreaterThan(0)
    setErrorStopHook(null)
  })
})
