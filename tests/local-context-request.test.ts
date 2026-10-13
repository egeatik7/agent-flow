import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { baglamOlcumLogSatiri, chooseScreenTarget, setBaglamLogger, setLocalEndpoint, setStopCheck, type BaglamOlayi } from '../electron/openrouter'
import { bekleyenOlcumleriBekle, bekleyenOlcumVar } from '../electron/local-context-probe'
import { baglamOnbelleginiTemizle } from '../electron/local-context'
import type { ScanResult } from '../electron/matcher'

/**
 * 1.9.129 — ÖLÇÜMÜN ÜRETİM İSTEĞİNE BAĞLANMASI. Kural: ölçüm, isteğin GERÇEKTEN gittiği sunucuya ve
 * istek kimliğine bağlanır; günlük satırı yüklü/yapılandırılmış/azami pencereyi, istek num_ctx'i ve
 * ölçüm zamanını AYRI alanlarda yazar; anahtar veya tam URL YAZILMAZ. Ölçüm isteği bekletmez.
 */
let server: Server | undefined
const olaylar: BaglamOlayi[] = []
const loglar: string[] = []
/** Modelin ilk istekte yüklendiğini taklit etmek için: /api/ps ÖNCE boş, SONRA yüklü döner. */
let psCagrisi = 0
let psPencere = 32768
let showGovdesi: Record<string, unknown> = {}

function sunucu(): Server {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Content-Type', 'application/json')
    const yol = String(req.url ?? '')
    if (yol === '/api/ps') {
      psCagrisi += 1
      // İlk sonda (istek sınırı): model henüz yüklü DEĞİL; üretim isteği modeli yeni yükleyecek.
      // Sonraki sonda (cevap sonrası): model artık YÜKLÜ — kart bunu görmeli.
      return void res.end(JSON.stringify({ models: psCagrisi === 1 ? [] : [{ name: 'qwen3.5-64k:latest', context_length: psPencere }] }))
    }
    if (yol === '/api/show') {
      let body = ''
      for await (const chunk of req) body += chunk
      return void res.end(JSON.stringify({ parameters: 'num_ctx 65536\n', model_info: { 'qwen35.context_length': 262144 }, ...showGovdesi }))
    }
    if (!yol.endsWith('/chat/completions')) { res.statusCode = 404; return void res.end('{}') }
    let body = ''
    for await (const chunk of req) body += chunk
    // Sunucu GERÇEK giriş tokenını bildirir (Ollama yerel alanı): ölçüm, tahmin değil.
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"id": 1, "text": "Kaydet"}' } }], prompt_eval_count: 8123 }))
  })
}

const scan = (): ScanResult => ({
  area: { x: 0, y: 0, w: 1280, h: 720 },
  items: [{ id: 1, text: 'Kaydet', type: 'Button', src: 'ocr', x: 10, y: 20, w: 60, h: 20 }],
  ocr: true, uiaCount: 0, ocrCount: 1,
  image: { data: 'fixture', w: 1280, h: 720, mime: 'image/png' },
  window: 'Blender',
})

afterEach(async () => {
  await bekleyenOlcumleriBekle()
  expect(bekleyenOlcumVar()).toBe(false) // test sonunda bekleyen ölçüm görevi KALMAZ
  setBaglamLogger(null); setLocalEndpoint(''); setStopCheck(() => false)
  baglamOnbelleginiTemizle(); baglamKartiniSifirla()
  if (server) { server.closeAllConnections(); await new Promise<void>(r => server!.close(() => r())); server = undefined }
})
function baglamKartiniSifirla() { olaylar.length = 0; loglar.length = 0; psCagrisi = 0; psPencere = 32768; showGovdesi = {} }

async function kosu(): Promise<void> {
  server = sunucu()
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  setLocalEndpoint(`http://127.0.0.1:${port}/v1`, 30_000, true)
  setBaglamLogger(o => { olaylar.push(o); loglar.push(String(baglamOlcumLogSatiriForTest(o))) })
  await chooseScreenTarget({
    apiKey: '', model: 'local:qwen3.5-64k:latest', prompt: 'Kaydet düğmesine tıkla', kind: 'click',
    scan: scan(), stepTitle: 'Tıkla 1', sendImage: false,
  })
  await bekleCevapOlcumu()
}

/**
 * Cevap SONRASI ölçüm isteği bekletmez (bilerek): üretim isteği ondan önce döner. Test, kart olayının
 * gerçekten yayıldığını görmek için bekleyen ölçüm işini sonuna kadar boşaltır.
 */
async function bekleCevapOlcumu(): Promise<void> {
  for (let tur = 0; tur < 50; tur++) {
    await bekleyenOlcumleriBekle()
    if (olaylar.some(o => o.asama === 'cevap')) return
    await new Promise<void>(r => setTimeout(r, 10))
  }
}

/** Test, gerçek günlük satırının üretimde de aynı olduğunu ölçer (chatLogger main'de bağlanır). */
function baglamOlcumLogSatiriForTest(o: BaglamOlayi): string {
  return baglamOlcumLogSatiri(o)
}

describe('1) ölçüm istek ve cevap sınırında NESNE olarak bildirilir', () => {
  it('istek ve cevap aşamaları ayrı olaylardır; ikisi de requestId ve gerçek model taşır', async () => {
    await kosu()
    const istek = olaylar.filter(o => o.asama === 'istek')
    const cevap = olaylar.filter(o => o.asama === 'cevap')
    expect(istek.length).toBeGreaterThanOrEqual(1)
    expect(cevap).toHaveLength(1)
    for (const o of [...istek, ...cevap]) {
      expect(o.model).toBe('qwen3.5-64k:latest') // "local:" ön eki değil, GERÇEK model
      expect(o.sunucu).toContain('127.0.0.1')
      expect(o.requestId).toBeTruthy()
    }
    // Ölçüm olayı GÜNLÜK METNİ değil, yapılandırılmış veridir.
    for (const o of [...istek, ...cevap]) expect(typeof o).toBe('object')
  })
})

describe('2) cevap sonrası ölçüm yenilenir (ilk istek modeli yüklemiş olabilir)', () => {
  it('cevap olayı yüklü pencereyi ve gerçek giriş tokenını taşır', async () => {
    await kosu()
    const cevap = olaylar.find(o => o.asama === 'cevap')!
    expect(cevap.olcum?.calisanPencere).toBe(32768) // ilk /api/ps boştu, cevaptan sonra YÜKLÜ geldi
    expect(cevap.olcum?.yapilandirilmisPencere).toBe(65536)
    expect(cevap.olcum?.azamiKapasite).toBe(262144)
    expect(cevap.girisToken).toBe(8123) // sunucunun bildirdiği GERÇEK giriş tokenı
    // Cevap sonrası tazelendiği damgalanır: bu kayıt önceki isteğin KESİN pencere kanıtı değildir.
    expect(cevap.olcum?.cevapAt).toBeGreaterThan(0)
    expect(cevap.olcum!.cevapAt!).toBeGreaterThanOrEqual(cevap.olcum!.olcumAt)
  })

  it('istek aşamasındaki olay ölçümü beklemez: istek anında yüklü pencere henüz boştur', async () => {
    await kosu()
    const istek = olaylar.find(o => o.asama === 'istek')!
    // İstek sınırında model yüklü değildi; kart "yüklü" diye bir şey UYDURMAZ.
    expect(istek.olcum?.calisanPencere).toBeUndefined()
    expect(istek.istekNumCtx).toBeUndefined() // istekte num_ctx GÖNDERİLMİYOR
    expect(istek.tahminiToken).toBeGreaterThan(0) // tahmin ayrı alandır
  })
})

describe('3) günlük satırı dört kavramı AYRI yazar, kimlik bilgisi sızdırmaz', () => {
  it('yüklü/yapılandırılmış/azami pencere, istek num_ctx ve ölçüm zamanı ayrı alanlardır', async () => {
    await kosu()
    const cevapLog = loglar[loglar.length - 1]
    expect(cevapLog).toContain('BAGLAM-OLCUM')
    expect(cevapLog).toContain('asama=cevap')
    expect(cevapLog).toContain('yuklu=32768')
    expect(cevapLog).toContain('azami=262144')
    expect(cevapLog).toContain('yapilandirilmis=65536')
    expect(cevapLog).toContain('istek-num_ctx=gonderilmiyor')
    expect(cevapLog).toContain('giris=8123 (olcum)')
    expect(cevapLog).toMatch(/tahmini=\d+ \(TAHMIN\)/)
    expect(cevapLog).toMatch(/olcum-zamani=\d{2}:\d{2}:\d{2}/)
    // Sunucu YALNIZ host olarak yazılır; anahtar/URL yolu ve sorgusu sızmaz.
    expect(cevapLog).toContain('sunucu=127.0.0.1:')
    expect(cevapLog).not.toContain('/chat/completions')
    expect(cevapLog).not.toContain('Authorization')
    expect(cevapLog).not.toContain('Bearer')
  })
})

describe('4) ölçüm başarısız olsa da üretim isteği çalışır', () => {  it('sonda uçları kapalıyken cevap yine alınır ve ölçüm "bilinmiyor" kalır', async () => {
    showGovdesi = {}
    server = createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json')
      // /api/ps ve /api/show YOK (404): ölçüm alınamaz, ama üretim isteği ETKİLENMEZ.
      if (!String(req.url).endsWith('/chat/completions')) { res.statusCode = 404; return void res.end('{}') }
      let body = ''
      for await (const chunk of req) body += chunk
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"id": 1, "text": "Kaydet"}' } }] }))
    })
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    setLocalEndpoint(`http://127.0.0.1:${port}/v1`, 30_000, true)
    setBaglamLogger(o => { olaylar.push(o) })
    const secim = await chooseScreenTarget({
      apiKey: '', model: 'local:qwen3.5-64k:latest', prompt: 'Kaydet düğmesine tıkla', kind: 'click',
      scan: scan(), stepTitle: 'Tıkla 1', sendImage: false,
    })
    expect(secim.id).toBe(1) // İSTEK BAŞARILI: ölçüm hatası akışı bozmadı
    const cevap = olaylar.find(o => o.asama === 'cevap')
    expect(cevap?.olcum?.calisanPencere).toBeUndefined()
    expect(cevap?.olcum?.yapilandirilmisPencere).toBeUndefined()
  })
})

describe('5) Durdur: iptal edilmiş isteğin ardından yeni ölçüm sorgusu başlatılmaz', () => {
  it('sinyal iptal edildiğinde cevap sonrası sonda hiç çalışmaz', async () => {
    server = sunucu()
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    setLocalEndpoint(`http://127.0.0.1:${port}/v1`, 30_000, true)
    setBaglamLogger(o => { olaylar.push(o) })
    const kontrol = new AbortController()
    kontrol.abort()
    // İstek zaten iptal: model çağrısı Durdur'u görür ve ölçüm yolu hiç kurulmaz.
    await expect(chooseScreenTarget({
      apiKey: '', model: 'local:qwen3.5-64k:latest', prompt: 'p', kind: 'click',
      scan: scan(), stepTitle: 'Tıkla 1', sendImage: false, signal: kontrol.signal,
    })).rejects.toThrow()
    await bekleCevapOlcumu()
    expect(psCagrisi).toBe(0)
    expect(olaylar.filter(o => o.asama === 'cevap')).toHaveLength(0)
    expect(bekleyenOlcumVar()).toBe(false)
  })
})
