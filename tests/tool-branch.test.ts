import { describe, expect, it } from 'vitest'
import {
  createNode,
  type AgentEdge,
  type AgentGraph,
  type AgentNode,
  type AppSettings,
  type CanvasBook,
} from '../electron/graph-types'
import { callTool, type ToolContext } from '../electron/tools'
import {
  MAX_BRANCHES,
  branchesOf,
  materialize,
  newBranch,
  toolLayerSave,
  viewBranch,
  windowSave,
  type BranchRecord,
} from '../electron/tool-branch'
import { beginRun, endRun } from '../electron/tool-state'
import type { EditOp } from '../electron/tool-edit'

const edge = (from: AgentNode, fromPort: string, to: AgentNode): AgentEdge => ({
  id: `e-${from.id}-${fromPort}-${to.id}`,
  from: from.id,
  fromPort,
  to: to.id,
})

/** Başlangıç → Kaydet (tıkla) → bekle → Bitir */
function fixture() {
  const start = createNode('start', 0, 0)
  const click = createNode('click', 300, 0)
  click.prompt = 'Kaydet'
  const wait = createNode('wait', 600, 0)
  wait.ms = 2000
  const end = createNode('end', 900, 0)
  const graph: AgentGraph = {
    nodes: [start, click, wait, end],
    edges: [edge(start, 'next', click), edge(click, 'next', wait), edge(wait, 'next', end)],
  }
  const book: CanvasBook = { activeId: 'c1', tabs: [{ id: 'c1', name: 'Tuval 1', graph }] }
  return { graph, book, start, click, wait, end }
}

/** The app's side of the context: a book that survives saves, and a run that records its graph. */
function harness(permission: AppSettings['agentPermission'] = 'auto') {
  const { graph, book, start, click, wait, end } = fixture()
  const runs: { graph: AgentGraph; startId?: string; derived?: boolean }[] = []
  const merges: { tabId: string; graph: AgentGraph; branchId: string; branchName: string; reason?: 'merge' | 'undo' }[] = []
  const dropped: BranchRecord[] = []
  let mergeAnswer: { ok: boolean; error?: string } = { ok: true }
  let undoAvailable: { tabId: string; graph: AgentGraph } | null = null
  const ctx: ToolContext = {
    getGraph: () => book.tabs[0].graph,
    getSettings: () => ({ agentPermission: permission }) as AppSettings,
    log: () => {},
    isRunning: () => false,
    userStop: () => false,
    sendStep: () => {},
    permission: () => permission,
    askApproval: async () => true,
    requestStop: () => {},
    startRun: async (g, startId, _packagePath, opts) => {
      runs.push({ graph: g, startId, derived: opts?.derived })
      // The real app registers the run with the tool layer before it starts, so the id is known.
      beginRun(g, startId)
      return { ok: true }
    },
    getCanvases: () => structuredClone(book),
    saveCanvases: (next) => {
      // A recipe that disappears here is a merge eating it: the app keeps it for the undo.
      for (const before of branchesOf(book)) {
        if (!branchesOf(next).some((b) => b.id === before.id)) dropped.push(before)
      }
      book.tabs = next.tabs
      book.activeId = next.activeId
      book.branches = next.branches
    },
    applyMerge: async (payload, opts) => {
      merges.push(payload)
      // The app keeps the flow as it was before a merge, so a wrong merge can be taken back.
      if (opts?.snapshot !== false && payload.reason !== 'undo') {
        const tab = book.tabs.find((t) => t.id === payload.tabId)
        undoAvailable = tab ? { tabId: payload.tabId, graph: structuredClone(tab.graph) } : null
      }
      return mergeAnswer
    },
    takeMergeUndo: () => {
      const snap = undoAvailable
      undoAvailable = null
      if (!snap) return null
      const back = dropped.pop()
      if (back) book.branches = [...branchesOf(book), back]
      return snap
    },
  }
  const openBranch = async (name = 'RunAgentFix 1') => {
    const created = await callTool('branch.create', { name }, ctx)
    return String(created.data?.branchId ?? '')
  }
  const branchOf = (id: string): BranchRecord => {
    const found = branchesOf(book).find((b) => b.id === id)
    if (!found) throw new Error(`branch yok: ${id}`)
    return found
  }
  return {
    graph,
    book,
    ctx,
    runs,
    merges,
    undoPending: () => undoAvailable !== null,
    setMergeAnswer: (answer: { ok: boolean; error?: string }) => {
      mergeAnswer = answer
    },
    openBranch,
    branchOf,
    start,
    click,
    wait,
    end,
  }
}

const patchWait = (id: string, ms: number): EditOp => ({ op: 'patchNode', id, fields: { ms } })

describe('branch: kopya değil, tarif', () => {
  it('branch açar, akışın kopyasını tutmaz ve akışa dokunmaz', async () => {
    const h = harness()
    const before = JSON.stringify(h.book.tabs[0].graph)
    const id = await h.openBranch('RunAgentFix 1')

    expect(id).toMatch(/^b/)
    expect(branchesOf(h.book)).toHaveLength(1)
    expect(h.branchOf(id).name).toBe('RunAgentFix 1')
    expect(h.branchOf(id).baseTabId).toBe('c1')
    expect(h.branchOf(id).groups).toEqual([])
    // Kopya olsaydı kayıt, akışın kendisi kadar büyürdü.
    const record = JSON.stringify(h.branchOf(id))
    const flow = JSON.stringify(h.book.tabs[0].graph)
    expect(record.length).toBeLessThan(flow.length / 2)
    expect(JSON.stringify(h.book.tabs[0].graph)).toBe(before)
  })

  it('düzenleme ekler, akışa yazmaz ve farkı bildirir', async () => {
    const h = harness()
    const id = await h.openBranch()
    const before = JSON.stringify(h.book.tabs[0].graph)

    const edited = await callTool('flow.edit', { branchId: id, ops: [patchWait(h.wait.id, 4000)], note: 'remesh beklemesi' }, h.ctx)
    expect(edited.ok).toBe(true)
    expect(edited.outcome).toBe('tamam')
    expect(edited.message).toContain('1 node değişti')
    expect(h.branchOf(id).groups).toHaveLength(1)
    // Asıl güvence: kullanıcının akışı bit bit aynı.
    expect(JSON.stringify(h.book.tabs[0].graph)).toBe(before)
    expect((h.book.tabs[0].graph.nodes.find((n) => n.id === h.wait.id) as AgentNode).ms).toBe(2000)

    const diff = await callTool('branch.diff', { branchId: id }, h.ctx)
    expect(diff.ok).toBe(true)
    expect((diff.data?.diff as { changedNodes: unknown[] }).changedNodes).toHaveLength(1)
    expect((diff.data?.lines as string[]).some((l) => l.includes('4000'))).toBe(true)
    expect(diff.data?.baseChanged).toBe(false)
  })

  it('geçersiz düzenlemeyi reddeder ve hiçbir şey eklemez', async () => {
    const h = harness()
    const id = await h.openBranch()
    const bad = await callTool('flow.edit', { branchId: id, ops: [{ op: 'patchNode', id: h.wait.id, fields: { locator: {} } }] }, h.ctx)
    expect(bad.outcome).toBe('plan-gecersiz')
    expect(bad.message).toContain('locator')
    expect(h.branchOf(id).groups).toHaveLength(0)
  })

  it('son düzenlemeyi geri alır, sonra geri alacak bir şey kalmaz', async () => {
    const h = harness()
    const id = await h.openBranch()
    await callTool('flow.edit', { branchId: id, ops: [patchWait(h.wait.id, 4000)] }, h.ctx)
    await callTool('flow.edit', { branchId: id, ops: [{ op: 'addNode', key: 'k', kind: 'key', fields: { keys: '{ESC}' }, connectFrom: h.click.id }] }, h.ctx)
    expect(h.branchOf(id).groups).toHaveLength(2)
    const before = JSON.stringify(h.book.tabs[0].graph)

    const undone = await callTool('flow.undo', { branchId: id }, h.ctx)
    expect(undone.ok).toBe(true)
    expect(h.branchOf(id).groups).toHaveLength(1)
    expect(((undone.data?.diff as { changedNodes: { fields: string[] }[] }).changedNodes[0].fields)).toEqual(['ms'])
    expect(JSON.stringify(h.book.tabs[0].graph)).toBe(before)

    const again = await callTool('flow.undo', { branchId: id }, h.ctx)
    expect(again.ok).toBe(true)
    expect(h.branchOf(id).groups).toHaveLength(0)
    const empty = await callTool('flow.undo', { branchId: id }, h.ctx)
    expect(empty.ok).toBe(false)
    expect(empty.message).toContain('geri alınacak')
  })

  it('branch koşusu türetilmiş grafikle ve derived işaretiyle başlar', async () => {
    const h = harness()
    const id = await h.openBranch()
    await callTool('flow.edit', { branchId: id, ops: [patchWait(h.wait.id, 7000)], note: 'uzun bekleme' }, h.ctx)

    const started = await callTool('run.from', { branchId: id }, h.ctx)
    expect(started.ok).toBe(true)
    expect(started.message).toContain('branch koşusu')
    expect(h.runs).toHaveLength(1)
    expect(h.runs[0].derived).toBe(true)
    const ran = h.runs[0].graph.nodes.find((n) => n.id === h.wait.id) as AgentNode
    expect(ran.ms).toBe(7000)
    // Koşan grafik türetilmiş olsa da kullanıcının akışı değişmedi.
    expect((h.book.tabs[0].graph.nodes.find((n) => n.id === h.wait.id) as AgentNode).ms).toBe(2000)
    expect(started.data?.runId).toBeTruthy()
    endRun({ ok: true })
  })

  it('temel tuval değişirse söyler; uymayan grubu atlar, kalanı uygular', async () => {
    const h = harness()
    const id = await h.openBranch()
    await callTool('flow.edit', { branchId: id, ops: [patchWait(h.wait.id, 4000)] }, h.ctx)
    await callTool('flow.edit', { branchId: id, ops: [patchWait(h.click.id, 1)], note: 'tıkla üstünde' }, h.ctx)

    // Kullanıcı akışından bekle node'unu sildi: o grup artık uymuyor.
    h.book.tabs[0].graph.nodes = h.book.tabs[0].graph.nodes.filter((n) => n.id !== h.wait.id)
    h.book.tabs[0].graph.edges = h.book.tabs[0].graph.edges.filter((e) => e.from !== h.wait.id && e.to !== h.wait.id)

    const diff = await callTool('branch.diff', { branchId: id }, h.ctx)
    expect(diff.data?.baseChanged).toBe(true)
    expect((diff.data?.failed as string[]).length).toBe(1)
    expect((diff.data?.failed as string[])[0]).toContain('bulunamadı')
    expect(diff.message).toContain('temel tuval değişmiş')
    const derived = materialize(h.book.tabs[0].graph, h.branchOf(id))
    expect(derived.failed).toHaveLength(1)
    expect(derived.graph.nodes.find((n) => n.id === h.click.id)).toBeTruthy()
  })

  it('aynı anda en fazla üç branch açar', async () => {
    const h = harness()
    for (let i = 1; i <= MAX_BRANCHES; i++) await h.openBranch(`Öneri ${i}`)
    const fourth = await callTool('branch.create', { name: 'Öneri 4' }, h.ctx)
    expect(fourth.ok).toBe(false)
    expect(fourth.message).toContain(String(MAX_BRANCHES))
    expect(branchesOf(h.book)).toHaveLength(MAX_BRANCHES)
  })

  it('listeler, siler ve bilinmeyen branch’i söyler', async () => {
    const h = harness()
    const id = await h.openBranch('Bakım önerisi')
    await callTool('flow.edit', { branchId: id, ops: [patchWait(h.wait.id, 4000)] }, h.ctx)

    const list = await callTool('branch.list', {}, h.ctx)
    expect(list.message).toContain('Bakım önerisi')
    expect((list.data?.branches as { ops: number }[])[0].ops).toBe(1)

    const missing = await callTool('flow.edit', { branchId: 'yok', ops: [patchWait(h.wait.id, 1)] }, h.ctx)
    expect(missing.ok).toBe(false)
    expect(missing.message).toContain('Branch bulunamadı')
    const noId = await callTool('branch.diff', {}, h.ctx)
    expect(noId.ok).toBe(false)
    expect(noId.message).toContain('branchId')

    const dropped = await callTool('branch.drop', { branchId: id }, h.ctx)
    expect(dropped.ok).toBe(true)
    expect(branchesOf(h.book)).toHaveLength(0)
  })

  it('izin kapalıyken ajan yazamaz, panel yazabilir, okuma sürer', async () => {
    const h = harness('off')
    const created = await callTool('branch.create', { name: 'x' }, h.ctx, 'agent')
    expect(created.ok).toBe(false)
    expect(created.message).toContain('izni kapalı')

    // Panelde düğmeye basmak onayın kendisidir: izin kapalı olsa da kendi araçlarını kullanır.
    const fromPanel = await callTool('branch.create', { name: 'panel önerisi' }, h.ctx, 'panel')
    expect(fromPanel.ok).toBe(true)
    const panelId = String(fromPanel.data?.branchId ?? '')
    expect(branchesOf(h.book)).toHaveLength(1)
    const edited = await callTool('flow.edit', { branchId: panelId, ops: [patchWait(h.wait.id, 3000)] }, h.ctx, 'panel')
    expect(edited.ok).toBe(true)
    const dropped = await callTool('branch.drop', { branchId: panelId }, h.ctx, 'panel')
    expect(dropped.ok).toBe(true)

    const reading = await callTool('flow.suggest', {}, h.ctx)
    expect(reading.ok).toBe(true)
    const listing = await callTool('branch.list', {}, h.ctx)
    expect(listing.ok).toBe(true)
    expect(branchesOf(h.book)).toHaveLength(0)
  })

  it('türetilen node kimlikleri sabittir: fark, tek adım ve akış aynı kimliği görür', async () => {
    const h = harness()
    const id = await h.openBranch()
    const edit = await callTool(
      'flow.edit',
      { branchId: id, ops: [{ op: 'addNode', key: 'w', kind: 'wait', fields: { ms: 900, title: 'deneme bekleme' } }] },
      h.ctx
    )
    const first = await callTool('branch.diff', { branchId: id }, h.ctx)
    const second = await callTool('branch.diff', { branchId: id }, h.ctx)
    const added = (r: { data?: Record<string, unknown> }) => ((r.data?.diff as { addedNodes: { id: string }[] }).addedNodes[0]?.id ?? '')
    const fromEdit = added(edit as { data?: Record<string, unknown> })
    const fromFirst = added(first as { data?: Record<string, unknown> })
    const fromSecond = added(second as { data?: Record<string, unknown> })

    expect(fromEdit).toMatch(/^nb/)
    expect(fromFirst).toBe(fromEdit)
    // İkinci kez bakmak yeni kimlik üretmez; yoksa okuyan bir çağıran node'u adlandıramaz.
    expect(fromSecond).toBe(fromFirst)
    // Ve o kimlik türetilmiş grafikte gerçekten duruyor.
    const view = viewBranch(h.book, h.branchOf(id))
    expect(view.derived?.nodes.some((n) => n.id === fromFirst)).toBe(true)
    // Aynı tarif ikinci kez uygulansa da aynı kimlikler: malzeme tekrarı id uydurmaz.
    const again = materialize(h.book.tabs[0].graph, h.branchOf(id))
    expect(again.graph.nodes.some((n) => n.id === fromFirst)).toBe(true)
  })

  it('iki yazar tek defteri paylaşır: her biri yalnız kendi yarısını yazar', () => {
    const { book } = fixture()
    const flowBook: CanvasBook = { activeId: 'c1', tabs: [{ id: 'c1', name: 'Tuval 1', graph: fixture().graph }] }
    const branch = newBranch(flowBook.tabs[0], 'öneri')
    const toolWritten = toolLayerSave(flowBook, [branch])

    // Pencere kendi kopyasını kaydediyor (branch'i hiç duymamış): branch yine de durur.
    const staleWindowSave: CanvasBook = { activeId: 'c1', tabs: flowBook.tabs, branches: [] }
    const afterWindowSave = windowSave(staleWindowSave, toolWritten)
    expect(afterWindowSave.branches).toHaveLength(1)
    expect((afterWindowSave.branches?.[0] as { id: string }).id).toBe(branch.id)
    expect(afterWindowSave.tabs).toHaveLength(1)
    expect(book).toBeTruthy()

    // Araç katmanı kaydediyor: pencerenin tuvali olduğu gibi kalır.
    const windowBook: CanvasBook = { activeId: 'c2', tabs: [{ id: 'c2', name: 'Başka', graph: fixture().graph }] }
    const afterToolSave = toolLayerSave(windowBook, [])
    expect(afterToolSave.tabs).toEqual(windowBook.tabs)
    expect(afterToolSave.activeId).toBe('c2')
    expect(afterToolSave.branches).toEqual([])

    // Ve pencere kendi kaydında branşları araç katmanından alır: silinen branch geri gelmez.
    const afterDrop = windowSave(staleWindowSave, toolLayerSave(windowBook, []))
    expect(afterDrop.branches).toEqual([])
  })

  it('merge geri alınabilir: bir kez, tuval merge öncesi hâline döner ve tarif geri açılır', async () => {
    const h = harness()
    const id = await h.openBranch('Geri alma denemesi')
    await callTool('flow.edit', { branchId: id, ops: [patchWait(h.wait.id, 5000)] }, h.ctx)
    const merged = await callTool('branch.merge', { branchId: id, apply: true }, h.ctx, 'panel')
    expect(merged.data?.applied).toBe(true)
    expect(branchesOf(h.book)).toHaveLength(0)
    expect(h.undoPending()).toBe(true)

    const undone = await callTool('merge.undo', {}, h.ctx, 'panel')
    expect(undone.ok).toBe(true)
    expect(undone.message).toContain('merge öncesi hâline döndü')
    // Pencereye giden grafik merge öncesi hâl: 2000 ms.
    const last = h.merges[h.merges.length - 1]
    expect((last.graph.nodes.find((n) => n.id === h.wait.id) as AgentNode).ms).toBe(2000)
    // Tarif geri açıldı ve bir kez geri alındı: ikinci kez yok.
    expect(branchesOf(h.book)).toHaveLength(1)
    const again = await callTool('merge.undo', {}, h.ctx, 'panel')
    expect(again.ok).toBe(false)
    expect(again.message).toContain('Geri alınacak merge yok')
  })

  it('merge geri almayı ajan çağıramaz', async () => {
    const h = harness()
    const id = await h.openBranch()
    await callTool('flow.edit', { branchId: id, ops: [patchWait(h.wait.id, 5000)] }, h.ctx)
    await callTool('branch.merge', { branchId: id, apply: true }, h.ctx, 'panel')
    const byAgent = await callTool('merge.undo', {}, h.ctx, 'agent')
    expect(byAgent.ok).toBe(false)
    expect(byAgent.message).toContain('yalnız Nubbo penceresinden')
    expect(branchesOf(h.book)).toHaveLength(0)
  })

  it('merge iki adımlıdır: önce deneme, sonra pencereye devredilen uygulama', async () => {
    const h = harness()
    const id = await h.openBranch('Remesh düzeltmesi')
    await callTool('flow.edit', { branchId: id, ops: [patchWait(h.wait.id, 4500)] }, h.ctx)
    const before = JSON.stringify(h.book.tabs[0].graph)

    const dry = await callTool('branch.merge', { branchId: id }, h.ctx, 'panel')
    expect(dry.ok).toBe(true)
    expect(dry.data?.applied).toBe(false)
    expect(dry.message).toContain('uygulanmadı')
    expect(h.merges).toHaveLength(0)
    expect(JSON.stringify(h.book.tabs[0].graph)).toBe(before)

    const applied = await callTool('branch.merge', { branchId: id, apply: true }, h.ctx, 'panel')
    expect(applied.ok).toBe(true)
    expect(applied.data?.applied).toBe(true)
    expect(h.merges).toHaveLength(1)
    // Pencereye giden grafik, tarif uygulanmış hali: bekleme 4500 olmuş.
    const sent = h.merges[0].graph.nodes.find((n) => n.id === h.wait.id) as AgentNode
    expect(sent.ms).toBe(4500)
    expect(h.merges[0].tabId).toBe('c1')
    // Tarif silindi: aynı düzenlemeler ikinci kez uygulanmasın.
    expect(branchesOf(h.book)).toHaveLength(0)
    expect(applied.message).toContain('Tarif silindi')
  })

  it('merge’ü ajan çağıramaz; pencere uygulamazsa tarif yerinde kalır', async () => {
    const h = harness()
    const id = await h.openBranch()
    await callTool('flow.edit', { branchId: id, ops: [patchWait(h.wait.id, 4500)] }, h.ctx)

    const byAgent = await callTool('branch.merge', { branchId: id, apply: true }, h.ctx, 'agent')
    expect(byAgent.ok).toBe(false)
    expect(byAgent.message).toContain('uygulamak için Nubbo penceresini')
    expect(h.merges).toHaveLength(0)
    expect(branchesOf(h.book)).toHaveLength(1)

    // Deneme yazmadığı için dışarıdan da sorulabilir.
    const dryByAgent = await callTool('branch.merge', { branchId: id }, h.ctx, 'agent')
    expect(dryByAgent.ok).toBe(true)
    expect(dryByAgent.data?.applied).toBe(false)

    h.setMergeAnswer({ ok: false, error: 'pencere 10 sn içinde yanıt vermedi' })
    const failedApply = await callTool('branch.merge', { branchId: id, apply: true }, h.ctx, 'panel')
    expect(failedApply.ok).toBe(false)
    expect(failedApply.message).toContain('yanıt vermedi')
    expect(branchesOf(h.book)).toHaveLength(1)
    expect((h.book.tabs[0].graph.nodes.find((n) => n.id === h.wait.id) as AgentNode).ms).toBe(2000)
  })

  it('temel değişmişse merge uyarır ve uymayan grubu atlar', async () => {
    const h = harness()
    const id = await h.openBranch()
    await callTool('flow.edit', { branchId: id, ops: [patchWait(h.wait.id, 4500)] }, h.ctx)
    await callTool('flow.edit', { branchId: id, ops: [patchWait(h.click.id, 10)], note: 'tıkla üstünde' }, h.ctx)
    h.book.tabs[0].graph.nodes = h.book.tabs[0].graph.nodes.filter((n) => n.id !== h.wait.id)

    const dry = await callTool('branch.merge', { branchId: id }, h.ctx, 'panel')
    expect(dry.data?.baseChanged).toBe(true)
    expect(dry.message).toContain('temel tuval')
    expect(dry.message).toContain('uymuyor')
    expect((dry.data?.failed as string[]).length).toBe(1)

    const applied = await callTool('branch.merge', { branchId: id, apply: true }, h.ctx, 'panel')
    expect(applied.ok).toBe(true)
    const sent = h.merges[0].graph.nodes.find((n) => n.id === h.click.id) as AgentNode
    expect(sent.ms).toBe(10)
  })

  it('branch koşusu bilinmeyen branch’i ve süren koşuyu reddeder', async () => {
    const h = harness()
    const unknown = await callTool('run.from', { branchId: 'yok-boyle' }, h.ctx)
    expect(unknown.ok).toBe(false)
    expect(h.runs).toHaveLength(0)

    const id = await h.openBranch()
    const busy: ToolContext = { ...h.ctx, isRunning: () => true }
    const refused = await callTool('run.from', { branchId: id }, busy)
    expect(refused.ok).toBe(false)
    expect(refused.message).toContain('zaten sürüyor')
  })
})
