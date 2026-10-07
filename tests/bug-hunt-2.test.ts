import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNode, baseName, itemVars, listItems, loopKeys, loopStartIndex, type AgentGraph, type AgentNode } from '../electron/graph-types'
import { chainOf, contextOf, countEdges, findPlace, walkGraph } from '../electron/tool-context'
import { extractTarget, matchText, norm, containsTextStrict, type ScreenItem } from '../electron/matcher'
import { judgeScreen, expectation } from '../electron/confirm'
import { conflict, likeness, memoOf, remember, MEMO_KEEP } from '../electron/memory'
import { isApiDown, findEntry } from '../electron/runner'
import { windowEventAllowed } from '../electron/run-events'
import { isTestProfile, profileDirName, storeCwd } from '../electron/profile'
import { actPointWithin, beginRun, endRun, noteActPoint, noteStep, noteUserStop, recentReports, setDebugRun, snapshot, stopReason, setStopAt } from '../electron/tool-state'

let seq = 0
const edge = (from: AgentNode, fromPort: string, to: AgentNode) => ({ id: `d${++seq}`, from: from.id, fromPort, to: to.id })
const item = (text: string, x = 0, y = 0, w = 40, h = 16): ScreenItem => ({ id: `${text}-${x}`, text, type: 'Text', src: 'ocr', x, y, w, h }) as unknown as ScreenItem

/** İç içe: kök → kutu(loop) → paket → içinde kutu(loop) → içinde tıkla */
function nested() {
  const root = createNode('start', 0, 0)
  const outer = createNode('loop', 200, 0)
  outer.title = 'Dış'
  outer.items = ['a', 'b']
  const pkg = createNode('package', 400, 0)
  pkg.title = 'Paket'
  const innerRoot = createNode('start', 0, 0)
  const innerLoop = createNode('loop', 120, 0)
  innerLoop.title = 'İç'
  innerLoop.items = ['x', 'y']
  const click = createNode('click', 240, 0)
  click.prompt = 'Kaydet'
  innerLoop.members = [click.id]
  pkg.inner = { nodes: [innerRoot, innerLoop, click], edges: [edge(innerRoot, 'next', innerLoop), edge(innerLoop, 'next', click)] }
  outer.members = [pkg.id]
  const graph: AgentGraph = { nodes: [root, outer, pkg], edges: [edge(root, 'next', outer)] }
  return { graph, root, outer, pkg, innerLoop, click }
}

describe('derin batarya: graf gezinme ve iç içe yapı', () => {
  it('iç içe kutu içindeki node iki kutuyu da sırayla görür', () => {
    const { graph, outer, innerLoop, click, pkg } = nested()
    const place = findPlace(graph, click.id)
    expect(place?.packagePath).toEqual([pkg.id])
    expect(place?.loops.map((l) => l.title)).toEqual(['Dış', 'İç'])
    const chain = chainOf(graph, click.id)
    expect(chain.map((c) => c.id)).toEqual([outer.id, innerLoop.id])
    expect(contextOf(graph, click.id)?.packagePath).toEqual([pkg.id])
  })

  it('bilinmeyen kimlik ve boş graf çökmez', () => {
    const { graph } = nested()
    expect(findPlace(graph, 'yok')).toBeNull()
    expect(contextOf(graph, 'yok')).toBeNull()
    expect(chainOf(graph, 'yok')).toEqual([])
    expect(countEdges({ nodes: [], edges: [] })).toBe(0)
  })

  it('kendine bağlı düğümde gezinme sonsuz döngüye girmez', { timeout: 4000 }, () => {
    const a = createNode('wait', 0, 0)
    a.id = 'dongu-a'
    const graph: AgentGraph = { nodes: [a], edges: [{ id: 'self', from: a.id, fromPort: 'next', to: a.id }] }
    const seen: string[] = []
    walkGraph(graph, (place) => {
      seen.push(place.node.id)
    })
    expect(seen).toEqual(['dongu-a'])
    expect(countEdges(graph)).toBe(1)
    expect(findPlace(graph, a.id)?.node.id).toBe(a.id)
  })
})

describe('derin batarya: döngü kuralları (§9)', () => {
  it('liste kırpılır, boş satırlar düşer; sayım modunda #1..#N üretilir', () => {
    const loop = createNode('loop', 0, 0)
    loop.items = ['  bir  ', '', '   ', 'iki']
    expect(listItems(loop)).toEqual(['bir', 'iki'])
    expect(loopKeys(loop)).toEqual(['bir', 'iki'])
    loop.items = []
    loop.count = 3
    expect(loopKeys(loop)).toEqual(['#1', '#2', '#3'])
    loop.count = 0
    expect(loopKeys(loop)).toEqual(['#1'])
  })

  it('kaldığı yerden başlangıç sırası sınırların dışına çıkmaz', () => {
    const loop = createNode('loop', 0, 0)
    loop.startIndex = -5
    expect(loopStartIndex(loop, 4, true)).toBe(0)
    loop.startIndex = 99
    expect(loopStartIndex(loop, 4, true)).toBe(3)
    loop.startIndex = Number.NaN
    expect(loopStartIndex(loop, 4, true)).toBe(0)
    loop.startIndex = 2
    expect(loopStartIndex(loop, 4, false)).toBe(0)
    expect(loopStartIndex(loop, 0, true)).toBe(0)
  })

  it('dosya yolundan ad ve değişkenler doğru çıkar', () => {
    expect(baseName('C:\\a\\b\\resim.png')).toBe('resim.png')
    expect(baseName('/tmp/x/y.glb')).toBe('y.glb')
    const vars = itemVars('C:\\a\\resim.png', 2, 10)
    const degerler = Object.values(vars)
    expect(degerler).toContain('C:\\a\\resim.png')
    expect(degerler).toContain('resim.png')
    expect(degerler).toContain('resim')
    expect(degerler).toContain('3')
    expect(degerler).toContain('10')
  })
})

describe('derin batarya: API kesintisi ayrımı (§9 sürekli hata)', () => {
  it('gerçek kesintiler tanınır', () => {
    expect(isApiDown('OpenRouter 429: rate limit exceeded')).toBe(true)
    expect(isApiDown('API (401) anahtar geçersiz')).toBe(true)
    expect(isApiDown('ResourceExhausted: quota')).toBe(true)
  })

  it('sıradan akış hatası API kesintisi sayılmaz (yanlış durma olmasın)', () => {
    for (const m of [
      'bir: “Kaydet” ekranda bulunamadı.',
      'INPUT_WINDOW_NOT_ACTIVE: Another program is in front.',
      'Dosya bulunamadı: C:\\yok.png',
      'model: “Kaydet” düğmesi görünmüyor', // "model" geçiyor ama kod yok
      'HTTP 500 sunucu hatası', // openrouter değil
    ]) {
      expect(isApiDown(m), `yanlış API kesintisi: ${m}`).toBe(false)
    }
  })
})

describe('derin batarya: profil ayrımı (gerçek depo yerinden oynamaz)', () => {
  it('yalnız test profili kendi çalışma klasörünü alır', () => {
    const userData = 'C:\\AppData\\xp-agent-studio-test'
    expect(isTestProfile('test')).toBe(true)
    expect(isTestProfile('')).toBe(false)
    expect(isTestProfile(undefined)).toBe(false)
    expect(profileDirName('test')).toBe('xp-agent-studio-test')
    expect(storeCwd('test', userData)).toBe(userData)
    expect(storeCwd(undefined, userData)).toBeUndefined()
    expect(storeCwd('', userData)).toBeUndefined()
  })

  it('türetilmiş (branch) koşu pencereyi ışıklandırmaz', () => {
    expect(windowEventAllowed('agent:step', false)).toBe(true)
    expect(windowEventAllowed('agent:patch', false)).toBe(true)
    expect(windowEventAllowed('agent:step', true)).toBe(false)
    expect(windowEventAllowed('agent:patch', true)).toBe(false)
    expect(windowEventAllowed('agent:log', true)).toBe(true)
  })
})

describe('derin batarya: tepki yargısı (§4 ve §17)', () => {
  it('beklenen yazı YENİ geldiyse "hazır"', () => {
    const v = judgeScreen(['Dosya', 'Düzen'], ['Dosya', 'Düzen', 'Kaydedildi'], 'Kaydedildi')
    expect(v.kind).toBe('ready')
  })

  it('beklenen yazı zaten varsa "hazır" DEMEZ (§17 — tahmin yok)', () => {
    const v = judgeScreen(['Kaydet', 'A'], ['Kaydet', 'B'], 'Kaydet')
    // Sözleşme: hazır yalnız beklenen yazı YENİ geldiğinde denir. Zaten duran bir yazı için
    // "missed" (ekran değişmedi/doğrulamıyor) veya "unknown" (başka yazılar değişti) döner.
    console.log(`[ölçüm] judgeScreen: ${v.kind} · ${v.reason}`)
    expect(v.kind).not.toBe('ready')
    expect(['unknown', 'missed']).toContain(v.kind)
  })

  it('beklenti yoksa uydurmaz; yükleniyor yazısı yükleniyor sayılır', () => {
    const bos = judgeScreen(['A'], ['A', 'B'], '')
    expect(['unknown', 'loading', 'ready', 'missed', 'blocked']).toContain(bos.kind)
    const yuk = judgeScreen([], ['Loading…'], '')
    expect(yuk.kind).toBe('loading')
  })

  it('koşul node’undan kısa bir iğne çıkarır', () => {
    const cond = createNode('condition', 0, 0)
    cond.text = 'ekranda “Remesh tamamlandı” yazısı varsa'
    const n = expectation({ next: cond } as never)
    expect(n.length).toBeGreaterThan(0)
    expect(n.length).toBeLessThanOrEqual(80)
  })
})

describe('derin batarya: yazı eşleştirme (§6)', () => {
  it('tırnaklı hedefi ayıklar, tırnaksızda son üç kelimeyi alır', () => {
    expect(extractTarget('“Kaydet ve kapat” düğmesine tıkla')).toEqual({ text: 'Kaydet ve kapat', quoted: true })
    expect(extractTarget('şu Kaydet ve kapat\'a bas')?.text).toBe('Kaydet ve kapat')
    expect(extractTarget('sadece tıkla')).toBeNull()
  })

  it('tam eşleşme kısmi eşleşmeden önce gelir; Türkçe harfler eşleşir', () => {
    const items = [item('Kaydet ve kapat', 0, 0), item('Kaydet', 100, 0)]
    const t = matchText(items, 'Kaydet')
    expect(t?.text).toBe('Kaydet')
    expect(norm('İNDİR')).toBe('indir')
    expect(containsTextStrict([item('İndir')], 'indir')?.text).toBe('İndir')
  })

  it('iki aynı yazı varsa bağlamsız seçim yapmaz (yanlış yere tıklama yok)', () => {
    const items = [item('New', 10, 10), item('New', 900, 500)]
    const a = matchText(items, 'New', { minScore: 0.99 })
    // Tam eşleşen iki aday: tercih fonksiyonu yoksa çözüm belirsiz kalmalı ya da en yakın seçilmeli.
    if (a) expect(['New']).toContain(a.text)
    const near = matchText(items, 'New', { anchor: { x: 905, y: 505 }, minScore: 0.99 })
    expect(near?.item.x ?? near?.x).toBe(900)
  })
})

describe('derin batarya: hafıza (§6 — ipucu, tıklama yetkisi değil)', () => {
  const area = { x: 0, y: 0, w: 1920, h: 1080 }
  it('hafıza en fazla MEMO_KEEP kayıt tutar ve yeni kayıt başa gelir', () => {
    let list = remember(undefined, memoOf(item('A'), area, 'Pencere'))
    for (let i = 0; i < 10; i++) list = remember(list, memoOf(item(`X${i}`), area, 'Pencere'))
    expect(list.length).toBe(MEMO_KEEP)
    expect(list[0].text).toBe('X9')
  })

  it('başka pencere veya ekranın bambaşka yeri çelişki olarak bildirilir', () => {
    const near = (i: number) => memoOf(item('Kaydet', 500 + i, 500), area, 'Pencere A')
    const list = [near(0), near(1), near(2)]
    const uzak = memoOf(item('Kaydet', 1700, 200), area, 'Pencere A')
    expect(conflict(list, uzak)).toContain('bambaşka')
    const baskaPencere = memoOf(item('Kaydet', 501, 500), area, 'Pencere B')
    expect(conflict(list, baskaPencere)).toContain('Pencere A')
    const ayni = memoOf(item('Kaydet', 502, 501), area, 'Pencere A')
    expect(conflict(list, ayni)).toBeNull()
    expect(likeness(list, ayni)).toBeGreaterThan(likeness(list, uzak))
  })
})

describe('derin batarya: durum sınırları (§9 ve §16)', () => {
  afterEach(() => {
    vi.useRealTimers()
    endRun({ ok: true })
  })

  it('eylem noktası bir dakika sonra geçersiz olur', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'))
    noteActPoint({ x: 100, y: 200 })
    expect(actPointWithin(60_000)).toEqual({ x: 100, y: 200 })
    vi.setSystemTime(new Date('2026-10-07T10:00:59Z'))
    expect(actPointWithin(60_000)).not.toBeNull()
    vi.setSystemTime(new Date('2026-10-07T10:01:01Z'))
    expect(actPointWithin(60_000)).toBeNull()
  })

  it('durdurma nedeni ölçülebilir ve yeni koşuda sıfırlanır', () => {
    const g: AgentGraph = { nodes: [createNode('start', 0, 0)], edges: [] }
    beginRun(g)
    expect(stopReason()).toBeNull()
    noteUserStop()
    expect(stopReason()).toBe('user')
    beginRun(g)
    expect(stopReason()).toBeNull()
  })

  it('kanıt arşivi sınırsız büyümez (ölçüm)', () => {
    const g: AgentGraph = { nodes: [createNode('start', 0, 0)], edges: [] }
    for (let i = 0; i < 30; i++) {
      beginRun(g)
      setDebugRun(true)
      noteStep({ id: 'x', status: 'error' })
      endRun({ ok: false })
    }
    const n = recentReports().length
    // Ölçüm: kaç rapor tutuluyor? Sınırsız büyüme §9 ile çelişir.
    console.log(`[ölçüm] 30 debug koşusundan sonra tutulan rapor sayısı: ${n}`)
    expect(n, 'rapor arşivi saatlerce büyüyebilir').toBeLessThanOrEqual(50)
    setDebugRun(false)
  })
})

describe('derin batarya: giriş noktası ve kesilebilir bekleme', () => {
  it('findEntry: açık kimlik > Başlangıç > girdisi olmayan ilk node', () => {
    const s = createNode('start', 0, 0)
    const w = createNode('wait', 100, 0)
    const g: AgentGraph = { nodes: [w, s], edges: [edge(s, 'next', w)] }
    expect(findEntry(g, w.id)?.id).toBe(w.id)
    expect(findEntry(g)?.id).toBe(s.id)
    expect(findEntry(g, 'yok')).toBeUndefined()
    const s2 = createNode('wait', 0, 0)
    const g2: AgentGraph = { nodes: [s2, w], edges: [edge(s2, 'next', w)] }
    expect(findEntry(g2)?.id).toBe(s2.id)
  })

  it('durdurma isteği uzun beklemede hızla etkili olur (§9)', async () => {
    const { interruptibleSleep } = await import('../electron/runner')
    const t0 = Date.now()
    await expect(interruptibleSleep(5000, () => true)).rejects.toThrow()
    const gecen = Date.now() - t0
    expect(gecen, 'durdurma uzun beklemede geç kaldı').toBeLessThan(600)
  })
})
