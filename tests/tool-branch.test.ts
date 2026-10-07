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
  MAX_GROUPS,
  branchesOf,
  materialize,
  newBranch,
  toolLayerSave,
  viewBranch,
  windowSave,
  type BranchRecord,
} from '../electron/tool-branch'
import { beginRun, endRun, frozenReport, noteStep, setDebugRun } from '../electron/tool-state'
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
    // Geri alma hakkı ancak pencere onayladıktan sonra harcanır: peek okur, commit tüketir.
    peekMergeUndo: () => undoAvailable,
    commitMergeUndo: () => {
      const snap = undoAvailable
      undoAvailable = null
      if (!snap) return false
      const back = dropped.pop()
      if (back) book.branches = [...branchesOf(book), back]
      return true
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
    // Tuvale çizilebilsin diye türetilmiş grafik ve temeli de geliyor.
    const derived = diff.data?.graph as AgentGraph
    expect((derived.nodes.find((n) => n.id === h.wait.id) as AgentNode).ms).toBe(4000)
    expect((diff.data?.baseGraph as AgentGraph).nodes.find((n) => n.id === h.wait.id)).toBeTruthy()
    expect((diff.data?.baseGraph as AgentGraph).nodes.find((n) => n.id === h.wait.id)?.ms).toBe(2000)
    // Ve tarifin dokunduğu temel node'lar: "bölge" bunlarla bulunur.
    const anchors = diff.data?.anchors as { id: string; title: string; packagePath: string[]; how: string[] }[]
    expect(anchors.map((a) => a.id)).toEqual([h.wait.id])
    expect(anchors[0].title).toBe('Zamanlayıcı 1')
    expect(anchors[0].how.join(' ')).toContain('alan değişiyor')
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
    // Dolu çıkışa düğüm eklenemez: önce eski oku kaldır, sonra ekle.
    await callTool(
      'flow.edit',
      {
        branchId: id,
        ops: [
          { op: 'disconnect', from: h.click.id },
          { op: 'addNode', key: 'k', kind: 'key', fields: { keys: '{ESC}' }, connectFrom: h.click.id },
        ],
      },
      h.ctx
    )
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

    // Branch'in başından koşu da olsa, akışı baştan çalıştırmak açık onay ister.
    const noFlag = await callTool('run.from', { branchId: id }, h.ctx)
    expect(noFlag.ok).toBe(false)
    expect(noFlag.message).toContain('fromStart')
    expect(h.runs).toHaveLength(0)

    const started = await callTool('run.from', { branchId: id, fromStart: true }, h.ctx)
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

  it('dolu tarif yeni düzenlemeyi reddeder, eski grupları silmez', async () => {
    const h = harness()
    const id = await h.openBranch('Dolu tarif')
    // Tarifi sınıra kadar doldur (her çağrı bir grup).
    for (let i = 1; i <= MAX_GROUPS; i++) {
      const r = await callTool('flow.edit', { branchId: id, ops: [patchWait(h.wait.id, 2000 + i)] }, h.ctx)
      expect(r.ok).toBe(true)
    }
    expect(h.branchOf(id).groups).toHaveLength(MAX_GROUPS)
    expect(h.branchOf(id).groups[0].ops).toHaveLength(1)

    const extra = await callTool('flow.edit', { branchId: id, ops: [patchWait(h.wait.id, 9999)] }, h.ctx)
    expect(extra.ok).toBe(false)
    expect(extra.message).toContain('dolu')
    // İlk grup yerinde ve tarif bozulmadı.
    expect(h.branchOf(id).groups).toHaveLength(MAX_GROUPS)
    const view = viewBranch(h.book, h.branchOf(id))
    expect((view.derived?.nodes.find((n) => n.id === h.wait.id) as AgentNode).ms).toBe(2000 + MAX_GROUPS)

    // Yer açılınca yeniden düzenlenebilir.
    await callTool('flow.undo', { branchId: id }, h.ctx)
    const again = await callTool('flow.edit', { branchId: id, ops: [patchWait(h.wait.id, 4321)] }, h.ctx)
    expect(again.ok).toBe(true)
  })

  it('alternatif yol: giriş/çıkış tarifde görünür, merge eski kolu siler', async () => {
    const h = harness()
    const id = await h.openBranch('Alternatif yol')
    // Temel: Başlangıç → Kaydet(tıkla) → bekle → Bitir.
    // Alternatif: Başlangıç'tan ayrıl, yeni bir bekleme koy, "bekle" node'una geri dön.
    const before = h.book.tabs[0].graph
    const entry = h.start
    const exit = h.wait
    const mid = h.click

    const edited = await callTool(
      'flow.edit',
      {
        branchId: id,
        ops: [
          { op: 'disconnect', from: entry.id },
          { op: 'addNode', key: 'alt', kind: 'wait', fields: { ms: 700, title: 'Alternatif bekleme' }, connectFrom: entry.id },
          { op: 'connect', from: 'alt', to: exit.id },
        ],
        note: 'alternatif yol',
      },
      h.ctx
    )
    expect(edited.ok).toBe(true)

    // Tarif, yolun şeklini kendisi söylüyor: giriş → çıkış.
    const record = h.branchOf(id)
    expect(record.path).toBeTruthy()
    expect(record.path?.entry.nodeId).toBe(entry.id)
    expect(record.path?.exit.nodeId).toBe(exit.id)
    expect(JSON.stringify(record)).toContain('"path"')

    // Merge denemesi neyin silineceğini önceden söyler, hiçbir şey yazmaz.
    const tried = await callTool('branch.merge', { branchId: id }, h.ctx)
    expect(tried.ok).toBe(true)
    expect(tried.data?.applied).toBe(false)
    expect((tried.data?.wouldRemove as string[])).toContain(mid.id)
    expect(JSON.stringify(h.book.tabs[0].graph)).toBe(JSON.stringify(before))

    // Uygula: alternatif ana yol olur, yerini aldığı eski kol gider.
    const applied = await callTool('branch.merge', { branchId: id, apply: true }, h.ctx, 'panel')
    expect(applied.ok).toBe(true)
    const after = h.merges.at(-1)?.graph as AgentGraph
    expect(after.nodes.some((n) => n.id === mid.id)).toBe(false)
    expect(after.nodes.some((n) => n.title === 'Alternatif bekleme')).toBe(true)
    expect(after.nodes.some((n) => n.id === exit.id)).toBe(true)
    expect(after.edges.some((e) => e.from === entry.id && e.to === mid.id)).toBe(false)
    expect(after.edges.some((e) => e.to === mid.id)).toBe(false)
    expect(applied.message).toContain('silindi')
  })

  it('uyarıyı cevapta gösterir: gösterilmeyen uyarı uyarı değildir', async () => {
    const h = harness()
    const id = await h.openBranch('Uyarı sınaması')
    // Akışa bağlanmayan bir zincir: denetleyici uyarır, cevap bunu söylemek zorunda.
    const edited = await callTool(
      'flow.edit',
      { branchId: id, ops: [{ op: 'addNode', key: 'a', kind: 'wait', fields: { ms: 100, title: 'Öksüz bekleme' } }] },
      h.ctx
    )
    expect(edited.ok).toBe(true)
    expect((edited.data?.warnings as string[]).join(' ')).toContain('Başlangıç')
    expect(edited.message).toContain('Uyarı')
    expect(edited.message).toContain('Öksüz bekleme')
  })

  it('paket içindeki node düzenlenebilir; temel tuval dokunulmaz', async () => {
    const h = harness()
    const id = await h.openBranch('Paket içi onarım')
    // Kullanıcının akışında olduğu gibi bir paket ve içinde bir akış: dışarıdan düzenlenemez.
    const pkg = createNode('package', 400, 200, 1)
    pkg.title = 'Remesh paketi'
    const innerStart = createNode('start', 0, 0)
    const innerWait = createNode('wait', 220, 0, 1)
    innerWait.title = 'Paket içi bekleme'
    innerWait.ms = 2000
    const innerEnd = createNode('end', 460, 0)
    pkg.inner = {
      nodes: [innerStart, innerWait, innerEnd],
      edges: [
        { id: 'ie1', from: innerStart.id, fromPort: 'next', to: innerWait.id },
        { id: 'ie2', from: innerWait.id, fromPort: 'next', to: innerEnd.id },
      ],
    }
    h.book.tabs[0].graph.nodes.push(pkg)

    const edited = await callTool(
      'flow.edit',
      { branchId: id, packagePath: [pkg.id], ops: [{ op: 'patchNode', id: innerWait.id, fields: { ms: 4321 } }], note: 'paket içi bekleme' },
      h.ctx
    )
    expect(edited.ok).toBe(true)
    expect(edited.message).toContain('paket')
    expect(edited.message).toContain('Remesh paketi')

    const view = viewBranch(h.book, h.branchOf(id))
    const derivedPkg = (view.derived as AgentGraph).nodes.find((n) => n.id === pkg.id) as AgentNode
    expect((derivedPkg.inner?.nodes.find((n) => n.id === innerWait.id) as AgentNode).ms).toBe(4321)
    // Temel tuval dokunulmadı: paketin kendi hâli hâlâ 2000.
    const basePkg = h.book.tabs[0].graph.nodes.find((n) => n.id === pkg.id) as AgentNode
    expect((basePkg.inner?.nodes.find((n) => n.id === innerWait.id) as AgentNode).ms).toBe(2000)

    // Aynı düzenleme, paket yolu verilmeden reddedilir: dışarıdan içeri erişilemez.
    const noPath = await callTool('flow.edit', { branchId: id, ops: [{ op: 'patchNode', id: innerWait.id, fields: { ms: 9 } }] }, h.ctx)
    expect(noPath.outcome).toBe('plan-gecersiz')
    expect(noPath.message).toContain('bulunamadı')
  })

  it('belirsiz/koşullu/çevrimli eski kolda otomatik silme yapmaz', async () => {
    const h = harness()
    const id = await h.openBranch('Belirsiz bölge')
    const g = h.book.tabs[0].graph
    // Temel akışı belirsiz hâle getir: Başlangıç → tıkla → koşul; koşulun İKİ çıkışı var.
    const cond = createNode('condition', 700, 0, 1)
    cond.id = 'ambiguous-cond'
    cond.title = 'Belirsiz koşul'
    const no = createNode('wait', 950, 160, 1)
    no.id = 'ambiguous-no'
    no.title = 'Öbür kol'
    no.ms = 400
    g.nodes.push(cond, no)
    // tıkla → koşul (bekleme devreden çıkar), koşul.true → Bitir, koşul.false → bekleme
    g.edges = g.edges.filter((e) => !(e.from === h.click.id && e.fromPort === 'next') && !(e.from === h.wait.id && e.fromPort === 'next'))
    g.edges.push({ id: 'amb-e1', from: h.click.id, fromPort: 'next', to: cond.id })
    g.edges.push({ id: 'amb-e2', from: cond.id, fromPort: 'true', to: h.end.id })
    g.edges.push({ id: 'amb-e3', from: cond.id, fromPort: 'false', to: no.id })

    // Alternatif: Başlangıç'tan ayrıl, yeni bekleme koy, Bitir'e dön.
    // Eski kol Başlangıç → tıkla → koşul ve koşul ikiye ayrılıyor: silme hesabı belirsiz.
    const edited = await callTool(
      'flow.edit',
      {
        branchId: id,
        ops: [
          { op: 'disconnect', from: h.start.id },
          { op: 'addNode', key: 'alt', kind: 'wait', fields: { ms: 300, title: 'Alternatif' }, connectFrom: h.start.id },
          { op: 'connect', from: 'alt', to: h.end.id },
        ],
      },
      h.ctx
    )
    expect(edited.ok).toBe(true)
    expect(h.branchOf(id).path?.exit.nodeId).toBe(h.end.id)

    // Deneme: neyin silineceğini söyler — belirsizse hiçbir şey.
    const tried = await callTool('branch.merge', { branchId: id }, h.ctx)
    expect(tried.ok).toBe(true)
    expect((tried.data?.wouldRemove as string[])).toEqual([])
    expect(String(tried.message)).toContain('belirsiz')

    // Uygula: alternatif yazılır ama hiçbir node silinmez.
    const before = h.book.tabs[0].graph.nodes.map((n) => n.id).sort().join(',')
    const applied = await callTool('branch.merge', { branchId: id, apply: true }, h.ctx, 'panel')
    expect(applied.ok).toBe(true)
    const after = h.merges.at(-1)?.graph as AgentGraph
    expect(after.nodes.some((n) => n.id === h.wait.id)).toBe(true)
    expect(after.nodes.some((n) => n.id === h.click.id)).toBe(true)
    expect(after.nodes.length).toBeGreaterThanOrEqual(before.split(',').length)
  })

  it('hatadan devam: donmuş kutunun aynı öğesinden başlar, kayıtlı akışa dokunmaz', async () => {
    const h = harness()
    const id = await h.openBranch('Devam sınaması')
    // Kutulu bir akış: Başlangıç → kutu (öğeler: a, b, c) → Bitir
    const box = createNode('loop', 300, 0, 1)
    box.id = 'resume-loop'
    box.title = 'Üç öğe'
    box.items = ['a', 'b', 'c']
    const inner = createNode('wait', 500, 0, 1)
    inner.id = 'resume-inner'
    inner.title = 'Öğe işi'
    inner.ms = 100
    box.members = [inner.id]
    h.book.tabs[0].graph.nodes.push(box, inner)
    h.book.tabs[0].graph.edges.push({ id: 're1', from: box.id, fromPort: 'next', to: inner.id })

    // Donmuş bir hata varmış gibi: kutu ikinci öğede (index 1) ve çözülmüş değişkenleriyle.
    beginRun(h.book.tabs[0].graph)
    setDebugRun(true)
    noteStep({ id: 'resume-inner', status: 'error' })
    const frozen = frozenReport()
    expect(frozen).not.toBeNull()
    // Donma anında kutu bağlamı rapora girer.
    const boxNote = { id: box.id, title: box.title, index: 1, total: 3, item: 'b', vars: { '{{öğe}}': 'b', '{{sıra}}': '2' } }
    ;(frozen as unknown as { loops: unknown[] }).loops = [boxNote]
    endRun({ ok: false })

    // Kayıtlı akışta devam yok: işaretler yalnız branch kopyasında değişir.
    const plain = await callTool('run.from', { branchId: '', nodeId: inner.id, resumeFromFailure: true, fromStart: true }, h.ctx)
    expect(plain.ok).toBe(false)

    const resumed = await callTool(
      'run.from',
      { branchId: id, nodeId: 'resume-inner', packagePath: [], derivedIgnore: true, resumeFromFailure: true, fromStart: true },
      h.ctx
    )
    expect(resumed.ok).toBe(true)
    expect(String(resumed.message)).toContain('hatadan devam')
    expect(String(resumed.message)).toContain('2/3')
    expect(String(resumed.message)).toContain('b')
    expect(String(resumed.message)).toContain('{{sıra}}=2')
    // Devam, kutunun işaretini gerçekten kurar.
    const ran = h.runs.at(-1)?.graph as AgentGraph
    const ranBox = ran.nodes.find((n) => n.id === box.id) as AgentNode
    expect(ranBox.startIndex).toBe(1)
    // Kayıtlı tuval dokunulmadı.
    const baseBox = h.book.tabs[0].graph.nodes.find((n) => n.id === box.id) as AgentNode
    expect(baseBox.startIndex ?? 0).toBe(0)
  })

  it('ajan öneriyi tuvalde gösterebilir ve kapatabilir; akışa yazmaz', async () => {
    const h = harness()
    const id = await h.openBranch('Gösterim sınaması')
    const shown: { branchId: string; branchName: string }[] = []
    h.ctx.showBranch = async (payload) => {
      shown.push(payload)
      return { ok: true }
    }
    const before = JSON.stringify(h.book.tabs[0].graph)

    const shownOk = await callTool('branch.show', { branchId: id }, h.ctx)
    expect(shownOk.ok).toBe(true)
    expect(shown?.at(-1)?.branchId).toBe(id)
    expect(String(shownOk.message)).toContain('gösterildi')
    expect(JSON.stringify(h.book.tabs[0].graph)).toBe(before)

    const closed = await callTool('branch.show', { close: true }, h.ctx)
    expect(closed.ok).toBe(true)
    expect(shown?.at(-1)?.branchId).toBe('')
    expect(String(closed.message)).toContain('kapatıldı')

    // Pencere yanıt vermezse dürüstçe söyler.
    h.ctx.showBranch = async () => ({ ok: false, error: 'pencere yanıt vermedi' })
    const failedShow = await callTool('branch.show', { branchId: id }, h.ctx)
    expect(failedShow.ok).toBe(false)
    expect(String(failedShow.message)).toContain('gösterilemedi')
  })

  it('iki onarım aynı branch’te birikir; yeni branch öncekini taşımaz ve bunu söyler', async () => {
    const h = harness()
    const id = await h.openBranch('Onarım 1 ve 2')
    // Birinci onarım: beklemeyi kısalt. İkinci onarım: tıklamanın metnini değiştir.
    const one = await callTool('flow.edit', { branchId: id, ops: [patchWait(h.wait.id, 4000)], note: 'onarım 1' }, h.ctx)
    expect(one.ok).toBe(true)
    const two = await callTool('flow.edit', { branchId: id, ops: [{ op: 'patchNode', id: h.click.id, fields: { prompt: 'Kaydet (yeni)' } }], note: 'onarım 2' }, h.ctx)
    expect(two.ok).toBe(true)

    // İki onarım da aynı türetilmiş grafikte: ikincisi birinciyi ezmiyor.
    const view = viewBranch(h.book, h.branchOf(id))
    const nodes = (view.derived as AgentGraph).nodes
    expect((nodes.find((n) => n.id === h.wait.id) as AgentNode).ms).toBe(4000)
    expect((nodes.find((n) => n.id === h.click.id) as AgentNode).prompt).toBe('Kaydet (yeni)')
    expect(h.branchOf(id).groups).toHaveLength(2)
    expect(two.message).toContain('2 düzenleme')

    // Yeni bir branch temel tuvalden başlar: önceki onarımları İÇERMEZ, ve uyarı bunu söyler.
    const fresh = await callTool('branch.create', { name: 'Yeni yol' }, h.ctx)
    expect(fresh.ok).toBe(true)
    expect(String(fresh.message)).toContain('İÇERMEZ')
    expect((fresh.data?.carriesEarlier as { name: string }[])[0].name).toBe('Onarım 1 ve 2')
    const freshId = String(fresh.data?.branchId ?? '')
    const freshView = viewBranch(h.book, h.branchOf(freshId))
    expect(((freshView.derived as AgentGraph).nodes.find((n) => n.id === h.wait.id) as AgentNode).ms).toBe(2000)

    // Bilerek istenirse uyarı susar.
    await callTool('branch.drop', { branchId: freshId }, h.ctx)
    const onPurpose = await callTool('branch.create', { name: 'Bilinçli yeni yol', allowCarry: true }, h.ctx)
    expect(String(onPurpose.message)).not.toContain('İÇERMEZ')
  })

  it('hatadan devam: liste değişmişse aynı sıraya körlemesine devam etmez', async () => {
    const h = harness()
    const id = await h.openBranch('Liste sınaması')
    const box = createNode('loop', 300, 0, 1)
    box.id = 'list-loop'
    box.title = 'İki öğe'
    box.items = ['a', 'b']
    const inner = createNode('wait', 500, 0, 1)
    inner.id = 'list-inner'
    inner.ms = 50
    box.members = [inner.id]
    h.book.tabs[0].graph.nodes.push(box, inner)
    h.book.tabs[0].graph.edges.push({ id: 'li-e1', from: box.id, fromPort: 'next', to: inner.id })

    beginRun(h.book.tabs[0].graph)
    setDebugRun(true)
    noteStep({ id: 'list-inner', status: 'error' })
    const frozen = frozenReport()
    expect(frozen).not.toBeNull()
    // Kayıtlı öğe "b" (ikinci sıra) — ama kutunun o sırasında artık başka bir öğe var.
    ;(frozen as unknown as { loops: unknown[] }).loops = [
      { id: box.id, title: box.title, index: 1, total: 2, item: 'baska-dosya', vars: {} },
    ]
    endRun({ ok: false })

    const refused = await callTool('run.from', { branchId: id, nodeId: 'list-inner', resumeFromFailure: true }, h.ctx)
    expect(refused.ok).toBe(false)
    expect(String(refused.message)).toContain('Liste değişmiş')
    expect(String(refused.message)).toContain('baska-dosya')

    // Kayıt gerçekten o sıradaki öğeyle aynıysa devam eder.
    ;(frozen as unknown as { loops: { item?: string }[] }).loops[0].item = 'b'
    const ok = await callTool('run.from', { branchId: id, nodeId: 'list-inner', resumeFromFailure: true }, h.ctx)
    expect(ok.ok).toBe(true)
    endRun({ ok: true })
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
