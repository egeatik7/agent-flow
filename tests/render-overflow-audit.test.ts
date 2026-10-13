// @vitest-environment jsdom
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { BaglamKarti } from '../electron/hud-context'
import type { BellekKarti } from '../electron/memory-meter'
import { gbOran, gbYaz } from '../electron/memory-meter'

/**
 * 1.9.130 — KART TAŞMA DENETİMİ (GERÇEK TARAYICI DÜZENİ).
 *
 * Neden jsdom yetmez: jsdom satır yüksekliği, ızgara ve `scrollHeight` hesaplamaz; "kart taşmaz"
 * iddiası orada ÖLÇÜLEMEZ. Bu test gerçek bileşenleri (Hud.tsx ve ViewerHudScreen.tsx) gerçek CSS
 * ile render eder, HTML'i çıkarır ve GERÇEK Chrome'da (playwright-core + kurulu Chrome) ölçer.
 *
 * Masaüstü ölçüsü main'deki HUD_W/HUD_H ile AYNI olmalıdır (456×254); telefon 390×844.
 * Ölçüm şartı: hiçbir satır pencerenin dışında kalmaz, hiçbir ölçüm satırı kırpılmaz ve durum
 * kartı okunur yer korur.
 */
type Handler = (payload: unknown) => void
const kanal: Record<string, Handler> = {}
vi.mock('../src/assets/nubbo.png', () => ({ default: 'nubbo.png' }))
vi.mock('../src/assets/nubbo-still.png', () => ({ default: 'nubbo-still.png' }))

const GB = 1024 ** 3

/** Canlı Windows değerlerinden türetilmiş gerçekçi ölçüm: RAM 15,8 GB toplam, bütçe 36,7 GB sınır. */
const olcumFixture = {
  ramToplamBayt: 15.84 * GB, ramKullanilanBayt: 12.1 * GB,
  commitSinirBayt: 36.74 * GB, commitKullanilanBayt: 35.3 * GB, commitKalanBayt: 1.44 * GB,
}

const bellekFixture = (): BellekKarti => ({
  ramVram: `RAM ${gbOran(olcumFixture.ramKullanilanBayt, olcumFixture.ramToplamBayt)} · VRAM ${gbOran(9.2 * GB, 12 * GB)}`,
  butce: `Bellek bütçesi ${gbOran(olcumFixture.commitKullanilanBayt, olcumFixture.commitSinirBayt)} · kalan ${gbYaz(olcumFixture.commitKalanBayt)} GB`,
  gpuSatirlari: ['NVIDIA GeForce RTX 3060 (GPU 0) VRAM 9,2 / 12,0 GB', 'NVIDIA GeForce GTX 1050 (GPU 1) VRAM 1,2 / 4,0 GB'],
  surecSatirlari: [
    'Blender · 3 süreç · commit 4,2 GB · working set 5,1 GB',
    'Yerel model çalıştırıcıları · 2 süreç · commit 6,0 GB · working set 7,0 GB',
    'Tanınan diğer yerel çalıştırıcılar (ağaç dışı) · 1 süreç · commit bilinmiyor · working set bilinmiyor',
    'Bütçe doluluğu %96 (kaynak: Windows performans sayacı)',
  ],
  aciklamalar: [
    'RAM: fiziksel bellek.',
    'Bellek bütçesi: Windows’un RAM ve sayfa dosyasıyla karşılayabildiği bellek.',
    'Süreç commit’i (private bytes) fiziksel RAM kullanımı değildir; sayfa dosyasına taşınan sayfaları da içerir.',
    'Working set toplamı ortak (paylaşılan) sayfaları birden çok kez sayabilir; bu yüzden toplamlar yaklaşıktır.',
  ],
  daraliyor: true, uyari: 'Bellek bütçesi daralıyor', olcumVar: true, eski: false, yas: 'az önce ölçüldü', hata: '',
  satirlar: [],
})

const baglamFixture = (): BaglamKarti => ({
  model: 'qwen3.5-64k:latest', sunucu: '127.0.0.1:11434', yukluToken: 32768, azamiToken: 262144,
  yapilandirilmisToken: 65536, istekNumCtx: null, kaynak: 'yuklu', yukluMetin: 'Yüklü bağlam: 32.768 token',
  durum: 'taze', rozet: '3,2 dk önce ölçüldü', bilinmiyor: false, eski: false, cevapSonrasi: false,
  olcumAt: Date.now(), olcumYasi: '3,2 dk önce ölçüldü', girisToken: 8123, tahminiToken: 7400,
  satirlar: ['Yüklü bağlam: 32.768 token', 'Azami kapasite: 262.144 (desteklenen sınır)', 'Yapılandırılmış pencere: 65.536', 'Gönderilen num_ctx: gönderilmiyor', 'Giriş: 8.123 token (ölçüm) · tahmini 7.400 token (TAHMİN)'],
})

function register(ad: string) {
  return (cb: Handler) => { kanal[ad] = cb; return () => { delete kanal[ad] } }
}
;(window as unknown as { xpAgent: unknown }).xpAgent = {
  onHud: register('hud:status'), onHudLoop: register('hud:loop'), onHudMethod: register('hud:method'),
  onHudCountdown: register('hud:countdown'), onHudStages: register('hud:stages'),
  onHudContext: register('hud:context'), onHudMemory: register('hud:memory'),
  onRecoveryStatus: register('recovery:status'),
}

/**
 * React test ağacını gerçek HTML'e çevirir.
 *
 * ÖNEMLİ: kök düğümün SARMALAYICISI atılır. `react-test-renderer` kökü daima fazladan bir `<div>`
 * içine sarar; gerçek uygulamada ise `.hud` DOĞRUDAN `#root`un çocuğudur. Aradaki bu div,
 * `#root{height:100%}` zincirini koparır (yüzde yükseklik "auto"ya düşer) ve ölçüm yanlış yeri
 * denetler — bu tam olarak bir kez yaşandı: harness 256px'lik bir kutu ölçüp "taşma var" dedi.
 */
function htmlYap(n: ReactTestInstance, kokMu = true): string {
  if (typeof n === 'string') return n
  const tip = typeof n.type === 'string' ? n.type : 'div'
  const sinif = (n.props as { className?: string }).className
  const etiket = (n.props as { 'aria-label'?: string })['aria-label']
  const ic = n.children.map((c) => (typeof c === 'string' ? c : htmlYap(c, false))).join('')
  if (['img', 'br', 'hr', 'input'].includes(tip)) return kokMu ? ic : `<${tip}${sinif ? ` class="${sinif}"` : ''}>`
  if (kokMu) return ic
  const nitelik = `${sinif ? ` class="${sinif}"` : ''}${etiket ? ` aria-label="${etiket}"` : ''}`
  return `<${tip}${nitelik}>${ic}</${tip}>`
}

const cssHud = readFileSync(join(process.cwd(), 'src', 'styles', 'xp.css'), 'utf8')
const cssViewer = readFileSync(join(process.cwd(), 'src', 'viewer', 'viewer.css'), 'utf8')

/**
 * HUD penceresinin GERÇEK kök kuralları. Bu kurallar `hud-root` sınıfıyla gelir ve zincirin tamamı
 * şarttır: `html,body,#root{height:100%}` olmazsa `.hud` yüzdeyi çözemez ve pencere dışına taşar.
 * Harness bu yüzden kuralları kopyalamaz, CSS dosyasından AYNEN alır.
 */
function hudRootKurallari(): string {
  const bloklar = cssHud.match(/html\.hud-root[^{]*\{[^}]*\}/g) ?? []
  if (!bloklar.length) throw Error('html.hud-root kuralları bulunamadı: harness pencere düzenini kuramaz')
  return bloklar.join('\n')
}

/** Gerçek HUD kartını (Hud.tsx) besleyip statik HTML'ini üretir. */
async function hudHtml(): Promise<string> {
  const Hud = (await import('../src/components/Hud')).default
  let t: ReactTestRenderer
  act(() => { t = create(createElement(Hud)) })
  act(() => {
    kanal['hud:status']({ level: 'info', text: 'Hedef bulundu · Oluştur düğmesine tıklanıyor' })
    kanal['hud:countdown']({ text: 'Model cevabı · qwen3.5-64k:latest · 1,4 sn' })
    kanal['hud:stages']({ text: 'OCR + liste · 147 aday 1,2 sn · Model · qwen3.5-64k:latest 3,1 sn' })
    kanal['hud:method']({ text: 'Tıkla · Tıkla 1' })
    kanal['hud:loop']({ text: 'Modeller · 3/12' })
    kanal['hud:context']({ kart: baglamFixture() })
    kanal['hud:memory']({ kart: bellekFixture() })
  })
  const html = htmlYap(t!.root)
  act(() => t!.unmount())
  return html
}

/** Gerçek telefon kartını (ViewerHudScreen.tsx) statik HTML'ini üretir. */
async function phoneHtml(): Promise<string> {
  const ViewerHudScreen = (await import('../src/viewer/ViewerHudScreen')).default
  let t: ReactTestRenderer
  const hud = {
    level: 'info' as const, text: 'PC bilgi kartı', loop: 'Modeller · 3/12', method: 'Windows OCR',
    countdown: 'Model cevabı · qwen3.5-64k:latest · 1,4 sn', recovering: false,
    stages: 'OCR + liste · 147 aday 1,2 sn · Model · qwen3.5-64k:latest 3,1 sn',
    bellek: bellekFixture(), baglam: baglamFixture(),
  }
  act(() => { t = create(createElement(ViewerHudScreen, { hud, connected: true, error: '', phoneOnly: true })) })
  const html = htmlYap(t!.root)
  act(() => t!.unmount())
  return html
}

type DuzOlcum = {
  etiket: string
  kartDisi: { secici: string; tasmaPx: number }[]
  kesilenMetin: { secici: string; metin: string; scrollWidth: number; clientWidth: number }[]
  onemli: { metin: string; gorunur: boolean }[]
  kartYuksekligi: number
  /** Durum kartı ve satırların ÖLÇÜLEN yükseklikleri: okunur yer kaldı mı? */
  olculer: { ad: string; yukseklik: number; icerikYuksekligi: number }[]
  kokTasma: string[]
}

/**
 * Tek bir ölçüm: verilen HTML'i verilen ölçüde gerçek Chrome'da çizer ve taşmaları ölçer.
 *
 * ÖNEMLİ: blok içi dikey kaydırma (`overflow-y:auto`) BİLEREK yapılmıştır ve bilgi kaybı DEĞİLDİR;
 * ölçümün aradığı kusur, ölçüm satırlarının YATAY kırpılması, kök kutunun pencere dışına taşması ve
 * durum kartının okunamayacak kadar küçülmesidir.
 */
async function tarayicidaOlc(html: string, genislik: number, yukseklik: number, etiket: string, kokSecici: string): Promise<DuzOlcum> {
  const { chromium } = await import('playwright-core')
  const tarayici = await chromium.launch({ channel: 'chrome' })
  try {
    const sayfa = await tarayici.newPage({ viewport: { width: genislik, height: yukseklik } })
    const kok = `html,body{height:100%;margin:0;overflow:hidden;background:#fff}\n${hudRootKurallari()}`
    await sayfa.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${kok}\n${cssHud}\n${cssViewer}</style></head><body><div id="root">${html}</div></body></html>`)
    await sayfa.evaluate((secici) => {
      // Hud.tsx köke `hud-root` sınıfını ekler; ızgara düzeni o kurallara bağlıdır.
      if (secici === '.hud') document.documentElement.classList.add('hud-root')
    }, kokSecici)
    // Harness GERÇEK pencere düzenini kurmuş olmalı: `#root` yüzde yüksekliği çözemezse `.hud`
    // içeriğe göre büyür ve ölçüm yanlış yeri denetler (yanlış yeşil).
    if (kokSecici === '.hud') {
      const zincir = await sayfa.evaluate(() => {
        const h = document.querySelector('.hud') as HTMLElement | null
        const r = document.getElementById('root') as HTMLElement
        return { varMi: !!h, kokYuksekligi: Math.round(r.getBoundingClientRect().height), pencere: window.innerHeight }
      })
      if (zincir.varMi && zincir.kokYuksekligi > zincir.pencere + 1) {
        throw new Error(`Harness penceresi kurulamadı (#root ${zincir.kokYuksekligi} > pencere ${zincir.pencere}); ölçüm geçersiz.`)
      }
    }
    const sonuc = await sayfa.evaluate((kokSecici: string) => {
      const kart = document.querySelector(kokSecici) as HTMLElement
      const kartKutu = kart.getBoundingClientRect()
      const kartDisi: { secici: string; tasmaPx: number }[] = []
      const kesilenMetin: { secici: string; metin: string; scrollWidth: number; clientWidth: number }[] = []
      const onemli: { metin: string; gorunur: boolean }[] = []
      /** Kırpma SINIRI: en yakın kaydırılabilir ata. Kaydırılan içerik kusur DEĞİLDİR. */
      const sinir = (el: HTMLElement): { kutu: DOMRect; kaydirilabilir: boolean } => {
        let p = el.parentElement
        while (p && p !== kart) {
          const st = getComputedStyle(p)
          if (/auto|scroll/.test(st.overflowY) || /auto|scroll/.test(st.overflowX)) return { kutu: p.getBoundingClientRect(), kaydirilabilir: true }
          p = p.parentElement
        }
        return { kutu: kartKutu, kaydirilabilir: false }
      }
      for (const el of Array.from(kart.querySelectorAll('*')) as HTMLElement[]) {
        const k = el.getBoundingClientRect()
        if (k.width === 0 && k.height === 0) continue
        const s = sinir(el)
        // Kaydırılabilir bir bloğun İÇİNDEKİ öğe, o bloğun görünen alanının dışında olabilir; bu
        // bilerek yapılmıştır (bilgi kaydırılarak erişilir) ve ölçüm kusuru SAYILMAZ.
        if (s.kaydirilabilir) continue
        const tasma = Math.max(0, Math.round(k.bottom - s.kutu.bottom), Math.round(s.kutu.top - k.top),
          Math.round(k.right - s.kutu.right), Math.round(s.kutu.left - k.left))
        if (tasma > 1) kartDisi.push({ secici: el.className || el.tagName, tasmaPx: tasma })
        // Ölçüm satırları: YATAY kırpma kusurdur (metin okunamaz hâle gelir).
        if (/ana|satir|uyari|rozet/.test(el.className) && el.scrollWidth > el.clientWidth + 1) {
          kesilenMetin.push({ secici: el.className, metin: (el.textContent || '').slice(0, 60), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })
        }
      }
      // Kısa bölümün iki satırı kartın İÇİNDE, kırpılmadan ve görünür olmalı.
      const anaSatirlar = Array.from(kart.querySelectorAll('.hud-bellek-ana, .viewer-hud-bellek-ana')) as HTMLElement[]
      for (const s of anaSatirlar) {
        const k = s.getBoundingClientRect()
        const sb = sinir(s)
        onemli.push({
          metin: (s.textContent || '').trim(),
          gorunur: k.height > 0 && k.top >= sb.kutu.top - 1 && k.bottom <= sb.kutu.bottom + 1 && s.scrollWidth <= s.clientWidth + 1,
        })
      }
      // Durum kartı: okunur yer KALDI mı? Kart satırı 1fr'dir; ölçüm blokları büyürse bu satır
      // küçülür ve metin okunamaz hâle gelir. Bu ölçüm o kusuru yakalar.
      const olculer: { ad: string; yukseklik: number; icerikYuksekligi: number }[] = []
      for (const ad of ['.hud-card', '.hud-text', '.hud-bellek', '.hud-baglam', '.viewer-hud-bellek']) {
        const el = document.querySelector(ad) as HTMLElement | null
        if (el) olculer.push({ ad, yukseklik: Math.round(el.getBoundingClientRect().height), icerikYuksekligi: el.scrollHeight })
      }
      const kokEl = document.querySelector('.hud') as HTMLElement | null
      const kokTasma: string[] = []
      if (kokEl) {
        const k = kokEl.getBoundingClientRect()
        if (kokEl.scrollHeight > kokEl.clientHeight + 1) kokTasma.push(`ızgara içi dikey ${kokEl.scrollHeight}>${kokEl.clientHeight}`)
        if (kokEl.scrollWidth > kokEl.clientWidth + 1) kokTasma.push(`ızgara içi yatay ${kokEl.scrollWidth}>${kokEl.clientWidth}`)
        // PENCERE SINIRI: kök kutu görüntü alanından büyükse satırlar pencerenin dışında kalır
        // (gerçek HUD'da `html.hud-root{overflow:hidden}` bunu keser: satır GÖRÜNMEZ olur).
        if (k.bottom > window.innerHeight + 1) kokTasma.push(`pencere altı ${Math.round(k.bottom)}>${window.innerHeight}`)
        if (k.right > window.innerWidth + 1) kokTasma.push(`pencere sağı ${Math.round(k.right)}>${window.innerWidth}`)
        if (k.top < -1 || k.left < -1) kokTasma.push(`pencere dışı sol/üst ${Math.round(k.left)},${Math.round(k.top)}`)
      }
      return { etiket: '', kartDisi, kesilenMetin, onemli, kartYuksekligi: Math.round(kartKutu.height), olculer, kokTasma }
    }, kokSecici)
    return { ...sonuc, etiket } as DuzOlcum
  } finally {
    await tarayici.close()
  }
}

const raporlar: DuzOlcum[] = []
const htmlKaydi: Record<string, string> = {}
afterAll(() => {
  if (raporlar.length === 0) return
  try {
    mkdirSync('test-artifacts', { recursive: true })
    writeFileSync(join('test-artifacts', 'kart-tasma-olcumu.json'), JSON.stringify(raporlar, null, 2), 'utf8')
    // Üretilen HTML saklanır: ekran görüntüsü alacak betik AYNI kartı çizer (yeniden üretmez).
    writeFileSync(join('test-artifacts', 'kart-html.json'), JSON.stringify(htmlKaydi), 'utf8')
  } catch { /* rapor yazılamazsa test sonucu yine geçerlidir */ }
})

describe('kart taşma denetimi — GERÇEK tarayıcı düzeni', () => {
  it('masaüstü kartı 456×254 (main’deki HUD_W/HUD_H) içinde taşmaz ve durum satırı okunur kalır', async () => {
    const html = await hudHtml()
    htmlKaydi.masaustu = html
    // Kısa bölümün iki satırı HTML'de olmalı (kart nesnesi geldiyse).
    expect(html).toContain('RAM 12,1 / 15,8 GB · VRAM 9,2 / 12,0 GB')
    expect(html).toContain('Bellek bütçesi 35,3 / 36,7 GB · kalan 1,4 GB')
    const olcum = await tarayicidaOlc(html, 456, 254, 'masaüstü 456x254', '.hud')
    raporlar.push(olcum)
    expect(olcum.kokTasma, `ızgara/pencere taşması: ${JSON.stringify(olcum.kokTasma)}`).toEqual([])
    expect(olcum.kartDisi, `kart dışına taşan kutular: ${JSON.stringify(olcum.kartDisi)}`).toEqual([])
    expect(olcum.kesilenMetin, `kırpılan ölçüm satırları: ${JSON.stringify(olcum.kesilenMetin)}`).toEqual([])
    expect(olcum.onemli.length).toBe(2)
    for (const s of olcum.onemli) expect(s.gorunur, `görünmeyen satır: ${s.metin}`).toBe(true)
    // Durum kartı okunur yer korur: satır 70px'in altına düşerse metin görünmez olurdu.
    const kart = olcum.olculer.find((o) => o.ad === '.hud-card')!
    expect(kart.yukseklik, `durum kartı yüksekliği: ${JSON.stringify(olcum.olculer)}`).toBeGreaterThanOrEqual(70)
    // Durum metni KIRPILMAZ: içerik kendi alanına sığar (kaydırma gerekmez).
    const metin = olcum.olculer.find((o) => o.ad === '.hud-text')!
    expect(metin.icerikYuksekligi, `durum metni kaydırılıyor: ${JSON.stringify(metin)}`).toBeLessThanOrEqual(metin.yukseklik + 1)
    // Ölçüm blokları SINIRLI yüksekliktedir: kendi içlerinde kaydırılır, kartı büyütmezler.
    expect(olcum.olculer.find((o) => o.ad === '.hud-bellek')!.yukseklik).toBeLessThanOrEqual(46)
    expect(olcum.olculer.find((o) => o.ad === '.hud-baglam')!.yukseklik).toBeLessThanOrEqual(42)
  }, 120000)

  it('telefon kartı 390×844 içinde taşmaz ve kısa bölüm okunur', async () => {
    const html = await phoneHtml()
    htmlKaydi.telefon = html
    expect(html).toContain('RAM 12,1 / 15,8 GB · VRAM 9,2 / 12,0 GB')
    const olcum = await tarayicidaOlc(html, 390, 844, 'telefon 390x844', '.viewer-hud-screen')
    raporlar.push(olcum)
    expect(olcum.kartDisi, `kart dışına taşan kutular: ${JSON.stringify(olcum.kartDisi)}`).toEqual([])
    expect(olcum.kesilenMetin, `kırpılan ölçüm satırları: ${JSON.stringify(olcum.kesilenMetin)}`).toEqual([])
    expect(olcum.onemli.length).toBe(2)
    for (const s of olcum.onemli) expect(s.gorunur, `görünmeyen satır: ${s.metin}`).toBe(true)
    // Telefonun bellek bloğu SINIRLI yüksekliktedir: uzun ayrıntı listesi ekranı yutmaz.
    const bellek = olcum.olculer.find((o) => o.ad === '.viewer-hud-bellek')!
    expect(bellek.yukseklik, `telefon bellek bloğu: ${JSON.stringify(olcum.olculer)}`).toBeLessThanOrEqual(Math.round(844 * 0.34) + 2)
  }, 120000)
})
