import { describe, expect, it, vi } from 'vitest'
import { commandNeedle, matchFuzzy, matchPrompt, matchText, type ScanResult, type ScreenItem } from '../electron/matcher'
import { expectation, judgeScreen } from '../electron/confirm'
import { describeWordCandidates, wordCandidates, WORD_CANDIDATE_LIMIT, WORD_TEXT_LIMIT, type WordCandidate } from '../electron/word-targets'
import { createNode, DEFAULT_SETTINGS, normalizeCanvasBook, normalizeGraph, type AppSettings } from '../electron/graph-types'

// agent.ts'i koşabilmek için yalnız DIŞARI bakan uçlar taklit edilir (ekran taraması ve model).
// Ölçülen: eşit iki aday varken hedef çözme akışı gerçekten modele soruyor mu, modelsizken eski
// deterministik davranış korunuyor mu?
const h = vi.hoisted(() => ({
  anahtar: '',
  yerel: false,
  modelCalls: 0,
  scan: null as unknown,
}))

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), getName: () => 'nubbo-test', getVersion: () => '0.0.0' },
  screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }) },
  ipcMain: { handle: () => {} },
}))

vi.mock('../electron/a11y-bridge', () => ({
  scan: vi.fn(async () => h.scan),
  discardShot: vi.fn(),
  windowRect: vi.fn(async () => null),
  locate: vi.fn(async () => null),
  findImage: vi.fn(async () => null),
  inputState: vi.fn(async () => null),
  sendKeys: vi.fn(async () => ({ ok: true })),
  click: vi.fn(async () => ({ ok: true })),
  typeText: vi.fn(async () => ({ ok: true })),
  readValue: vi.fn(async () => null),
  focusWindow: vi.fn(async () => null),
  setValueRamp: vi.fn(),
}))

vi.mock('../electron/openrouter', () => ({
  chooseScreenTarget: vi.fn(async () => {
    h.modelCalls++
    return { id: null, reason: 'fikstür: liste dışı' }
  }),
  chooseVisualTarget: vi.fn(async () => null),
  isTarsModel: () => false,
  judgeReaction: vi.fn(async () => ({ verdict: 'unknown', reason: '' })),
  chooseTypeField: vi.fn(async () => null),
  planStall: vi.fn(async () => null),
  visionDescribe: vi.fn(async () => ''),
  localConfigured: () => h.yerel,
}))

const it_ = (id: number, text: string, x = 0, y = 0, w = 60, h = 18): ScreenItem => ({ id, text, type: 'Text', src: 'ocr', x, y, w, h })

describe('tur3/1 — tam kelime eşleşmesi ve yükleme sırası (confirm.ts)', () => {
  it('üst-küme yazı "hazır" üretmez: İndirilenler ≠ İndir, Tamamlanıyor ≠ Tamam', () => {
    const a = judgeScreen(['Yer', 'A'], ['Yer', 'A', 'İndirilenler'], 'İndir')
    expect(a.kind).not.toBe('ready')
    const b = judgeScreen(['Yer', 'A'], ['Yer', 'A', 'Kaydetme'], 'Kaydet')
    expect(b.kind).not.toBe('ready')
    const c = judgeScreen(['Yer', 'A'], ['Yer', 'A', 'Tamamlanıyor'], 'Tamam')
    expect(c.kind).not.toBe('ready')
  })

  it('hedef yazı gerçekten geldiğinde "hazır" der (iğne üst-küme değil, tam yazı)', () => {
    expect(judgeScreen(['Dosya'], ['Dosya', 'İndir'], 'İndir').kind).toBe('ready')
    expect(judgeScreen(['Dosya'], ['Dosya', 'Kaydet'], 'kaydet').kind).toBe('ready')
  })

  it('yükleme sinyali "hazır"ı geçersiz kılar; kalıcı ilgisiz yazı ise hazırı ENGELLEMEZ', () => {
    // Bu karede YENİ çıkan yükleme yazısı: hazır değil.
    expect(judgeScreen(['A'], ['A', 'Tamamlanıyor'], 'Tamam').kind).toBe('loading')
    expect(judgeScreen(['A'], ['A', 'Lütfen bekleyin'], 'Kaydet').kind).toBe('loading')
    // Zaten duran ve beklenen iğneyi içermeyen ilgisiz yazı: hazır kararı yine verilir.
    expect(judgeScreen(['Bekleyin', 'A'], ['Bekleyin', 'A', 'Kaydedildi'], 'Kaydedildi').kind).toBe('ready')
  })

  it('iğne komutun tamamı değil hedef yazıdır; böylece "hazır" ulaşılabilir olur', () => {
    const click = createNode('click', 0, 0)
    click.prompt = 'Kaydet düğmesine tıkla'
    const n1 = expectation({ next: click } as never)
    expect(n1).toBe('Kaydet')
    expect(judgeScreen(['Dosya'], ['Dosya', 'Kaydet'], n1).kind).toBe('ready')
    // Tırnaklı ifade ve kesme işaretli ad da hedef yazıya indirgenir.
    click.prompt = '“Kaydet ve kapat” düğmesine tıkla'
    expect(expectation({ next: click } as never)).toBe('Kaydet ve kapat')
    click.prompt = "Opera'ya tıkla"
    expect(expectation({ next: click } as never)).toBe('Opera')
    // Kaydedilmiş locator metni komuttan önce gelir.
    click.prompt = 'şuradaki düğmeye tıkla'
    click.locator = { x: 10, y: 20, text: 'Kaydet', name: 'Kaydet' } as never
    expect(expectation({ next: click } as never)).toBe('Kaydet')
  })

  it('commandNeedle: tırnak → kesme işareti → anlamlı kelimeler → komutun kendisi', () => {
    expect(commandNeedle('“İndir” düğmesine tıkla')).toBe('İndir')
    expect(commandNeedle("Opera'ya tıkla")).toBe('Opera')
    expect(commandNeedle('Kaydet düğmesine tıkla')).toBe('Kaydet')
    expect(commandNeedle('')).toBe('')
  })
})

describe('tur3/2 — eşitlikte seçim kararı (matcher.ts)', () => {
  // Aynı yazıdan iki aday: bağlam yok. Eskiden ilk taranan öğe seçiliyordu ve modele sorulmuyordu.
  const iki = [it_(1, 'Kaydet', 10, 10), it_(2, 'Kaydet', 900, 500)]

  it("tie:'ask' eşitlikte seçim YAPMAZ (model yolu açık kalır)", () => {
    const notlar: string[] = []
    expect(matchText(iki, 'Kaydet', { tie: 'ask', note: (m) => notlar.push(m) })).toBeNull()
    expect(matchFuzzy(iki, 'Kaydet', { tie: 'ask', note: (m) => notlar.push(m) })).toBeNull()
    expect(matchPrompt(iki, 'Kaydet düğmesine tıkla', undefined, undefined, { tie: 'ask', note: (m) => notlar.push(m) })).toBeNull()
    expect(notlar.length).toBeGreaterThan(0)
    expect(notlar[0]).toContain('Aynı yazıdan birden fazla aday')
    expect(notlar[0]).toContain('modelden isteniyor')
  })

  it("model yokken (varsayılan 'first') eski deterministik davranış korunur", () => {
    const notlar: string[] = []
    expect(matchText(iki, 'Kaydet', { note: (m) => notlar.push(m) })?.item.id).toBe(1)
    expect(matchText(iki, 'Kaydet', { tie: 'first', note: (m) => notlar.push(m) })?.item.id).toBe(1)
    expect(matchPrompt(iki, 'Kaydet düğmesine tıkla')?.item.id).toBe(1)
    expect(notlar.some((m) => m.includes('ilk aday kullanıldı'))).toBe(true)
  })

  it('ayırt edici varsa (anchor/prefer) eşitlik belirsiz değildir', () => {
    expect(matchText(iki, 'Kaydet', { anchor: { x: 905, y: 505 }, tie: 'ask' })?.item.id).toBe(2)
    expect(matchText(iki, 'Kaydet', { anchor: { x: 15, y: 15 }, tie: 'ask' })?.item.id).toBe(1)
    const prefer = (i: ScreenItem) => (i.id === 2 ? 0.9 : 0.1)
    expect(matchText(iki, 'Kaydet', { prefer, tie: 'ask' })?.item.id).toBe(2)
  })

  it('tek aday varsa belirsizlik yoktur; bayrak eşleşmeyi bozmaz', () => {
    const tek = [it_(1, 'Kaydet', 10, 10)]
    expect(matchText(tek, 'Kaydet', { tie: 'ask' })?.item.id).toBe(1)
    expect(matchText(tek, 'Kaydet', { tie: 'first' })?.item.id).toBe(1)
  })

  it('UIA adı yolu (clickableBy) bu değişiklikten etkilenmez', async () => {
    const { clickableBy } = await import('../electron/target-match')
    const uia = [{ ...it_(1, 'Kaydet', 10, 10), type: 'Button', src: 'uia' as const }, { ...it_(2, 'Kaydet', 900, 500), type: 'Button', src: 'uia' as const }]
    expect(clickableBy(uia, 'Kaydet')).toBeUndefined()
    expect(clickableBy(uia, 'Kaydet', { x: 905, y: 505 })?.id).toBe(2)
  })
})

describe('tur3/3 — model aday listesi sınırı (word-targets.ts)', () => {
  const satir = (id: number, t: string, x: number, y: number): ScreenItem => ({ id, text: t, type: 'Text', src: 'ocr', x, y, w: 40, h: 20 })
  const tarama = (items: ScreenItem[]): ScanResult => ({ area: { x: 0, y: 0, w: 1000, h: 1000 }, items, ocr: true, uiaCount: 0, ocrCount: items.length, image: null, window: 'Fikstür' })

  it('sınır aşılırsa liste KIRPILIR ve günlüğe bir kez yazılır', () => {
    const items = Array.from({ length: WORD_CANDIDATE_LIMIT + 60 }, (_, i) => satir(i, `kelime${i}`, 400 + (i % 20), 400 + Math.floor(i / 20)))
    const scan = tarama(items)
    const adaylar = wordCandidates(scan)
    expect(adaylar.length).toBe(WORD_CANDIDATE_LIMIT + 60)
    const notlar: string[] = []
    const satirlar = describeWordCandidates(scan, adaylar, (m) => notlar.push(m)).split('\n')
    expect(satirlar.length).toBe(WORD_CANDIDATE_LIMIT)
    expect(notlar.length).toBe(1)
    expect(notlar[0]).toContain(`${WORD_CANDIDATE_LIMIT + 60} adaydan ${WORD_CANDIDATE_LIMIT}`)
    expect(notlar[0]).toContain('sınırlandı')
  })

  it('seçim deterministiktir: aynı tarama aynı satırları verir', () => {
    const items = Array.from({ length: WORD_CANDIDATE_LIMIT + 25 }, (_, i) => satir(i, `k${i}`, 100 + (i * 7) % 800, 100 + (i * 13) % 800))
    const scan = tarama(items)
    const a = describeWordCandidates(scan, wordCandidates(scan), () => {})
    const b = describeWordCandidates(scan, wordCandidates(scan), () => {})
    expect(a).toBe(b)
  })

  it('önce tıklanabilir adaylar, sonra merkeze yakınlık: uzak/context-only aday düşer', () => {
    const items = Array.from({ length: WORD_CANDIDATE_LIMIT }, (_, i) => satir(i, `merkez${i}`, 480, 480))
    const uzak = satir(9001, 'Köşedeki', 0, 0)
    const scan = tarama([...items, uzak])
    const adaylar = wordCandidates(scan)
    // Uzak köşedeki aday context-only olarak işaretlenir; sınırda ilk düşen odur.
    adaylar.find((c) => c.item.text === 'Köşedeki')!.contextOnly = true
    const satirlar = describeWordCandidates(scan, adaylar, () => {})
    expect(satirlar).not.toContain('Köşedeki')
    const ctx = { item: satir(9002, 'bağlam', 480, 480), parentId: 1, contextOnly: true } as WordCandidate
    const karisik = describeWordCandidates(scan, [ctx, ...adaylar.slice(0, WORD_CANDIDATE_LIMIT)], () => {})
    expect(karisik).not.toContain('bağlam')
  })

  it('satır başına yazı kırpılır; kimlik ve kutu bilgisi korunur', () => {
    const uzun = 'A'.repeat(WORD_TEXT_LIMIT + 50)
    const scan = tarama([satir(5, uzun, 100, 200)])
    const satirMetni = describeWordCandidates(scan, wordCandidates(scan), () => {})
    expect(satirMetni).toContain(`#5 Text "${'A'.repeat(WORD_TEXT_LIMIT)}" @100,200 40x20`)
    expect(satirMetni).not.toContain('A'.repeat(WORD_TEXT_LIMIT + 1))
  })

  it('kırpma olmayan eski davranış küçük listelerde aynen kalır (satır içeriği)', () => {
    const scan = tarama([{ id: 7, text: 'Run Remesh', type: 'Text', src: 'ocr', x: 100, y: 80, w: 280, h: 20, words: [{ t: 'Run', x: 100, y: 80, w: 40, h: 20 }, { t: 'Remesh', x: 300, y: 80, w: 80, h: 20 }] }])
    const metin = describeWordCandidates(scan, wordCandidates(scan), () => {})
    expect(metin).toContain('"Run" @100,80 40x20')
    expect(metin).toContain('"Remesh" @300,80 80x20')
    expect(metin).toContain('OCR-word parent=#7')
    expect(metin).toContain('center=')
  })

  it('gerçek dünya ölçüsü: 900 OCR kelimesi prompt\'a 400 satır olarak girer', () => {
    const items = Array.from({ length: 450 }, (_, i) => ({ ...satir(i, 'Run Remesh', 100, 80), words: [{ t: 'Run', x: 100, y: 80, w: 40, h: 20 }, { t: 'Remesh', x: 300, y: 80, w: 80, h: 20 }] }))
    const scan = tarama(items)
    const adaylar = wordCandidates(scan)
    expect(adaylar.length).toBe(900)
    const notlar: string[] = []
    const satirlar = describeWordCandidates(scan, adaylar, (m) => notlar.push(m)).split('\n')
    console.log(`[ölçüm] 900 adaydan ${satirlar.length} satır gönderiliyor; bilgi: ${notlar[0] ?? 'yok'}`)
    expect(satirlar.length).toBe(WORD_CANDIDATE_LIMIT)
    expect(notlar).toEqual([expect.stringContaining('900 adaydan 400')])
  })
})

describe('tur3/4 — eksik Başlangıç kimliği deterministik (graph-types.ts)', () => {
  const hamGraf = () => ({ nodes: [{ id: 'n1', kind: 'click', title: 'Tıkla 1', x: 400, y: 120, prompt: 'Kaydet' }], edges: [] })
  const startId = (g: { nodes: { kind: string; id: string }[] }) => g.nodes.find((n) => n.kind === 'start')?.id

  it('sekme + baseline + katalog kaydı AYNI Başlangıç kimliğini üretir', () => {
    const book = normalizeCanvasBook({
      activeId: 't1',
      tabs: [{ id: 't1', name: 'Tuval 1', graph: hamGraf(), baseline: { name: 'Temel', graph: hamGraf() } }],
      library: { schemaVersion: 2, canvases: [{ id: 'c1', name: 'Tuval 1', graph: hamGraf(), updatedAt: 0 }], automations: [] },
    })
    const kimlikler = [
      startId(book.tabs[0].graph),
      startId(book.tabs[0].baseline!.graph),
      startId(book.library!.canvases[0].graph),
    ]
    expect(kimlikler.filter(Boolean).length).toBe(3)
    expect(new Set(kimlikler).size).toBe(1)
    // Aynı ham grafiğin ikinci normalizasyonu da aynı kimliği verir (sapma yok).
    expect(startId(normalizeGraph(hamGraf()))).toBe(kimlikler[0])
  })

  it('Başlangıç zaten varsa kimliğine ve grafiğe DOKUNULMAZ', () => {
    const mevcut = { nodes: [{ id: 'elle-konmus-start', kind: 'start', title: 'Başlangıç', x: 20, y: 80 }], edges: [] }
    const g = normalizeGraph(mevcut)
    expect(g.nodes.length).toBe(1)
    expect(g.nodes[0].id).toBe('elle-konmus-start')
  })

  it('enjeksiyonun konum/kenar davranışı korunur; kimlik grafikte benzersiz kalır', () => {
    const g = normalizeGraph({ nodes: [{ ...hamGraf().nodes[0], id: 'start' }], edges: [] })
    const eklenen = g.nodes.find((n) => n.kind === 'start')!
    expect(eklenen.id).not.toBe('start')
    expect(new Set(g.nodes.map((n) => n.id)).size).toBe(g.nodes.length)
    expect(g.edges[0]).toMatchObject({ from: eklenen.id, to: 'start' })
  })
})

describe('tur3 — ölçüm özeti', () => {
  it('yazı yolu artık bağlama bakmadan ilk adayı seçmiyor', () => {
    const log = vi.fn()
    const iki = [it_(1, 'Kaydet', 10, 10), it_(2, 'Kaydet', 900, 500)]
    expect(matchText(iki, 'Kaydet', { tie: 'ask', note: log })).toBeNull()
    expect(log).toHaveBeenCalledTimes(1)
    console.log(`[ölçüm] eşitlik + model: seçim yok, not: ${log.mock.calls[0][0]}`)
  })
})

describe('tur3/2 — hedef çözme akışı (agent.ts) uçtan uca', () => {
  const ekran: ScanResult = {
    area: { x: 0, y: 0, w: 1920, h: 1080 },
    items: [it_(1, 'Kaydet', 10, 10), it_(2, 'Kaydet', 900, 500)],
    ocr: true, uiaCount: 0, ocrCount: 2, image: null, window: 'Fikstür',
  }
  const ayarlar = (): AppSettings => ({ ...DEFAULT_SETTINGS, apiKey: h.anahtar, findOrder: ['windows', 'list'], findOff: [], targetWindow: 'Fikstür' } as AppSettings)

  async function ajan(loglar: string[]) {
    const { createAgent } = await import('../electron/agent')
    return createAgent({ log: (_l, m) => loglar.push(m), send: () => {}, settings: ayarlar, shouldStop: () => false })
  }

  it('aynı yazıdan iki eşit aday + model var: ilk aday TIKLANMAZ, model çağrılır', async () => {
    h.scan = ekran
    h.anahtar = 'fikstur-anahtar'
    h.yerel = false
    h.modelCalls = 0
    const loglar: string[] = []
    const agent = await ajan(loglar)
    const node = { ...createNode('click', 0, 0), prompt: '“Kaydet” düğmesine tıkla' }
    await expect(agent.previewTarget(node)).rejects.toThrow(/bulunamadı/)
    expect(h.modelCalls).toBe(1)
    expect(loglar.some((m) => m.includes('Aynı yazıdan birden fazla aday var') && m.includes('modelden isteniyor'))).toBe(true)
    console.log(`[ölçüm] eşitlik + model: model çağrısı=${h.modelCalls}, seçim yapılmadı`)
  })

  it('model yok: eski deterministik davranış korunur (ilk aday), model ÇAĞRILMAZ', async () => {
    h.scan = ekran
    h.anahtar = ''
    h.yerel = false
    h.modelCalls = 0
    const loglar: string[] = []
    const agent = await ajan(loglar)
    const node = { ...createNode('click', 0, 0), prompt: '“Kaydet” düğmesine tıkla' }
    const hedef = await agent.previewTarget(node)
    expect(h.modelCalls).toBe(0)
    expect({ x: hedef.x, y: hedef.y }).toEqual({ x: 40, y: 19 })
    expect(loglar.some((m) => m.includes('model yok, ilk aday kullanıldı'))).toBe(true)
    console.log(`[ölçüm] eşitlik + modelsiz: model çağrısı=0, seçilen ilk aday @${hedef.x},${hedef.y}`)
  })

  it('anchor varsa model yolu hiç açılmaz: yakın aday seçilir', async () => {
    h.scan = ekran
    h.anahtar = 'fikstur-anahtar'
    h.yerel = false
    h.modelCalls = 0
    const loglar: string[] = []
    const agent = await ajan(loglar)
    const node = { ...createNode('click', 0, 0), prompt: '“Kaydet” düğmesine tıkla', anchor: { x: 905, y: 505 } }
    const hedef = await agent.previewTarget(node)
    expect({ x: hedef.x, y: hedef.y }).toEqual({ x: 930, y: 509 })
    expect(h.modelCalls).toBe(0)
  })
})
