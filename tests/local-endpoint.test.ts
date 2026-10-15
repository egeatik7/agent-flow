import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listLocalModels, setLocalEndpoint, setStopCheck, visionDescribe } from '../electron/openrouter'
import { bekleyenOlcumleriBekle, bekleyenOlcumVar } from '../electron/local-context-probe'

let server: Server | undefined

/**
 * Sahte sunucu YALNIZ üretim sohbet ucunu taklit eder; bağlam ölçüm sondası (`/api/ps`, `/api/show`)
 * AYRI yanıtlanır. Kural: sonda istekleri üretim isteğinin bekçisine (`expect(req.url)…`) ve gövde
 * ayrıştırıcısına UĞRAMAZ — sonda GET `/api/ps` gövdesiz geldiğinde `JSON.parse('')` "Unexpected end
 * of JSON input" fırlatıyordu ve bu, test sonrası yakalanmayan bir ret olarak görünüyordu. Eşleşmeyen
 * yol 404 alır; ölçüm böylece gerçek Ollama'da olmayan bir uçta olduğu gibi "bilinmiyor" kalır.
 */
function sahteSunucu(uretim: (body: string, req: IncomingMessage, res: ServerResponse) => void): Server {
  return createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const yol = String(req.url ?? '')
    if (yol === '/v1/models') return void res.end(JSON.stringify({ data: [{ id: 'local-vision' }] }))
    if (yol === '/api/ps') return void res.end(JSON.stringify({ models: [] }))
    if (yol === '/api/show') return void res.end(JSON.stringify({ parameters: '', model_info: {} }))
    // ÜRETİM ucu: taban adres "/ollama/v1" gibi bir yol taşıyabildiği için SONA göre eşleşir.
    if (!yol.endsWith('/chat/completions')) { res.statusCode = 404; return void res.end('{}') }
    let body = ''
    for await (const chunk of req) body += chunk
    uretim(body, req, res)
  })
}

afterEach(async () => {
  // Bekleyen ölçüm sorguları önce kapanır; kapanmış sokete yazma girişimi unhandled hata üretmesin.
  await bekleyenOlcumleriBekle()
  expect(bekleyenOlcumVar()).toBe(false)
  setLocalEndpoint(''); setStopCheck(() => false); vi.unstubAllGlobals(); vi.useRealTimers()
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined }
})
const image = { data: 'fixture', w: 100, h: 100, mime: 'image/png' }
describe('local OpenAI-compatible integration', () => {
  it('lists models and sends a real HTTP visual request locally without leaking the cloud key', async () => {
    let received: any, headers: any
    server = sahteSunucu((body, req, res) => {
      received = JSON.parse(body); headers = req.headers
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"text":"Blender açık"}' } }] }))
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as any).port}`
    expect(await listLocalModels(base)).toEqual([{ id: 'local-vision', vision: false }])
    setLocalEndpoint(base, 30_000, true)
    expect(await visionDescribe({ apiKey: 'private-cloud-key', model: 'local:local-vision', image })).toBe('Blender açık')
    expect(received.model).toBe('local-vision')
    expect(received.messages.some((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'image_url'))).toBe(true)
    expect(headers.authorization).toBeUndefined()
  })
  it('skips a disabled local row and keeps the cloud fallback', async () => {
    setLocalEndpoint('http://127.0.0.1:8080/v1', undefined, false, true)
    const fetch = vi.fn(async (url, init) => {
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
      expect(JSON.parse(init.body).model).toBe('cloud/vision')
      expect(init.headers.Authorization).toBe('Bearer cloud-key')
      return { ok: true, status: 200, text: async () => '{"choices":[{"message":{"content":"{\\"text\\":\\"cloud\\"}"}}]}' }
    })
    vi.stubGlobal('fetch', fetch)
    const answered = vi.fn()
    expect(await visionDescribe({ apiKey: 'cloud-key', model: ['local:vision', 'cloud/vision'], image, onAnsweredModel: answered })).toBe('cloud')
    expect(answered).toHaveBeenCalledWith('cloud/vision')
    expect(fetch.mock.calls.filter(([u]) => String(u).includes('/chat/completions'))).toHaveLength(1) // ÜRETİM isteği tek; tanılama sorguları (/api/ps, /api/show) ayrı sayılır
  })
  it('does not wait forever when only a disabled local row or a missing cloud key is configured', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const result = visionDescribe({ apiKey: '', model: ['local:vision', 'cloud/vision'], image }).catch(e => e.message)
    await vi.advanceTimersByTimeAsync(40_000)
    expect(await result).toContain('anahtarı yok')
    expect(fetch.mock.calls.filter(([u]) => String(u).includes('/chat/completions'))).toHaveLength(0) // hiç ÜRETİM isteği yok (tanılama sorguları olabilir)
  })
  it('reports a malformed models response instead of treating it as an empty success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"error":"wrong route"}' })))
    await expect(listLocalModels('http://127.0.0.1:8080')).rejects.toThrow('geçerli bir model listesi')
  })
  it('rejects a malformed address before making a network request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    await expect(listLocalModels('127.0.0.1:8080')).rejects.toThrow('adres')
    expect(fetch.mock.calls.filter(([u]) => String(u).includes('/chat/completions'))).toHaveLength(0) // hiç ÜRETİM isteği yok (tanılama sorguları olabilir)
  })
  it('Ollama adresinde düşünmeyi kapatır, başka yerel sunucuda gövdeyi değiştirmez', async () => {
    const bodies: any[] = []
    server = sahteSunucu((body, _req, res) => {
      bodies.push(JSON.parse(body))
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"text":"tamam"}' } }] }))
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as any).port
    // Ollama adresi: düşünme kapatılır (11 Ekim 2026 ölçümü, 10 sn -> 0,15 sn).
    setLocalEndpoint(`http://127.0.0.1:${port}/ollama/v1`, 30_000, true)
    await visionDescribe({ apiKey: '', model: 'local:qwen3.5-8k', image })
    expect(bodies[0].reasoning_effort).toBe('none')
    // Başka yerel sunucu: alan gönderilmez, istek gövdesi eskisi gibi kalır.
    setLocalEndpoint(`http://127.0.0.1:${port}/v1`, 30_000, true)
    await visionDescribe({ apiKey: '', model: 'local:qwen3.5-8k', image })
    expect('reasoning_effort' in bodies[1]).toBe(false)
    // Kullanıcı Yerel Model sekmesinden açıkça seçtiyse seçim gönderilir (Ollama olmayan adreste bile).
    setLocalEndpoint(`http://127.0.0.1:${port}/v1`, 30_000, true, false, 'high')
    await visionDescribe({ apiKey: '', model: 'local:qwen3.5-8k', image })
    expect(bodies[2].reasoning_effort).toBe('high')
    // Geçersiz seviye "otomatik" sayılır; Ollama olmayan adrese alan gönderilmez.
    setLocalEndpoint(`http://127.0.0.1:${port}/v1`, 30_000, true, false, 'yanlis')
    await visionDescribe({ apiKey: '', model: 'local:qwen3.5-8k', image })
    expect('reasoning_effort' in bodies[3]).toBe(false)
  })
})
