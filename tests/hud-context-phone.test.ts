// @vitest-environment jsdom
import { createElement } from 'react'
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ViewerState } from '../electron/viewer-state'
import { applyViewerMessage } from '../src/viewer/model'
import type { BaglamKarti } from '../electron/hud-context'
import type { BaglamOlcumu } from '../electron/local-context'
import type { BellekKarti } from '../electron/memory-meter'

/**
 * 1.9.129 — ANDROID İZLEYİCİ. Masaüstü kartındaki AYNI yapılandırılmış veri (bağlam ölçümü NESNESİ,
 * aşama şeridi, geri sayım) telefona aktarılır. Telefon metni uydurmaz: ölçüm yoksa "bilinmiyor",
 * eskiyse "eski ölçüm"; yapılandırılmış pencere "yüklü" diye gösterilmez.
 */
const h = vi.hoisted(() => ({ state: null as unknown, connected: true, error: '' }))
vi.mock('../src/viewer/useViewer', () => ({ useViewer: () => h }))
vi.mock('../src/components/NodeCanvas', () => ({ default: () => null }))
vi.mock('../src/components/NodeNavigator', () => ({ default: () => null }))
vi.mock('../src/components/NubboMascot', () => ({ default: () => null }))
vi.mock('../src/components/RecoveryNote', () => ({ default: () => null }))
import ViewerApp from '../src/viewer/ViewerApp'
import ViewerHudScreen from '../src/viewer/ViewerHudScreen'

let mounted: ReactTestRenderer | undefined
const original = Object.getOwnPropertyDescriptor(navigator, 'userAgent')
const text = (n: ReactTestInstance): string => n.children.map(c => (typeof c === 'string' ? c : text(c))).join('')

function mountPhone(state: ViewerState): void {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Android NubboDevice/phone' })
  h.state = state.snapshot(); h.connected = true; h.error = ''
  act(() => { mounted = create(createElement(ViewerApp)) })
}
afterEach(() => {
  if (mounted) act(() => mounted!.unmount())
  mounted = undefined
  if (original) Object.defineProperty(navigator, 'userAgent', original)
  else delete (navigator as unknown as { userAgent?: string }).userAgent
})

const olcum: BaglamOlcumu = { azamiKapasite: 262144, yapilandirilmisPencere: 65536, calisanPencere: 32768, olcumAt: Date.now() - 120_000, statikAt: Date.now() - 120_000, girisToken: 8123 }

describe('telefon kartı masaüstüyle aynı yapılandırılmış veriyi gösterir', () => {
  it('kart nesnesi iletildiğinde "Yüklü bağlam: 32.768 token" ve ayrıntılar görünür', () => {
    const state = new ViewerState('test')
    state.event('hud:status', { level: 'info', text: 'PC bilgi kartı' })
    state.event('hud:countdown', { text: 'kalan 3,2 / 5,0 sn' })
    state.event('hud:stages', { text: 'OCR + liste · 147 aday 1,2 sn · Model · qwen3.5-64k:latest 3,1 sn' })
    // Masaüstünün yaydığı NESNENİN AYNISI (günlük metni değil).
    state.event('hud:context', { kart: { model: 'qwen3.5-64k:latest', sunucu: '127.0.0.1:11434', yukluToken: 32768, azamiToken: 262144, yapilandirilmisToken: 65536, istekNumCtx: null, kaynak: 'yuklu', yukluMetin: 'Yüklü bağlam: 32.768 token', durum: 'taze', rozet: '2,0 dk önce ölçüldü', bilinmiyor: false, eski: false, cevapSonrasi: false, olcumAt: olcum.olcumAt, olcumYasi: '2,0 dk önce ölçüldü', girisToken: 8123, tahminiToken: 7400, satirlar: ['Yüklü bağlam: 32.768 token', 'Azami kapasite: 262.144 (desteklenen sınır)', 'Yapılandırılmış pencere: 65.536', 'Gönderilen num_ctx: gönderilmiyor', 'Giriş: 8.123 token (ölçüm) · tahmini 7.400 token (TAHMİN)'] } satisfies BaglamKarti })
    mountPhone(state)
    expect(mounted!.root.findByType(ViewerHudScreen).props.phoneOnly).toBe(true)
    const shown = text(mounted!.root)
    expect(shown).toContain('Yüklü bağlam: 32.768 token')
    expect(shown).toContain('Azami kapasite: 262.144')
    expect(shown).toContain('Yapılandırılmış pencere: 65.536')
    expect(shown).toContain('Gönderilen num_ctx: gönderilmiyor')
    expect(shown).toContain('2,0 dk önce ölçüldü')
  })

  it('mevcut kronometre ve aşama şeridi telefonda da korunur', () => {
    const state = new ViewerState('test')
    state.event('hud:countdown', { text: 'kalan 3,2 / 5,0 sn' })
    state.event('hud:stages', { text: 'OCR + liste · 147 aday 1,2 sn' })
    mountPhone(state)
    const shown = text(mounted!.root)
    expect(shown).toContain('kalan 3,2 / 5,0 sn')
    expect(shown).toContain('OCR + liste · 147 aday 1,2 sn')
  })

  it('ölçüm temizlenince telefon kartından da kaybolur', () => {
    const state = new ViewerState('test')
    state.event('hud:context', { kart: { yukluMetin: 'Yüklü bağlam: 32.768 token', satirlar: ['Yüklü bağlam: 32.768 token'], eski: false, bilinmiyor: false } satisfies Partial<BaglamKarti> })
    mountPhone(state)
    expect(text(mounted!.root)).toContain('32.768')
    state.event('hud:context', { kart: null }); h.state = state.snapshot()
    act(() => mounted!.update(createElement(ViewerApp)))
    expect(text(mounted!.root)).not.toContain('32.768')
  })
  it('telefon kartında masaüstü dışı arayüz görünmez (kart-only kuralı korunur)', () => {
    const state = new ViewerState('test')
    state.event('hud:context', { kart: { yukluMetin: 'Yüklü bağlam: bilinmiyor', satirlar: ['Yüklü bağlam: bilinmiyor'], eski: true, bilinmiyor: true } satisfies Partial<BaglamKarti> })
    mountPhone(state)
    const shown = text(mounted!.root)
    expect(shown).toContain('Yüklü bağlam: bilinmiyor')
    for (const value of ['Tuvaller', 'Arşiv', 'Aktif node’a kilitle', 'Kapat']) expect(shown).not.toContain(value)
    expect(mounted!.root.findAllByType('button')).toHaveLength(0)
  })
})

describe('izleyici indirgeyicisi bağlam nesnesini AYNEN taşır', () => {
  it('mesaj dizisi masaüstü nesnesini telefona aktarır; bozuk yük kartı bozmaz', () => {
    const state = applyViewerMessage(null, { type: 'snapshot', state: new ViewerState('test').snapshot() })
    // Masaüstünün yaydığı tel AYNI dizidir (WebSocket): nesne olduğu gibi taşınır.
    const mesajlar = [
      { channel: 'hud:context', payload: { kart: { yukluMetin: 'Yüklü bağlam: 32.768 token', yukluToken: 32768, azamiToken: 262144, yapilandirilmisToken: 65536, istekNumCtx: null, eski: false, bilinmiyor: false, satirlar: ['Yüklü bağlam: 32.768 token'] } } },
      // Bozuk yük (nesne değil): kart KORUNUR, temizlenmez.
      { channel: 'hud:context', payload: { kart: 'bozuk' } },
    ]
    let seq = state.seq
    let son = state
    for (const m of mesajlar) {
      seq += 1
      son = applyViewerMessage(son, { type: 'event', session: son.session, seq, at: Date.now(), channel: m.channel, payload: m.payload })
    }
    // Bozuk yük ATLANIR (kart korunur); ardından gelen null temizler.
    expect(son.hud?.baglam?.yukluMetin).toBe('Yüklü bağlam: 32.768 token')
    expect(son.hud?.baglam?.azamiToken).toBe(262144)

    seq += 1
    const temiz = applyViewerMessage(son, { type: 'event', session: son.session, seq, at: Date.now(), channel: 'hud:context', payload: { kart: null } })
    expect(temiz.hud?.baglam).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 1.9.130 — CANLI BELLEK GÖSTERGESİ (Android/telefon kartı)
// ---------------------------------------------------------------------------

const bellekFixture = (over: Partial<BellekKarti> = {}): BellekKarti => ({
  ramVram: 'RAM 12,1 / 15,8 GB · VRAM 9,2 / 12,0 GB',
  butce: 'Bellek bütçesi 43,0 / 50,0 GB · kalan 7,0 GB',
  gpuSatirlari: ['NVIDIA GeForce RTX 3060 (GPU 0) VRAM 9,2 / 12,0 GB', 'NVIDIA GeForce GTX 1050 (GPU 1) VRAM 1,2 / 4,0 GB'],
  surecSatirlari: ['Blender · 3 süreç · commit 4,2 GB · working set 5,1 GB', 'Yerel model çalıştırıcıları · 2 süreç · commit 6,0 GB · working set 7,0 GB'],
  aciklamalar: ['RAM: fiziksel bellek.', 'Bellek bütçesi: Windows’un RAM ve sayfa dosyasıyla karşılayabildiği bellek.'],
  daraliyor: false, uyari: '', olcumVar: true, eski: false, yas: 'az önce ölçüldü', hata: '',
  satirlar: ['RAM 12,1 / 15,8 GB · VRAM 9,2 / 12,0 GB', 'Bellek bütçesi 43,0 / 50,0 GB · kalan 7,0 GB'],
  ...over,
})

describe('telefon kartı canlı bellek göstergesini gösterir', () => {
  it('masaüstünün yaydığı NESNE telefondan okunur: kısa bölüm + GPU/süreç ayrıntıları', () => {
    const state = new ViewerState('test')
    state.event('hud:status', { level: 'info', text: 'PC bilgi kartı' })
    state.event('hud:memory', { kart: bellekFixture() })
    mountPhone(state)
    const shown = text(mounted!.root)
    expect(shown).toContain('RAM 12,1 / 15,8 GB · VRAM 9,2 / 12,0 GB')
    expect(shown).toContain('Bellek bütçesi 43,0 / 50,0 GB · kalan 7,0 GB')
    // Çoklu GPU ayrı satırlarda: iki kart birleştirilip tek toplam gibi gösterilmez.
    expect(shown).toContain('GPU 0')
    expect(shown).toContain('GPU 1')
    expect(shown).toContain('Blender · 3 süreç')
    expect(shown).toContain('Yerel model çalıştırıcıları · 2 süreç')
    expect(mounted!.root.findAllByProps({ 'aria-label': 'Canlı bellek ölçümü' })).toHaveLength(1)
  })

  it('daralma uyarısı ve eski ölçüm telefonda da ayrılır', () => {
    const state = new ViewerState('test')
    state.event('hud:memory', { kart: bellekFixture({ daraliyor: true, uyari: 'Bellek bütçesi daralıyor', eski: true, yas: '31 sn önce ölçüldü' }) })
    mountPhone(state)
    const shown = text(mounted!.root)
    expect(shown).toContain('Bellek bütçesi daralıyor')
    expect(shown).toContain('31 sn önce ölçüldü')
    expect(mounted!.root.findByProps({ 'aria-label': 'Canlı bellek ölçümü' }).props.className).toContain('daraliyor')
    expect(mounted!.root.findByProps({ 'aria-label': 'Canlı bellek ölçümü' }).props.className).toContain('eski')
  })

  it('ölçüm temizlenince telefon kartından da kaybolur', () => {
    const state = new ViewerState('test')
    state.event('hud:memory', { kart: bellekFixture() })
    mountPhone(state)
    expect(text(mounted!.root)).toContain('RAM 12,1')
    state.event('hud:memory', { kart: null }); h.state = state.snapshot()
    act(() => mounted!.update(createElement(ViewerApp)))
    expect(text(mounted!.root)).not.toContain('RAM 12,1')
  })

  it('bellek bloğu telefonun kart-only kuralını bozmaz (düğme yok)', () => {
    const state = new ViewerState('test')
    state.event('hud:memory', { kart: bellekFixture() })
    mountPhone(state)
    expect(mounted!.root.findAllByType('button')).toHaveLength(0)
  })
})

describe('izleyici indirgeyicisi bellek nesnesini AYNEN taşır', () => {
  it('masaüstü nesnesi telefona aktarılır; bozuk yük kartı bozmaz, null temizler', () => {
    const state = applyViewerMessage(null, { type: 'snapshot', state: new ViewerState('test').snapshot() })
    let seq = state.seq
    let son = applyViewerMessage(state, { type: 'event', session: state.session, seq: ++seq, at: Date.now(), channel: 'hud:memory', payload: { kart: bellekFixture() } })
    expect(son.hud?.bellek?.butce).toBe('Bellek bütçesi 43,0 / 50,0 GB · kalan 7,0 GB')
    expect(son.hud?.bellek?.gpuSatirlari).toHaveLength(2)
    // Bozuk yük ATLANIR.
    son = applyViewerMessage(son, { type: 'event', session: son.session, seq: ++seq, at: Date.now(), channel: 'hud:memory', payload: { kart: 'bozuk' } })
    expect(son.hud?.bellek?.ramVram).toBe('RAM 12,1 / 15,8 GB · VRAM 9,2 / 12,0 GB')
    // Günlük METNİ ayrıştırılmaz: metin kanalı karta karışmaz.
    son = applyViewerMessage(son, { type: 'event', session: son.session, seq: ++seq, at: Date.now(), channel: 'agent:log', payload: { level: 'info', message: 'RAM 99,9 / 99,9 GB' } })
    expect(son.hud?.bellek?.ramVram).toBe('RAM 12,1 / 15,8 GB · VRAM 9,2 / 12,0 GB')
    // null temizler.
    son = applyViewerMessage(son, { type: 'event', session: son.session, seq: ++seq, at: Date.now(), channel: 'hud:memory', payload: { kart: null } })
    expect(son.hud?.bellek).toBeUndefined()
  })
})
