// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BaglamKarti } from '../electron/hud-context'
import type { BaglamOlcumu } from '../electron/local-context'
import type { BellekKarti } from '../electron/memory-meter'

/**
 * 1.9.129 — MASAÜSTÜ KARTI. İstenen görünür sonuç: kartta "Yüklü bağlam: 32.768 token". Ölçüm
 * main'den NESNE olarak gelir (günlük metni ayrıştırılmaz). Mevcut kronometre (geri sayım) ve aşama
 * şeridi KORUNUR ve bağlam bloğu kendi grid satırında durduğu için hiçbir satırın üstüne binmez.
 */
type Handler = (payload: unknown) => void
const kanal: Record<string, Handler> = {}
const kayitli: string[] = []

vi.mock('../src/assets/nubbo.png', () => ({ default: 'nubbo.png' }))
vi.mock('../src/assets/nubbo-still.png', () => ({ default: 'nubbo-still.png' }))

const kartFixture = (): BaglamKarti => ({
  model: 'qwen3.5-64k:latest', sunucu: '127.0.0.1:11434',
  yukluToken: 32768, azamiToken: 262144, yapilandirilmisToken: 65536, istekNumCtx: null,
  kaynak: 'yuklu', yukluMetin: 'Yüklü bağlam: 32.768 token', durum: 'taze', rozet: '3,2 dk önce ölçüldü',
  bilinmiyor: false, eski: false, cevapSonrasi: false, olcumAt: Date.now(), olcumYasi: '3,2 dk önce ölçüldü',
  girisToken: 8123, tahminiToken: 7400,
  satirlar: ['Yüklü bağlam: 32.768 token', 'Azami kapasite: 262.144 (desteklenen sınır)', 'Yapılandırılmış pencere: 65.536', 'Gönderilen num_ctx: gönderilmiyor', 'Giriş: 8.123 token (ölçüm) · tahmini 7.400 token (TAHMİN)'],
})

function register(ad: string) {
  return (cb: Handler) => { kanal[ad] = cb; kayitli.push(ad); return () => { delete kanal[ad] } }
}

beforeEach(() => {
  for (const k of Object.keys(kanal)) delete kanal[k]
  ;(window as unknown as { xpAgent: unknown }).xpAgent = {
    onHud: register('hud:status'), onHudLoop: register('hud:loop'), onHudMethod: register('hud:method'),
    onHudCountdown: register('hud:countdown'), onHudStages: register('hud:stages'), onHudContext: register('hud:context'),
    onHudMemory: register('hud:memory'),
    onRecoveryStatus: register('recovery:status'),
  }
})
afterEach(() => { delete (window as unknown as { xpAgent?: unknown }).xpAgent; vi.restoreAllMocks() })

const text = (n: ReactTestInstance): string => n.children.map(c => (typeof c === 'string' ? c : text(c))).join('')

let mounted: ReactTestRenderer | undefined
async function mount() {
  const Hud = (await import('../src/components/Hud')).default
  act(() => { mounted = create(createElement(Hud)) })
  return mounted!
}
afterEach(() => { if (mounted) act(() => mounted!.unmount()); mounted = undefined })

describe('masaüstü kartı bağlam ölçümünü gösterir', () => {
  it('bağlam nesnesi gelince "Yüklü bağlam: 32.768 token" ve ayrıntılar görünür', async () => {
    const t = await mount()
    act(() => kanal['hud:context']({ kart: kartFixture() }))
    const shown = text(t.root)
    expect(shown).toContain('Yüklü bağlam: 32.768 token')
    // Ayrıntı: azami kapasite, yapılandırılmış pencere, gönderilen num_ctx ve ölçüm zamanı.
    expect(shown).toContain('Azami 262.144')
    expect(shown).toContain('Yapılandırılmış 65.536')
    expect(shown).toContain('Gönderilen num_ctx yok')
    expect(shown).toContain('3,2 dk önce ölçüldü')
    const blok = t.root.findByProps({ 'aria-label': 'Yüklü bağlam ölçümü' })
    expect(blok).toBeDefined()
  })

  it('gerçek giriş tokenı ile TAHMİN ayrı yazılır', async () => {
    const t = await mount()
    act(() => kanal['hud:context']({ kart: kartFixture() }))
    const shown = text(t.root)
    expect(shown).toContain('Giriş 8.123 (ölçüm)')
    expect(shown).toContain('tahmini 7.400 (TAHMİN)')
  })

  it('ölçüm yoksa "bilinmiyor", eskiyse "eski ölçüm" yazar', async () => {
    const t = await mount()
    act(() => kanal['hud:context']({ kart: { ...kartFixture(), yukluMetin: 'Yüklü bağlam: bilinmiyor', yukluToken: null, bilinmiyor: true, durum: 'yok', rozet: 'ölçülemedi · kırpma iddiası yok', kaynak: 'bilinmiyor', eski: true, olcumYasi: 'ölçüm zamanı bilinmiyor' } }))
    let shown = text(t.root)
    expect(shown).toContain('Yüklü bağlam: bilinmiyor')
    expect(shown).toContain('kırpma iddiası yok') // ölçüm yokken kırpma/aşım iddiası üretilmez
    // eski ölçüm görsel olarak ayrılır (taze gibi okunmasın).
    expect(t.root.findByProps({ 'aria-label': 'Yüklü bağlam ölçümü' }).props.className).toContain('eski')

    act(() => kanal['hud:context']({ kart: { ...kartFixture(), eski: true, durum: 'eski', rozet: 'eski ölçüm' } }))
    shown = text(t.root)
    expect(shown).toContain('eski ölçüm')
  })

  it('ölçüm temizlenince (kart:null) blok kaybolur', async () => {
    const t = await mount()
    act(() => kanal['hud:context']({ kart: kartFixture() }))
    expect(t.root.findAllByProps({ 'aria-label': 'Yüklü bağlam ölçümü' })).toHaveLength(1)
    act(() => kanal['hud:context']({ kart: null }))
    expect(t.root.findAllByProps({ 'aria-label': 'Yüklü bağlam ölçümü' })).toHaveLength(0)
  })
})

describe('mevcut kronometre ve aşama şeridi korunur', () => {
  it('geri sayım ve aşama şeridi bağlam bloğuyla BİRLİKTE görünür', async () => {
    const t = await mount()
    act(() => {
      kanal['hud:countdown']({ text: 'Model cevabı bekleniyor · qwen3.5-64k:latest · 1,4 sn' })
      kanal['hud:stages']({ text: 'OCR + liste · 147 aday 1,2 sn · Model · qwen3.5-64k:latest 3,1 sn' })
      kanal['hud:method']({ text: 'Tıkla · Tıkla 1' })
      kanal['hud:loop']({ text: 'Modeller · 3/12' })
      kanal['hud:context']({ kart: kartFixture() })
    })
    const shown = text(t.root)
    expect(shown).toContain('Model cevabı bekleniyor · qwen3.5-64k:latest · 1,4 sn')
    expect(shown).toContain('OCR + liste · 147 aday 1,2 sn · Model · qwen3.5-64k:latest 3,1 sn')
    expect(shown).toContain('Tıkla · Tıkla 1')
    expect(shown).toContain('Modeller · 3/12')
    expect(shown).toContain('Yüklü bağlam: 32.768 token')
  })
})

describe('kart taşmaz (sabit HUD penceresi)', () => {
// jsdom ortamında `new URL(..., import.meta.url)` file şeması vermez; yol doğrudan kurulur.
const css = readFileSync(join(process.cwd(), 'src', 'styles', 'xp.css'), 'utf8')
  /**
   * Seçicinin KENDİ kuralını bulur. Desen satır başına sabitlenir: `.hud` deseni
   * `html.hud-root{…}` kuralının İÇİNDE eşleşmemelidir (bir kez eşleşti ve test yanlış kuralı
   * denetledi).
   */
  const kural = (secici: string): string => {
    const m = css.match(new RegExp(`(?:^|\\n)${secici.replace(/[.[\]()*+?^$|\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))
    if (!m) throw Error(`CSS kuralı bulunamadı: ${secici}`)
    return m[1]
  }
  it('bağlam bloğu KENDİ grid satırında ve yüksekliği sabittir (komşu satıra binmez)', () => {
    const blok = kural('.hud-baglam')
    expect(blok).toMatch(/grid-row:\s*4/)
    expect(blok).toMatch(/height:\s*42px/)
    expect(blok).toMatch(/max-height:\s*42px/)
    // İçerik taşarsa kaydırılır: bilgi kaybolmaz, komşu satıra binmez.
    expect(blok).toMatch(/overflow-y:\s*auto/)
  })
  it('bellek bloğu KENDİ grid satırında ve sınırlı yüksekliktedir (kart taşmaz)', () => {
    const blok = kural('.hud-bellek')
    expect(blok).toMatch(/grid-row:\s*3/)
    expect(blok).toMatch(/height:\s*46px/)
    expect(blok).toMatch(/max-height:\s*46px/)
    expect(blok).toMatch(/overflow-y:\s*auto/)
  })
  it('HUD ızgarası kart + yöntem + bellek + bağlam + döngü olmak üzere beş satır tanımlar', () => {
    const hud = kural('.hud')
    // Kural gövdesinde açıklama satırları da var: sıra değil, VARLIK aranır.
    expect(hud).toContain('grid-template-rows: minmax(0, 1fr) 26px 46px 42px 26px')
    // Kart satırı 1fr kaldığı için pencere yüksekliği DEĞİŞMEZ; metin kırpılmaz, kaydırılır.
    expect(kural('.hud-text')).toMatch(/overflow-y:\s*auto/)
    expect(kural('.hud-text')).not.toMatch(/-webkit-line-clamp/)
    // Ölçülen kusur (1.9.130): içerik kutusu + iç boşluk kök kutuyu pencereden uzun yapıyordu ve
    // en alttaki satır kırpılıyordu. Kenarlık kutusu şarttır.
    expect(hud).toMatch(/box-sizing:\s*border-box/)
  })
  it('yöntem ve döngü satırları bellek/bağlam satırlarına göre kaydırılır', () => {
    expect(kural('.hud-loop')).toMatch(/grid-row:\s*5/)
    expect(kural('.hud-method')).toMatch(/grid-row:\s*2/)
  })
})

// ---------------------------------------------------------------------------
// 1.9.130 — CANLI BELLEK GÖSTERGESİ (masaüstü kartı)
// ---------------------------------------------------------------------------

const bellekFixture = (over: Partial<BellekKarti> = {}): BellekKarti => ({
  ramVram: 'RAM 12,1 / 15,8 GB · VRAM 9,2 / 12,0 GB',
  butce: 'Bellek bütçesi 43,0 / 50,0 GB · kalan 7,0 GB',
  gpuSatirlari: ['NVIDIA GeForce RTX 3060 (GPU 0) VRAM 9,2 / 12,0 GB'],
  surecSatirlari: ['Blender · 3 süreç · commit 4,2 GB · working set 5,1 GB', 'Yerel model çalıştırıcıları · 2 süreç · commit 6,0 GB · working set 7,0 GB'],
  aciklamalar: ['RAM: fiziksel bellek.', 'Bellek bütçesi: Windows’un RAM ve sayfa dosyasıyla karşılayabildiği bellek.'],
  daraliyor: false, uyari: '', olcumVar: true, eski: false, yas: 'az önce ölçüldü', hata: '',
  satirlar: ['RAM 12,1 / 15,8 GB · VRAM 9,2 / 12,0 GB', 'Bellek bütçesi 43,0 / 50,0 GB · kalan 7,0 GB'],
  ...over,
})

describe('masaüstü kartı canlı bellek göstergesini gösterir', () => {
  it('kısa bölüm iki satır olarak görünür: RAM/VRAM ve bellek bütçesi', async () => {
    const t = await mount()
    act(() => kanal['hud:memory']({ kart: bellekFixture() }))
    const shown = text(t.root)
    expect(shown).toContain('RAM 12,1 / 15,8 GB · VRAM 9,2 / 12,0 GB')
    expect(shown).toContain('Bellek bütçesi 43,0 / 50,0 GB · kalan 7,0 GB')
    expect(t.root.findAllByProps({ 'aria-label': 'Canlı bellek ölçümü' })).toHaveLength(1)
  })

  it('Blender ve yerel model çalıştırıcı ayrıntıları görünür ve commit fiziksel RAM DENMEZ', async () => {
    const t = await mount()
    act(() => kanal['hud:memory']({ kart: bellekFixture() }))
    const shown = text(t.root)
    expect(shown).toContain('Blender · 3 süreç · commit 4,2 GB · working set 5,1 GB')
    expect(shown).toContain('Yerel model çalıştırıcıları · 2 süreç · commit 6,0 GB · working set 7,0 GB')
    expect(shown).toContain('RAM: fiziksel bellek.')
    expect(shown).toContain('sayfa dosyasıyla karşılayabildiği bellek')
    expect(shown).not.toContain('Blender RAM')
  })

  it('commit doluluğu %90+ ise "Bellek bütçesi daralıyor" uyarısı ve görsel ayrım çıkar', async () => {
    const t = await mount()
    act(() => kanal['hud:memory']({ kart: bellekFixture({ daraliyor: true, uyari: 'Bellek bütçesi daralıyor' }) }))
    expect(text(t.root)).toContain('Bellek bütçesi daralıyor')
    expect(t.root.findByProps({ 'aria-label': 'Canlı bellek ölçümü' }).props.className).toContain('daraliyor')
  })

  it('uyarı eşiği aşılmadıysa uyarı YOK', async () => {
    const t = await mount()
    act(() => kanal['hud:memory']({ kart: bellekFixture() }))
    expect(text(t.root)).not.toContain('Bellek bütçesi daralıyor')
  })

  it('eski ölçüm/ölçüm hatası taze gibi gösterilmez', async () => {
    const t = await mount()
    act(() => kanal['hud:memory']({ kart: bellekFixture({ eski: true, yas: '42 sn önce ölçüldü', hata: 'PowerShell çıktısı yok (12 sn önce denendi)' }) }))
    const shown = text(t.root)
    expect(shown).toContain('42 sn önce ölçüldü')
    expect(shown).toContain('eski ölçüm')
    expect(shown).toContain('PowerShell çıktısı yok')
    expect(t.root.findByProps({ 'aria-label': 'Canlı bellek ölçümü' }).props.className).toContain('eski')
  })

  it('ölçüm temizlenince blok kaybolur', async () => {
    const t = await mount()
    act(() => kanal['hud:memory']({ kart: bellekFixture() }))
    expect(t.root.findAllByProps({ 'aria-label': 'Canlı bellek ölçümü' })).toHaveLength(1)
    act(() => kanal['hud:memory']({ kart: null }))
    expect(t.root.findAllByProps({ 'aria-label': 'Canlı bellek ölçümü' })).toHaveLength(0)
  })

  it('mevcut bağlam göstergesi, kronometre, aşama şeridi ve döngü satırı KORUNUR', async () => {
    const t = await mount()
    act(() => {
      kanal['hud:countdown']({ text: 'Model cevabı bekleniyor · qwen3.5-64k:latest · 1,4 sn' })
      kanal['hud:stages']({ text: 'OCR + liste · 147 aday 1,2 sn · Model · qwen3.5-64k:latest 3,1 sn' })
      kanal['hud:method']({ text: 'Tıkla · Tıkla 1' })
      kanal['hud:loop']({ text: 'Modeller · 3/12' })
      kanal['hud:context']({ kart: kartFixture() })
      kanal['hud:memory']({ kart: bellekFixture() })
    })
    const shown = text(t.root)
    for (const beklenen of [
      'Model cevabı bekleniyor · qwen3.5-64k:latest · 1,4 sn',
      'OCR + liste · 147 aday 1,2 sn · Model · qwen3.5-64k:latest 3,1 sn',
      'Tıkla · Tıkla 1',
      'Modeller · 3/12',
      'Yüklü bağlam: 32.768 token',
      'RAM 12,1 / 15,8 GB · VRAM 9,2 / 12,0 GB',
    ]) expect(shown).toContain(beklenen)
  })
})
