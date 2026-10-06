import { describe, expect, it } from 'vitest'
import { createNode, type AgentGraph, type AgentNode, type AppSettings, type CanvasBook } from '../electron/graph-types'
import { chainOf, contextOf, countEdges, findPlace, walkGraph } from '../electron/tool-context'
import { callTool, toolList, actionSent, windowMismatch, withFastFind, type ToolContext } from '../electron/tools'
import { windowEventAllowed } from '../electron/run-events'
import { beginRun, endRun } from '../electron/tool-state'

let seq = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `e${++seq}`, from: from.id, fromPort, to: to.id })

/** Başlangıç → Her Öğe İçin (g1, g2) → [Paket → içi: Başlangıç → Tıkla] */
function fixture() {
  const root = createNode('start', 0, 0)
  const loop = createNode('loop', 200, 100)
  loop.title = 'Gruplar'
  loop.items = ['g1', 'g2']
  const pkg = createNode('package', 300, 150)
  pkg.title = 'Blender'
  const innerStart = createNode('start', 0, 0)
  const click = createNode('click', 100, 0)
  click.prompt = 'Kaydet'
  pkg.inner = { nodes: [innerStart, click], edges: [edge(innerStart, 'next', click)] }
  loop.members = [pkg.id]
  const graph: AgentGraph = { nodes: [root, loop, pkg], edges: [edge(root, 'next', loop)] }
  return { graph, loop, pkg, click }
}

function ctx(graph: AgentGraph, over: Partial<ToolContext> = {}): ToolContext {
  // A book with that flow on its only canvas, mutated the way the app mutates it.
  let book: CanvasBook = { activeId: 'canvas-1', tabs: [{ id: 'canvas-1', name: 'Tuval 1', graph }] }
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
  return { ...base, ...over }
}

describe('akış okuma: paket ve döngü bağlamı', () => {
  it('paketin içindeki node, paketin bağlı olduğu kutuyu da görür', () => {
    const { graph, pkg, loop, click } = fixture()
    const place = findPlace(graph, click.id)
    expect(place?.packagePath).toEqual([pkg.id])
    expect(place?.loops.map((l) => l.id)).toEqual([loop.id])
  })

  it('döngü işaretini ve çözülmüş değişkenleri verir', () => {
    const { graph, loop, click } = fixture()
    const first = contextOf(graph, click.id)
    expect(first?.loop?.item).toBe('g1')
    expect(first?.loop?.index).toBe(0)
    expect(first?.loop?.total).toBe(2)
    expect(first?.loop?.vars?.['oge']).toBe('g1')
    expect(first?.loop?.vars?.['oge.isim']).toBe('g1')
    expect(first?.loop?.vars?.['sira']).toBe('1')

    loop.startIndex = 1
    const second = contextOf(graph, click.id)
    expect(second?.loop?.item).toBe('g2')
    expect(second?.loop?.vars?.['sira']).toBe('2')
  })

  it('her node’u bir kez gezer, paketlerin içi dahil', () => {
    const { graph } = fixture()
    const seen: string[] = []
    walkGraph(graph, ({ node }) => seen.push(node.id))
    expect(seen).toHaveLength(5)
    expect(new Set(seen).size).toBe(5)
  })
})

describe('araç katmanı', () => {
  it('akışı okur ve sayıları söyler', async () => {
    const { graph } = fixture()
    const r = await callTool('flow.read', { graph }, ctx(graph))
    expect(r.ok).toBe(true)
    expect(r.outcome).toBe('tamam')
    expect(r.message).toContain('paket')
    expect((r.data?.nodes as unknown[]).length).toBe(5)
    expect((r.data?.loops as unknown[]).length).toBe(1)
    expect((r.data?.packages as unknown[]).length).toBe(1)
  })

  it('bilinmeyen aracı açıkça reddeder', async () => {
    const { graph } = fixture()
    const unknown = await callTool('yok.boyle', {}, ctx(graph))
    expect(unknown.ok).toBe(false)
    expect(unknown.message).toContain('Bilinmeyen')
  })

  it('önizleme, eksik nodeId ve bilinmeyen node için motoru yüklemeden cevap verir', async () => {
    const { graph } = fixture()
    const missing = await callTool('target.preview', {}, ctx(graph))
    expect(missing.ok).toBe(false)
    expect(missing.message).toContain('nodeId')
    const bogus = await callTool('target.preview', { nodeId: 'yok-boyle-node' }, ctx(graph))
    expect(bogus.ok).toBe(false)
    expect(bogus.message).toContain('bulunamadı')
  })

  it('katalog hem hazır hem sıradaki araçları listeler', () => {
    const list = toolList()
    const names = list.map((t) => t.name)
    expect(names).toContain('target.preview')
    expect(names).toContain('flow.read')
    expect(names).toContain('step.run')
    expect(names).toContain('run.state')
    expect(list.find((t) => t.name === 'step.run')?.ready).toBe(true)
    expect(list.find((t) => t.name === 'step.run')?.sendsInput).toBe(true)
    expect(list.find((t) => t.name === 'run.state')?.ready).toBe(true)
    expect(list.find((t) => t.name === 'run.stop')?.ready).toBe(true)
    expect(list.find((t) => t.name === 'run.from')?.ready).toBe(true)
    expect(list.find((t) => t.name === 'screen.read')?.ready).toBe(true)
    // Katalogda "sırada" diye bekleyen araç kalmadı.
    expect(list.every((t) => t.ready)).toBe(true)
  })

  it('eylemin gönderildiği, node türüne göre dürüstçe bildirilir', async () => {
    // Tıklama iz bırakır; tuş ve yazma iz bırakmaz, orada "node bitti" kanıttır.
    expect(actionSent('click', 'done', [{ kind: 'input' } as never])).toBe(true)
    expect(actionSent('click', 'done', [])).toBe(false)
    expect(actionSent('key', 'done', [])).toBe(true)
    expect(actionSent('key', 'error', [])).toBe(false)
    expect(actionSent('type', 'done', [])).toBe(true)
    expect(actionSent('wait', 'done', [])).toBe(false)
    expect(actionSent('condition', 'done', [])).toBe(false)
    // İnisiyatif yalnızca gerçekten tıkladıysa eylem göndermiş sayılır.
    expect(actionSent('ai', 'done', [])).toBe(false)
    expect(actionSent('ai', 'done', [{ kind: 'input' } as never])).toBe(true)
  })

  it('koşu bittikten sonra son sonucu bildirir', async () => {
    const { graph } = fixture()
    beginRun(graph, 'baslangic')
    endRun({ ok: true, steps: 9, failed: 0 })
    const r = await callTool('run.state', {}, ctx(graph))
    expect(r.message).toContain('Son koşu')
    expect(r.message).toContain('tamamlandı')
    expect(r.message).toContain('9 adım')
    const last = r.data?.last as { ok?: boolean; steps?: number } | null
    expect(last?.ok).toBe(true)
    expect(last?.steps).toBe(9)
  })

  it('dış çağıran kendi tuvalini gönderemez; kayıtlı akış kullanılır', async () => {
    const { graph } = fixture()
    const stored: AgentGraph = { nodes: [createNode('start', 0, 0)], edges: [] }
    const base = ctx(graph, { getGraph: () => stored })

    // Ajan kaynağı: gönderilen tuval yok sayılır (run.from onu diske yazardı).
    const asAgent = await callTool('flow.read', { graph }, base, 'agent')
    expect((asAgent.data?.nodes as unknown[]).length).toBe(1)
    // Panel kaynağı: kişi kendi tuvalini okur.
    const asPanel = await callTool('flow.read', { graph }, base, 'panel')
    expect((asPanel.data?.nodes as unknown[]).length).toBe(5)
  })

  it('öneri: geçerli planı denetler, farkı verir ve akışa hiçbir şey yazmaz', async () => {
    const { graph, loop } = fixture()
    const before = JSON.stringify(graph)
    const r = await callTool(
      'flow.suggest',
      {
        graph,
        ops: [
          { op: 'addNode', key: 'w', kind: 'wait', fields: { ms: 900, title: 'Remesh için bekle' }, connectFrom: loop.id, fromPort: 'done' },
        ],
      },
      ctx(graph)
    )
    expect(r.ok).toBe(true)
    expect(r.outcome).toBe('tamam')
    expect(r.message).toContain('Plan geçerli')
    expect(r.message).toContain('Hiçbir şey yazılmadı')
    const diff = r.data?.diff as { addedNodes: unknown[]; addedEdges: string[] }
    expect(diff.addedNodes).toHaveLength(1)
    expect(diff.addedEdges).toHaveLength(1)
    expect(r.data?.valid).toBe(true)
    // Asıl güvence: araç grafiğe dokunmadı.
    expect(JSON.stringify(graph)).toBe(before)
  })

  it('öneri: geçersiz planı açıkça söyler, yine de cevap verir ve yazmaz', async () => {
    const { graph, loop } = fixture()
    const before = JSON.stringify(graph)
    const r = await callTool(
      'flow.suggest',
      { graph, ops: [{ op: 'patchNode', id: loop.id, fields: { locator: { text: 'x' } } }] },
      ctx(graph)
    )
    expect(r.ok).toBe(true)
    expect(r.outcome).toBe('plan-gecersiz')
    expect(r.data?.valid).toBe(false)
    expect((r.data?.errors as string[])[0]).toContain('locator')
    expect(r.message).toContain('hiçbir şey yazılmadı')
    expect(JSON.stringify(graph)).toBe(before)
  })

  it('öneri: plan verilmezse neyin düzenlenebileceğini söyler', async () => {
    const { graph } = fixture()
    const r = await callTool('flow.suggest', { graph }, ctx(graph))
    expect(r.ok).toBe(true)
    expect((r.data?.editableFields as string[])).toContain('prompt')
    expect((r.data?.addableKinds as string[])).toContain('condition')
    expect(r.message).toContain('locator')
    expect(r.message).toContain('paketlerin içi')
  })

  it('hızlı bakış yalnız ekran aşamalarını bırakır, model aşamalarını atar', () => {
    const settings = {
      findOrder: ['chrome', 'uia', 'icon', 'windows', 'onnx', 'list', 'tars', 'offset'],
      findOff: ['list'],
    } as unknown as AppSettings
    const fast = withFastFind(settings)
    expect(fast.findOrder).toEqual(['chrome', 'uia', 'icon', 'windows', 'onnx'])
    expect(fast.findOrder).not.toContain('tars')
    expect(fast.findOrder).not.toContain('offset')
    expect(fast.findOff).toEqual([])
    // Hiç ekran aşaması yoksa en azından UIA kalır: arama boş bir merdivenle çalışmaz.
    expect(withFastFind({ findOrder: ['list', 'tars'], findOff: [] } as unknown as AppSettings).findOrder).toEqual(['uia'])
    // Ve ayarın kendisi değişmez.
    expect(settings.findOrder).toHaveLength(8)
  })

  it('tek adım, kendisinden önce kalan durdurma isteğini temizler', async () => {
    const { graph } = fixture()
    let cleared = 0
    const busy = ctx(graph, { isRunning: () => true, clearStop: () => { cleared += 1 } })
    // Koşu sürerken reddedilir: kilit alınmadığı için temizlik de yapılmaz.
    const refused = await callTool('step.run', { nodeId: 'x' }, busy)
    expect(refused.ok).toBe(false)
    expect(cleared).toBe(0)
  })

  it('öneri koşusunda adım ve patch olayları pencereye gitmez', () => {
    // Adım olayları tuvali ışıklandırır, patch olayları node'un hafızasını/yolunu değiştirir;
    // öneri koşusu temel akışın kimliklerini kullandığı için ikisi de pencereye uğramamalı.
    expect(windowEventAllowed('agent:step', true)).toBe(false)
    expect(windowEventAllowed('agent:patch', true)).toBe(false)
    expect(windowEventAllowed('agent:log', true)).toBe(true)
    expect(windowEventAllowed('agent:step', false)).toBe(true)
    expect(windowEventAllowed('agent:patch', false)).toBe(true)
  })

  it('istenen pencere okunmadıysa bu açıkça söylenir', () => {
    expect(windowMismatch('Notepad', 'Notepad')).toBe(false)
    expect(windowMismatch('notepad', 'Notepad — belgesiz')).toBe(false)
    expect(windowMismatch('Notepad', '')).toBe(true)
    expect(windowMismatch('Notepad', 'Nubbo Agent Studio')).toBe(true)
    expect(windowMismatch('', 'herhangi')).toBe(false)
  })

  it('boş branchId ve onaysız baştan koşu asla koşu başlatmaz', async () => {
    const { graph, click } = fixture()
    const calls: unknown[] = []
    const c = ctx(graph, {
      startRun: async () => {
        calls.push(1)
        return { ok: true }
      },
    })

    // Boş kimlik "branch yok" sayılamaz: bir kez sayıldı ve kullanıcının akışı baştan koştu.
    const empty = await callTool('run.from', { branchId: '', nodeId: click.id }, c)
    expect(empty.ok).toBe(false)
    expect(empty.message).toContain('branchId boş')
    expect(calls).toHaveLength(0)

    const alsoEmpty = await callTool('step.run', { branchId: '', nodeId: click.id }, c)
    expect(alsoEmpty.ok).toBe(false)
    expect(alsoEmpty.message).toContain('branchId boş')

    // Node verilmeden baştan koşu, açık onay ister.
    const noStart = await callTool('run.from', {}, c)
    expect(noStart.ok).toBe(false)
    expect(noStart.message).toContain('fromStart')
    expect(calls).toHaveLength(0)

    // Node verilirse (ya da açık onay verilirse) başlar.
    const fromNode = await callTool('run.from', { nodeId: click.id }, c)
    expect(fromNode.ok).toBe(true)
    expect(calls).toHaveLength(1)
    const onPurpose = await callTool('run.from', { fromStart: true }, c)
    expect(onPurpose.ok).toBe(true)
    expect(calls).toHaveLength(2)
    endRun({ ok: true })
  })

  it('buradan devam: kutu yoluyla koşuyu başlatır, sürerken reddeder', async () => {
    const { graph, pkg, click } = fixture()
    const calls: { nodeId?: string; packagePath?: string[] }[] = []
    const starting = ctx(graph, {
      startRun: async (_g, startId, packagePath) => {
        calls.push({ nodeId: startId, packagePath })
        return { ok: true }
      },
    })
    const started = await callTool('run.from', { nodeId: click.id }, starting)
    expect(started.ok).toBe(true)
    expect(started.message).toContain('Koşu başladı')
    expect(calls).toHaveLength(1)
    expect(calls[0].nodeId).toBe(click.id)
    // Paket içindeki node: koşu doğru paket yolundan devam eder.
    expect(calls[0].packagePath).toEqual([pkg.id])

    const busy = await callTool('run.from', { nodeId: click.id }, ctx(graph, { isRunning: () => true }))
    expect(busy.ok).toBe(false)
    expect(busy.message).toContain('zaten sürüyor')
  })

  it('tek adım: eksik node, bilinmeyen node, başlangıç/bitir ve koşu sürerken reddedilir', async () => {
    const { graph, click } = fixture()
    const noId = await callTool('step.run', {}, ctx(graph))
    expect(noId.ok).toBe(false)
    expect(noId.message).toContain('nodeId')

    const bogus = await callTool('step.run', { nodeId: 'yok-boyle' }, ctx(graph))
    expect(bogus.ok).toBe(false)
    expect(bogus.message).toContain('bulunamadı')

    const plain = { ...ctx(graph), isRunning: () => true }
    const running = await callTool('step.run', { nodeId: click.id }, plain)
    expect(running.ok).toBe(false)
    expect(running.message).toContain('koşu')

    const startNode = graph.nodes[0]
    const start = await callTool('step.run', { nodeId: startNode.id }, ctx(graph))
    expect(start.ok).toBe(false)
    expect(start.message).toContain('tek adımda çalıştırılmaz')
  })

  it('döngünün tur işini (üyeleri) ve öğe kaynağını da verir', async () => {
    const { graph, loop, pkg } = fixture()
    loop.templated = true
    loop.count = 2
    const r = await callTool('flow.read', { graph }, ctx(graph))
    type Row = { id: string; members: { id: string; kind: string }[]; templated?: boolean; count?: number }
    const row = (r.data?.loops as Row[]).find((l) => l.id === loop.id)
    expect(row?.members.map((m) => m.id)).toEqual([pkg.id])
    expect(row?.members[0].kind).toBe('package')
    expect(row?.templated).toBe(true)
    expect(row?.count).toBe(2)
  })

  it('bağlantı sayısı paketlerin içini de sayar', () => {
    const { graph } = fixture()
    // Kökte Başlangıç → kutu; paketin içinde Başlangıç → Tıkla.
    expect(countEdges(graph)).toBe(2)
  })

  it('döngü zincirini dıştan içe verir', () => {
    const root = createNode('start', 0, 0)
    const outer = createNode('loop', 100, 0)
    outer.title = 'Gruplar'
    outer.items = ['g1', 'g2']
    const inner = createNode('loop', 200, 0)
    inner.title = 'Dosyalar'
    inner.items = ['a.png', 'b.png']
    const c = createNode('click', 300, 0)
    outer.members = [inner.id]
    inner.members = [c.id]
    const graph: AgentGraph = { nodes: [root, outer, inner, c], edges: [edge(root, 'next', outer)] }

    const chain = chainOf(graph, c.id)

    expect(chain.map((l) => l.title)).toEqual(['Gruplar', 'Dosyalar'])
    expect(chain[0].item).toBe('g1')
    expect(chain[1].item).toBe('a.png')
    // Değişkenler dıştan içe birleşir: iç kutunun {{sıra}}'sı kendi listesinden gelir.
    expect(chain[1].vars?.['sira']).toBe('1')
    expect(chain[1].vars?.['oge']).toBe('a.png')

    // Şablon döngü bilgisi zincirde taşınır: öğe listesi çalışırken doldurulur.
    inner.templated = true
    inner.folder = '{{öğe}}'
    const flagged = chainOf(graph, c.id)
    expect(flagged[1].templated).toBe(true)
    expect(flagged[1].folder).toBe('{{öğe}}')
  })

  it('koşu durumunu ve durdurmayı bildirir', async () => {
    const { graph } = fixture()
    const idle = await callTool('run.state', {}, ctx(graph))
    expect(idle.ok).toBe(true)
    expect(idle.message).toContain('koşu yok')

    let stopped = false
    const stop = await callTool('run.stop', {}, ctx(graph, { requestStop: () => { stopped = true } }))
    expect(stop.ok).toBe(true)
    expect(stopped).toBe(true)
  })

  it('ajan izni: kapalı reddeder, sor onay ister, panel ve okuma sorulmaz', async () => {
    const { graph, click } = fixture()
    const busy = { isRunning: () => true }

    const off = await callTool('step.run', { nodeId: click.id }, ctx(graph, { ...busy, permission: () => 'off' }), 'agent')
    expect(off.ok).toBe(false)
    expect(off.message).toContain('izni kapalı')

    let asked = ''
    const denied = await callTool(
      'step.run',
      { nodeId: click.id },
      ctx(graph, {
        ...busy,
        permission: () => 'ask',
        askApproval: async (s: string) => {
          asked = s
          return false
        },
      }),
      'agent'
    )
    expect(asked).toContain('Tek adım')
    expect(denied.outcome).toBe('durduruldu')
    expect(denied.message).toContain('onay')

    // Kapı geçirir; araç kendi kuralıyla reddeder (koşu sürüyor) — yani izin engellemedi.
    const auto = await callTool('step.run', { nodeId: click.id }, ctx(graph, { ...busy, permission: () => 'auto' }), 'agent')
    expect(auto.message).toContain('koşu')
    // Panelde düğmeye basmak onayın kendisidir.
    const panel = await callTool('step.run', { nodeId: click.id }, ctx(graph, { ...busy, permission: () => 'off' }), 'panel')
    expect(panel.message).toContain('koşu')
    // Okuma araçları hiç sorulmaz.
    const reading = await callTool('flow.read', { graph }, ctx(graph, { permission: () => 'off' }), 'agent')
    expect(reading.ok).toBe(true)
  })
})
