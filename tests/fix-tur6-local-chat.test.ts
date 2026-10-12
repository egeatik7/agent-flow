// Tur 6: Yerel Model sekmesindeki sohbet kutusu ve "yerel mi API mi" ayrımı.
// (a) directChat yerel tabana gider, (b) allowLocal:false yerel satırı reddeder,
// (c) hata yanıtı açık hata üretir, (d) VRAM çözümlemesi saf fonksiyonlarda sınanır.
import { act, createElement } from 'react'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS, cleanBackups } from '../electron/graph-types'
import { directChat, formatVram, parseNvidiaSmi, parseOllamaPs, setLocalEndpoint, setStopCheck } from '../electron/openrouter'
import LocalChat from '../src/components/LocalChat'
import LocalModelSettings from '../src/components/LocalModelSettings'

let mounted: ReactTestRenderer | undefined
afterEach(() => {
  if (mounted) act(() => mounted!.unmount())
  mounted = undefined
  setLocalEndpoint('')
  setStopCheck(() => false)
  vi.unstubAllGlobals()
})

const cevap = (content: string) => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }) })

/** JSX metni ayrı çocuklara böler; ekrandaki gerçek metni birleştirip okumak için. */
const duz = (p: any): string => typeof p === 'string' ? p : Array.isArray(p) ? p.map(duz).join('') : p?.children ? duz(p.children) : ''

describe('directChat', () => {
  it('yerel satırı yerel tabana gönderir, gövdede model adı öneksiz gider ve local:true döner', async () => {
    setLocalEndpoint('http://127.0.0.1:11434/v1', 30_000)
    const fetch = vi.fn(async (url: string, init: any) => {
      expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions')
      const body = JSON.parse(init.body)
      expect(body.model).toBe('qwen2.5:7b')
      expect(body.messages).toEqual([{ role: 'user', content: 'Merhaba' }])
      expect(init.headers.Authorization).toBeUndefined()
      return cevap('Merhaba, buradayım.')
    })
    vi.stubGlobal('fetch', fetch)
    const r = await directChat({ apiKey: 'gizli-bulut-anahtari', model: 'local:qwen2.5:7b', prompt: 'Merhaba', allowLocal: true })
    expect(r.local).toBe(true)
    expect(r.model).toBe('qwen2.5:7b')
    expect(r.text).toBe('Merhaba, buradayım.')
    expect(Number.isFinite(r.ms)).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('allowLocal:false iken local: modeli reddedilir ve hiç istek atılmaz', async () => {
    setLocalEndpoint('http://127.0.0.1:11434/v1', 30_000)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(directChat({ apiKey: 'k', model: 'local:qwen2.5:7b', prompt: 'selam', allowLocal: false })).rejects.toThrow(/Yerel model kapalı/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('boş mesajı ve boş yanıtı açıkça bildirir', async () => {
    setLocalEndpoint('http://127.0.0.1:11434/v1', 30_000)
    await expect(directChat({ apiKey: '', model: 'local:qwen', prompt: '   ', allowLocal: true })).rejects.toThrow('Mesaj boş.')
    vi.stubGlobal('fetch', vi.fn(async () => cevap('')))
    await expect(directChat({ apiKey: '', model: 'local:qwen', prompt: 'selam', allowLocal: true })).rejects.toThrow('boş yanıt')
  })

  it('hata yanıtını hangi taraf olduğunu söyleyerek iletir', async () => {
    setLocalEndpoint('http://127.0.0.1:8080/v1', 30_000)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => 'sunucu içi hata' })))
    await expect(directChat({ apiKey: '', model: 'local:llama', prompt: 'selam', allowLocal: true })).rejects.toThrow(/Yerel sunucu 500/)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, text: async () => 'invalid request' })))
    await expect(directChat({ apiKey: 'bulut', model: 'google/gemini-3.8-flash', prompt: 'selam', allowLocal: false })).rejects.toThrow(/OpenRouter 400/)
  })

  it('yerel adres kapalıyken doğrudan sohbet de mevcut ret davranışını korur', async () => {
    setLocalEndpoint('http://127.0.0.1:11434/v1', 30_000, false, true)
    await expect(directChat({ apiKey: 'k', model: 'local:qwen', prompt: 'selam', allowLocal: true })).rejects.toThrow(/Yerel model kapalı/)
  })
})

describe('VRAM çözümlemesi (uydurma yok)', () => {
  it('nvidia-smi çıktısını 5.0/12.0 GB biçimine çevirir', () => {
    expect(parseNvidiaSmi('5120, 12288')).toBe('5.0/12.0 GB')
    expect(parseNvidiaSmi('  5120 , 12288 \r\n1024, 12288')).toBe('5.0/12.0 GB')
    expect(formatVram(5120, 12288)).toBe('5.0/12.0 GB')
  })
  it('çıktı yoksa ya da okunamıyorsa boş döner', () => {
    expect(parseNvidiaSmi('')).toBe('')
    expect(parseNvidiaSmi('\n\n')).toBe('')
    expect(parseNvidiaSmi('nvidia-smi: command not found')).toBe('')
    expect(parseNvidiaSmi('N/A, N/A')).toBe('')
    expect(parseNvidiaSmi('5120')).toBe('')
    // Toplam bilinmiyorsa/sıfırsa oran yazılmaz; yarım okuma rapor edilmez.
    expect(parseNvidiaSmi('0, 0')).toBe('')
    expect(parseNvidiaSmi('12, 0')).toBe('')
    expect(formatVram(undefined, 12288)).toBe('')
    expect(formatVram('', 12288)).toBe('')
    expect(formatVram(5120, undefined)).toBe('')
    expect(formatVram(5120, '')).toBe('')
    expect(formatVram(-1, 12288)).toBe('')
  })
  it('geçerli sıfır okuması saklanmaz: boş GPU "0.0/12.0 GB" yazar', () => {
    expect(formatVram(0, 12288)).toBe('0.0/12.0 GB')
    expect(parseNvidiaSmi('0, 12288')).toBe('0.0/12.0 GB')
  })
  it('Ollama /api/ps yanıtından yüklü modellerin VRAM toplamını okur', () => {
    expect(parseOllamaPs({ models: [{ size_vram: 5 * 1024 ** 3 }] })).toBe('5.0 GB')
    expect(parseOllamaPs({ models: [{ size_vram: 2.5 * 1024 ** 3 }, { size_vram: 2.5 * 1024 ** 3 }] })).toBe('5.0 GB')
    expect(parseOllamaPs({ models: [] })).toBe('')
    expect(parseOllamaPs({})).toBe('')
    expect(parseOllamaPs(null)).toBe('')
  })
})

describe('LocalChat sohbet kutusu', () => {
  const ayarlar = { ...DEFAULT_SETTINGS, localBaseUrl: 'http://127.0.0.1:11434/v1' }
  // Beklenen uzunluk elle yazılmaz; cevabın kendi metninden türetilir.
  const CEVAP = 'Merhaba, buradayım!'
  const yanit = (patch: Record<string, unknown>) => ({ ok: true, reply: CEVAP, target: 'local', model: 'qwen2.5:7b', ms: 1240, gpu: '5.1/12.0 GB', ...patch })

  const kur = (localChat: any, models = [{ id: 'local:qwen2.5:7b', vision: false }]) => {
    vi.stubGlobal('window', { xpAgent: { localChat } })
    act(() => { mounted = create(createElement(LocalChat, { settings: ayarlar as any, models })) })
  }
  const yaz = (metin: string) => {
    const alan = mounted!.root.findByType('textarea')
    act(() => alan.props.onChange({ target: { value: metin } }))
    return mounted!.root.findAllByType('button').find((b) => b.children.join('') === 'Gönder')!
  }

  it('cevabın kaynağını, süreyi ve VRAM bilgisini gösterir', async () => {
    const istekler: any[] = []
    kur(vi.fn(async (p: any) => { istekler.push(p); return yanit({}) }))
    const gonder = yaz('Merhaba')
    await act(async () => { await gonder.props.onClick() })
    const json = JSON.stringify(mounted!.toJSON())
    expect(istekler[0]).toEqual({ prompt: 'Merhaba', target: 'local', model: 'local:qwen2.5:7b' })
    expect(json).toContain(CEVAP)
    expect(json).toContain('Yerel · qwen2.5:7b · 1.2 sn · VRAM 5.1/12.0 GB')
    expect(json).toContain('Son turlar')
    expect(duz(mounted!.toJSON())).toContain(`Yerel · qwen2.5:7b · 1.2 sn · ${CEVAP.length} karakter · VRAM 5.1/12.0 GB`)
  })

  it('gönderim sürerken düğme "Gönderiliyor…" yazar', async () => {
    let coz!: (v: any) => void
    const bekleyen = new Promise((r) => { coz = r })
    kur(vi.fn(() => bekleyen))
    const gonder = yaz('Merhaba')
    await act(async () => { void gonder.props.onClick(); await Promise.resolve() })
    expect(mounted!.root.findAllByType('button').map((b) => b.children.join('')).join('|')).toContain('Gönderiliyor…')
    await act(async () => { coz(yanit({})); await Promise.resolve() })
    expect(mounted!.root.findAllByType('button').map((b) => b.children.join('')).join('|')).toContain('Gönder')
  })

  it('OpenRouter seçilince API etiketi ve API model listesi kullanılır', async () => {
    const istekler: any[] = []
    kur(vi.fn(async (p: any) => { istekler.push(p); return yanit({ target: 'api', model: 'google/gemini-3.8-flash', ms: 800, gpu: '' }) }),
      [{ id: 'local:qwen2.5:7b', vision: false }, { id: 'google/gemini-3.8-flash', vision: true }])
    const secim = mounted!.root.findAllByType('select').find((s) => s.props.id === 'local-chat-target')!
    act(() => secim.props.onChange({ target: { value: 'api' } }))
    const modelSecim = mounted!.root.findAllByType('select').find((s) => s.props.id === 'local-chat-model')!
    expect(modelSecim.props.value).toBe('google/gemini-3.8-flash')
    const gonder = yaz('Merhaba')
    await act(async () => { await gonder.props.onClick() })
    expect(istekler[0]).toEqual({ prompt: 'Merhaba', target: 'api', model: 'google/gemini-3.8-flash' })
    const json = JSON.stringify(mounted!.toJSON())
    expect(json).toContain('API · google/gemini-3.8-flash · 0.8 sn')
    expect(json).not.toContain('VRAM')
  })

  it('hata gelirse sessiz kalmaz, uyarı satırı gösterir', async () => {
    kur(vi.fn(async () => ({ ok: false, reply: '', target: 'local', model: '', ms: 5, gpu: '', error: 'Yerel sunucu adresi kayıtlı değil; Yerel Model sekmesinden kur.' })))
    const gonder = yaz('Merhaba')
    await act(async () => { await gonder.props.onClick() })
    const uyari = mounted!.root.findAll((x) => x.props.role === 'alert')
    expect(uyari).toHaveLength(1)
    expect(duz(uyari[0].props.children)).toContain('Yerel sunucu adresi kayıtlı değil')
    expect(duz(mounted!.toJSON())).toContain('Cevap alınamadı')
  })

  it('masaüstü köprüsü yoksa açık hata verir', async () => {
    vi.stubGlobal('window', {})
    act(() => { mounted = create(createElement(LocalChat, { settings: ayarlar as any, models: [] })) })
    const gonder = yaz('Merhaba')
    await act(async () => { await gonder.props.onClick() })
    // Hata sessiz kalmaz: işlenmiş ağaçta uyarı satırı ve cevap balonu görünür olmalı.
    const uyari = mounted!.root.findAll((x) => x.props.role === 'alert')
    expect(uyari).toHaveLength(1)
    expect(duz(uyari[0].props.children)).toContain('yalnız masaüstü uygulamasında çalışır')
    expect(duz(mounted!.toJSON())).toContain('Cevap alınamadı')
  })

  it('Yerel Model sekmesinin altına gömülüdür', () => {
    act(() => { mounted = create(createElement(LocalModelSettings, { settings: ayarlar as any, setSettings: () => {}, onSave: () => {}, models: [] })) })
    expect(mounted!.root.findAllByType(LocalChat)).toHaveLength(1)
    expect(JSON.stringify(mounted!.toJSON())).toContain('Sohbet (canlı deneme)')
  })
})

// main.ts Electron'a bağlı olduğu için VM'e yüklenmez; koşul zinciri normalizasyonunun
// ayar yolunda gerçekten bağlandığı kaynak üzerinden ölçülür.
describe('conditionBackups normalizasyonu', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.ts'), 'utf8').replace(/\r\n/g, '\n')
  it('ayarları topluca normalizerken koşul zincirini de taşır', () => {
    expect(kaynak).toContain('s.conditionBackups = cleanBackups(s.conditionBackups)')
    expect(kaynak).toContain("s.conditionModel = String(s.conditionModel ?? '').trim()")
  })
  it('settings:save yolunda birincil modeli yedeklerden düşer', () => {
    expect(kaynak).toContain('next.conditionBackups = cleanBackups(next.conditionBackups).filter((name) => name !== next.conditionModel.trim())')
  })
  it('cleanBackups boş/tekrarlı/bozuk satırları eler', () => {
    expect(cleanBackups([' a ', '', 'a', 5, 'b'])).toEqual(['a', 'b'])
    expect(cleanBackups(undefined)).toEqual([])
  })
})
