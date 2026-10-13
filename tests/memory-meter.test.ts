import { describe, expect, it, vi } from 'vitest'
import {
  BELLEK_ESKI_MS,
  BELLEK_OLCUM_MS,
  bellekKartiYap,
  bellekOlcumDongusu,
  commitDaraliyor,
  gbOran,
  gbYaz,
  gpuListesiAyikla,
  gpuOlc,
  gunlukKarari,
  kodla,
  olcumGunlukSatiri,
  olcumKur,
  olcumYasiYaz,
  psCalistir,
  sayiYaNull,
  sistemBloguYap,
  surecGrubuYap,
  type BellekOlcumu,
} from '../electron/memory-meter'

/**
 * CANLI BELLEK GÖSTERGESİ (1.9.130) — ölçüm katmanı. Sınanan şey "kapı fırladı mı" değil,
 * "değer doğru okundu/kuruldu mu ve başarısız ölçüm uygulamayı etkiliyor mu"dur.
 *
 * Buradaki sayaç DEĞERLERİ, Windows'un aynı alanlarından CANLI okunmuş gerçek örneklerdir
 * (aşağıdaki `CANLI` sabiti); beklenen metinler o değerlerden hesaplanır.
 */
const GB = 1024 ** 3

/** Bu makinede GlobalMemoryStatusEx + Get-Process ile CANLI okunmuş örnek (gerçek değerler). */
const CANLI = {
  ramToplam: 17009442816,
  ramKullanilan: 10284969984,
  serbestCommit: 26256642048,
  sayfaSinir: 39453388800,
  sayacHata: '',
}

describe('değer biçimleme: ölçülemeyen değer UYDURULMAZ', () => {
  it('baytı Türkçe ondalıkla GB yazar', () => {
    expect(gbYaz(12.1 * GB)).toBe('12,1')
    expect(gbYaz(0)).toBe('0,0')
  })
  it('bilinmeyen değer "bilinmiyor" olur (sıfır yazılmaz)', () => {
    for (const v of [null, undefined, NaN, -1]) expect(gbYaz(v as number | null)).toBe('bilinmiyor')
  })
  it('kullanılan/toplam: toplam yoksa oran uydurulmaz', () => {
    expect(gbOran(12.1 * GB, 15.8 * GB)).toBe('12,1 / 15,8 GB')
    expect(gbOran(12.1 * GB, null)).toBe('bilinmiyor')
    expect(gbOran(null, 15.8 * GB)).toBe('bilinmiyor')
    expect(gbOran(1, 0)).toBe('bilinmiyor')
  })
  it('sayı çözümleme yalnız sonlu ve negatif olmayan değeri kabul eder', () => {
    expect(sayiYaNull(0)).toBe(0)
    expect(sayiYaNull('123')).toBe(123)
    expect(sayiYaNull(undefined)).toBeNull()
    expect(sayiYaNull('abc')).toBeNull()
  })
})

describe('sistem bloğu: geçerli sayaç, eksik sayaç ve eksik yapı', () => {
  it('GEÇERLİ sayaç: commit doğrudan Windows değerinden gelir, kaynak "sayac"', () => {
    const s = sistemBloguYap(CANLI)
    expect(s.kaynak).toBe('sayac')
    expect(s.commitSinirBayt).toBe(CANLI.sayfaSinir)
    expect(s.commitKullanilanBayt).toBe(CANLI.sayfaSinir - CANLI.serbestCommit)
    expect(s.commitKalanBayt).toBe(CANLI.serbestCommit)
    expect(s.commitDoluluk).toBeCloseTo((CANLI.sayfaSinir - CANLI.serbestCommit) / CANLI.sayfaSinir, 6)
    expect(s.ramToplamBayt).toBe(CANLI.ramToplam)
    expect(s.ramKullanilanBayt).toBe(CANLI.ramKullanilan)
  })

  it('EKSİK sayaç (sayacHata dolu): değer belgelenmiş sayfa dosyası alanından gelir ve kaynak yazılır', () => {
    const s = sistemBloguYap({ ...CANLI, sayacHata: 'The specified object was not found on the computer.' })
    expect(s.kaynak).toBe('sayfa-dosyasi')
    // Değer yine gerçek: commit sınırı ve kullanımı aynı belgelenmiş yapıdan.
    expect(s.commitSinirBayt).toBe(CANLI.sayfaSinir)
    expect(s.commitKullanilanBayt).toBe(CANLI.sayfaSinir - CANLI.serbestCommit)
  })

  it('sistem belleği HİÇ okunamadıysa her alan bilinmiyor', () => {
    const s = sistemBloguYap({ olcumHata: 'bellek yapisi: erisim engellendi', sayacHata: 'yok' })
    expect(s.kaynak).toBe('bilinmiyor')
    expect(s.ramToplamBayt).toBeNull()
    expect(s.commitSinirBayt).toBeNull()
    expect(s.commitKullanilanBayt).toBeNull()
    expect(s.commitKalanBayt).toBeNull()
    expect(s.commitDoluluk).toBeNull()
  })

  it('serbest commit sınırdan BÜYÜKSE (tutarsız çıktı) commit kullanımı bilinmiyor kalır', () => {
    const s = sistemBloguYap({ sayfaSinir: 100, serbestCommit: 500 })
    expect(s.commitSinirBayt).toBe(100)
    expect(s.commitKullanilanBayt).toBeNull()
    expect(s.commitKalanBayt).toBeNull()
  })

  it('sistem commit’i süreç sayacı TOPLAMINDAN üretilmez (kaynak ayrı)', () => {
    const s = sistemBloguYap(CANLI)
    const toplamSurec = 3 * GB
    // Süreç toplamı ne olursa olsun sistem commit’i değişmez.
    expect(s.commitKullanilanBayt).not.toBe(toplamSurec)
    expect(s.commitKullanilanBayt).toBe(CANLI.sayfaSinir - CANLI.serbestCommit)
  })
})

describe('süreç grupları: Blender ve yerel model çalıştırıcıları', () => {
  it('toplanan süreç yoksa grup YOKTUR (uydurma sıfır yazılmaz)', () => {
    expect(surecGrubuYap('Blender', 0, 0, 0, 'isim')).toBeNull()
    expect(surecGrubuYap('Blender', null, 100, 100, 'isim')).toBeNull()
  })
  it('grup metni commit’i "commit" diye etiketler (fiziksel RAM DENMEZ)', () => {
    const g = surecGrubuYap('Blender', 3, 4.2 * GB, 5.1 * GB, 'isim')!
    expect(g.metin).toBe('Blender · 3 süreç · commit 4,2 GB · working set 5,1 GB')
    expect(g.metin).not.toMatch(/RAM/i)
    expect(g.privateBayt).toBe(4.2 * GB)
    expect(g.workingSetBayt).toBe(5.1 * GB)
  })
  it('süreç sayacı okunamazsa adet yazılır, değer bilinmiyor kalır', () => {
    // Sayacın kendisi okunamadı (undefined): sıfır YAZILMAZ, "bilinmiyor" yazılır.
    const g = surecGrubuYap('Blender', 2, undefined, undefined, 'isim')!
    expect(g.metin).toContain('2 süreç')
    expect(g.metin).toContain('commit bilinmiyor')
    expect(g.metin).toContain('working set bilinmiyor')
    expect(g.privateBayt).toBeNull()
  })
})

describe('ölçüm nesnesi: ağaç önce, ad tahmini sonra', () => {
  it('ollama süreç ağacı varsa YEREL MODEL grubu ağaçtan kurulur', () => {
    const o = olcumKur({ ...CANLI, agacAdet: 4, agacPb: 6 * GB, agacWs: 7 * GB, agacEslesen: 2, isimAdet: 4, isimPb: 3 * GB, isimWs: 3.5 * GB, blenderAdet: 1, blenderPb: 2 * GB, blenderWs: 2.5 * GB }, [], 1000, 250)
    expect(o.model?.adet).toBe(4)
    expect(o.model?.kaynak).toBe('agac')
    expect(o.blender?.adet).toBe(1)
    // Ağaç dışında kalan tanınan çalıştırıcılar AYRI ve açıkça etiketlenir (modele karıştırılmaz):
    // ad eşleşmesi 4 süreç gördü, ağacın içinde 2 tanınan süreç var → 2 artık.
    expect(o.digerCalistiricilar).toHaveLength(1)
    expect(o.digerCalistiricilar[0].etiket).toContain('ağaç dışı')
    expect(o.digerCalistiricilar[0].adet).toBe(2)
  })

  it('ağacın içindeki tanınan süreçler ikinci kez SAYILMAZ (artık yoksa grup açılmaz)', () => {
    const o = olcumKur({ ...CANLI, agacAdet: 4, agacPb: 6 * GB, agacWs: 7 * GB, agacEslesen: 2, isimAdet: 2, isimPb: 3 * GB, isimWs: 3.5 * GB }, [], 1000, 250)
    expect(o.model?.adet).toBe(4)
    expect(o.digerCalistiricilar).toHaveLength(0)
  })

  it('ağaç kurulamazsa ad eşleşmesi kullanılır ve kaynak "isim" olur', () => {
    const o = olcumKur({ ...CANLI, agacAdet: 0, isimAdet: 3, isimPb: 3 * GB, isimWs: 3.5 * GB }, [], 1000, 250)
    expect(o.model?.adet).toBe(3)
    expect(o.model?.kaynak).toBe('isim')
    expect(o.digerCalistiricilar).toHaveLength(0)
  })

  it('hiçbir çalıştırıcı yoksa model grubu null (ölçüm yine döner)', () => {
    const o = olcumKur({ ...CANLI }, [], 1000, 250)
    expect(o.model).toBeNull()
    expect(o.blender).toBeNull()
    expect(o.sunucu.commitSinirBayt).toBe(CANLI.sayfaSinir)
  })

  it('süreç listesi okunamazsa not düşülür, ölçüm geçersiz olmaz', () => {
    const o = olcumKur({ ...CANLI, surecHata: 'Get-Process erisilemedi' }, [], 1000, 250)
    expect(o.notlar.join(' ')).toContain('Süreç sayaçları okunamadı')
    expect(o.sunucu.commitSinirBayt).toBe(CANLI.sayfaSinir)
  })
})

describe('GPU: çoklu GPU birleştirilmez', () => {
  it('her satır ayrı GPU olur (indeks + ad) ve Türkçe ondalıkla yazılır', () => {
    const liste = gpuListesiAyikla('0, NVIDIA GeForce RTX 3060, 806, 12288\n1, NVIDIA GeForce GTX 1050, 512, 4096\n')
    expect(liste).toHaveLength(2)
    expect(liste[0].ad).toBe('NVIDIA GeForce RTX 3060')
    expect(liste[0].indeks).toBe(0)
    expect(liste[0].metin).toContain('GB')
    expect(liste[1].metin).toContain('GB')
    expect(liste[0].metin).not.toBe(liste[1].metin)
  })
  it('bozuk/eksik satır atlanır, geçerli satır korunur', () => {
    expect(gpuListesiAyikla('cop satir\n0, GPU, 100, 200\n1, GPU, [N/A], 200')).toHaveLength(1)
    expect(gpuListesiAyikla('')).toHaveLength(0)
    expect(gpuListesiAyikla('nvidia-smi: command not found')).toHaveLength(0)
  })
  it('VRAM ölçülemezse uydurma değer yazılmaz, not düşülür', () => {
    const o = olcumKur(CANLI, [], 1000, 250)
    expect(o.notlar.join(' ')).toContain('VRAM ölçülemedi')
    const k = bellekKartiYap({ olcum: o, simdi: 1000 })
    expect(k.ramVram).toContain('VRAM bilinmiyor')
  })
})

describe('ölçüm döngüsü: üst üste sorgu başlatılmaz, hata uygulamayı etkilemez', () => {
  const kart = (olcumAt: number, commitKullanilan: number): BellekOlcumu => olcumKur(
    { ramToplam: 16 * GB, ramKullanilan: 8 * GB, sayfaSinir: 20 * GB, serbestCommit: 20 * GB - commitKullanilan },
    [], olcumAt, 100,
  )

  it('ölçüm 3 saniyede bir yenilenir ve önceki bitmeden yenisi BAŞLATILMAZ', async () => {
    let icerde = 0
    let enFazlaEsZamanli = 0
    let cagri = 0
    const d = bellekOlcumDongusu({
      aralikMs: 1000,
      olc: async () => {
        icerde++
        enFazlaEsZamanli = Math.max(enFazlaEsZamanli, icerde)
        await new Promise((r) => setTimeout(r, 60))
        icerde--
        cagri++
        return kart(1000 + cagri, GB)
      },
    })
    d.basla()
    await new Promise((r) => setTimeout(r, 2600))
    d.dur()
    expect(cagri).toBeGreaterThanOrEqual(2)
    expect(enFazlaEsZamanli).toBe(1)
    expect(d.olcuyor()).toBe(false)
  })

  it('başarısız ölçüm SON GEÇERLİ değeri korur ve hata yaşıyla bildirilir', async () => {
    let simdi = 5_000_000
    let adim = 0
    const hatalar: { at: number; mesaj: string }[] = []
    const d = bellekOlcumDongusu({
      aralikMs: 1000,
      simdi: () => simdi,
      olc: async () => {
        adim++
        if (adim === 1) return kart(simdi, 2 * GB)
        throw new Error('sayaç çıktısı çözümlenemedi')
      },
      hataDinleyici: (h, son) => hatalar.push({ at: h.at, mesaj: `${h.mesaj} | son=${son ? son.olcumAt : 'yok'}` }),
    })
    d.basla()
    await new Promise((r) => setTimeout(r, 2600))
    d.dur()
    expect(hatalar.length).toBeGreaterThanOrEqual(1)
    expect(hatalar[0].mesaj).toContain('son=5000000')
    // Uygulama etkilenmedi: son geçerli ölçüm hâlâ duruyor.
    expect(d.olcum()?.olcumAt).toBe(5_000_000)
    expect(d.sonHata()).not.toBeNull()
  })

  it('dur() sonrası bekleyen ölçüm karta YAZMAZ (kapanış temizliği)', async () => {
    let coz: ((o: BellekOlcumu) => void) | null = null
    const dinleyici = vi.fn()
    const d = bellekOlcumDongusu({
      aralikMs: 1000,
      olc: () => new Promise<BellekOlcumu>((r) => { coz = r }),
      dinleyici,
    })
    d.basla()
    await new Promise((r) => setTimeout(r, 10))
    d.dur()
    coz!(kart(1, GB))
    await new Promise((r) => setTimeout(r, 20))
    expect(dinleyici).not.toHaveBeenCalled()
    expect(d.olcum()).toBeNull()
  })

  it('dinleyici hatası ölçüm döngüsünü DURDURMAZ', async () => {
    let cagri = 0
    const d = bellekOlcumDongusu({
      aralikMs: 1000,
      olc: async () => kart(Date.now(), GB),
      dinleyici: () => { cagri++; throw new Error('dinleyici patladı') },
    })
    d.basla()
    await new Promise((r) => setTimeout(r, 2400))
    d.dur()
    expect(cagri).toBeGreaterThanOrEqual(2)
  })

  it('varsayılan aralık ~3 saniyedir', () => {
    expect(BELLEK_OLCUM_MS).toBe(3000)
    expect(BELLEK_ESKI_MS).toBe(3 * BELLEK_OLCUM_MS)
  })
})

describe('süreç çalıştırma: asenkron, zaman aşımlı, hata fırlatmaz', () => {
  it('zaman aşımında süreç öldürülür ve hata FIRLATILMAZ', async () => {
    const basi = Date.now()
    const r = await psCalistir('Start-Sleep -Seconds 30; [Console]::Out.Write("gec")', 1500)
    expect(Date.now() - basi).toBeLessThan(15000)
    expect(r.cikti).not.toContain('gec')
  }, 20000)

  it('var olmayan çalıştırıcı sessizce boş döner', async () => {
    const r = await gpuOlc(400)
    expect(Array.isArray(r)).toBe(true)
    expect(r.every((g) => typeof g.metin === 'string')).toBe(true)
  }, 20000)

  it('betik base64/UTF-16LE ile verilir (tırnak ve kaçış tuzağı yok)', () => {
    const args = kodla("$x='a b'; [Console]::Out.Write($x)")
    expect(args).toContain('-EncodedCommand')
    const kod = args[args.indexOf('-EncodedCommand') + 1]
    expect(Buffer.from(kod, 'base64').toString('utf16le')).toBe("$x='a b'; [Console]::Out.Write($x)")
  })
})

describe('günlük kararı: her örnek diske yazılmaz', () => {
  it('eşik GEÇİŞİNDE bir kez yazılır, eşikte kalmak tekrar yazmaz', () => {
    const durum = { esikte: false, baslangicYazildi: false }
    const dar = (doluluk: number) => olcumKur({ ramToplam: 16 * GB, ramKullanilan: 8 * GB, sayfaSinir: 100 * GB, serbestCommit: 100 * GB * (1 - doluluk) }, [], Date.now(), 10)
    expect(gunlukKarari(durum, { tur: 'olcum', olcum: dar(0.5) }).yaz).toBe(false)
    const gecis = gunlukKarari(durum, { tur: 'olcum', olcum: dar(0.93) })
    expect(gecis.yaz).toBe(true)
    if (gecis.yaz) {
      expect(gecis.neden).toBe('esik')
      expect(gecis.satir).toContain('Bellek bütçesi daralıyor')
      expect(gecis.satir).toContain('çökme tahmini değil')
    }
    // Eşikte kalmaya devam: YENİ kayıt yok.
    expect(gunlukKarari(durum, { tur: 'olcum', olcum: dar(0.95) }).yaz).toBe(false)
    // Altına inince geçiş yine yazılır.
    expect(gunlukKarari(durum, { tur: 'olcum', olcum: dar(0.4) }).yaz).toBe(true)
  })

  it('hata anı HER ZAMAN yazılır ve örneğin YAŞI yazılır', () => {
    const durum = { esikte: false, baslangicYazildi: false }
    const son = olcumKur({ ramToplam: 16 * GB, ramKullanilan: 8 * GB, sayfaSinir: 20 * GB, serbestCommit: 10 * GB }, [], 1_000_000, 10)
    const k = gunlukKarari(durum, { tur: 'hata', hata: { at: 1_007_500, mesaj: 'PowerShell çıktısı yok' }, sonGecerli: son })
    expect(k.yaz).toBe(true)
    if (k.yaz) {
      expect(k.neden).toBe('hata')
      expect(k.satir).toContain('7500 ms önce alındı')
    }
  })
})

describe('kart nesnesi: kullanıcının istediği iki kısa satır', () => {
  const olcum = olcumKur({ ...CANLI }, gpuListesiAyikla('0, NVIDIA GeForce RTX 3060, 9416, 12288'), 1_000_000, 200)

  it('kısa bölüm RAM/VRAM ve bütçe satırlarını taşır', () => {
    const k = bellekKartiYap({ olcum, simdi: 1_000_500 })
    expect(k.ramVram).toMatch(/^RAM \d+,\d \/ \d+,\d GB · VRAM \d+,\d \/ \d+,\d GB$/)
    expect(k.butce).toMatch(/^Bellek bütçesi \d+,\d \/ \d+,\d GB · kalan \d+,\d GB$/)
    expect(k.satirlar.slice(0, 2)).toEqual([k.ramVram, k.butce])
  })

  it('kullanıcı açıklamaları vardır ve commit fiziksel RAM diye etiketlenmez', () => {
    const k = bellekKartiYap({ olcum, simdi: 1_000_500 })
    expect(k.aciklamalar.join(' ')).toContain('RAM: fiziksel bellek.')
    expect(k.aciklamalar.join(' ')).toContain('sayfa dosyasıyla karşılayabildiği bellek')
    expect(k.aciklamalar.join(' ')).toContain('ortak (paylaşılan) sayfaları')
    expect(k.aciklamalar.join(' ')).toContain('fiziksel RAM kullanımı değildir')
    expect(k.aciklamalar.join(' ')).toContain('süreç sayaçları toplanarak üretilmez')
  })

  it('commit doluluğu %90 ve üstünde "Bellek bütçesi daralıyor" uyarısı çıkar', () => {
    const dar = olcumKur({ ramToplam: 16 * GB, ramKullanilan: 8 * GB, sayfaSinir: 50 * GB, serbestCommit: 5 * GB }, [], 1_000_000, 10)
    const k = bellekKartiYap({ olcum: dar, simdi: 1_000_100 })
    expect(dar.sunucu.commitDoluluk).toBeCloseTo(0.9, 6)
    expect(commitDaraliyor(dar.sunucu)).toBe(true)
    expect(k.daraliyor).toBe(true)
    expect(k.uyari).toBe('Bellek bütçesi daralıyor')
  })

  it('doluluk %90’ın altındaysa uyarı YOK', () => {
    const rahat = olcumKur({ ramToplam: 16 * GB, ramKullanilan: 8 * GB, sayfaSinir: 50 * GB, serbestCommit: 10 * GB }, [], 1_000_000, 10)
    const k = bellekKartiYap({ olcum: rahat, simdi: 1_000_100 })
    expect(commitDaraliyor(rahat.sunucu)).toBe(false)
    expect(k.daraliyor).toBe(false)
    expect(k.uyari).toBe('')
  })
})

describe('eski ölçüm gösterimi ve hata durumu', () => {
  const olcum = olcumKur({ ...CANLI }, [], 1_000_000, 100)
  it('yaş 3 sn’nin altında "az önce ölçüldü"', () => {
    expect(olcumYasiYaz(1_000_000, 1_000_500)).toBe('az önce ölçüldü')
    expect(olcumYasiYaz(1_000_000, 1_015_000)).toBe('15 sn önce ölçüldü')
    expect(olcumYasiYaz(0, Date.now())).toBe('ölçüm zamanı bilinmiyor')
  })
  it('ölçüm yaşlanınca kart "Eski ölçüm" ve ölçüm zamanını yazar', () => {
    const taze = bellekKartiYap({ olcum, simdi: 1_000_500 })
    expect(taze.eski).toBe(false)
    expect(taze.satirlar.join(' ')).not.toContain('Eski ölçüm')
    const bayat = bellekKartiYap({ olcum, simdi: 1_000_000 + BELLEK_ESKI_MS + 1 })
    expect(bayat.eski).toBe(true)
    expect(bayat.satirlar.join(' ')).toContain('Eski ölçüm')
    expect(bayat.satirlar.join(' ')).toContain('sn önce ölçüldü')
  })
  it('ölçüm hatası varsa elde kalan örnek ESKİ sayılır ve hatanın yaşı yazılır', () => {
    const k = bellekKartiYap({ olcum, simdi: 1_000_400, hata: { at: 1_000_300, mesaj: 'PowerShell çıktısı yok' } })
    expect(k.eski).toBe(true)
    expect(k.satirlar.join(' ')).toContain('Eski ölçüm')
    expect(k.satirlar.join(' ')).toContain('PowerShell çıktısı yok')
  })
  it('ölçüm hiç yoksa kart yine çizilir ve "bilinmiyor" der', () => {
    const k = bellekKartiYap({ olcum: null, simdi: Date.now() })
    expect(k.olcumVar).toBe(false)
    expect(k.ramVram).toContain('bilinmiyor')
    expect(k.butce).toContain('bilinmiyor')
    expect(k.satirlar.join(' ')).toContain('Ölçüm: bilinmiyor')
  })
})

describe('günlük satırı: tüm ölçüm tek satırda, zaman damgası çağıranda', () => {
  it('RAM, bütçe, kalan, VRAM ve süreç grupları yazılır', () => {
    const o = olcumKur(
      { ...CANLI, blenderAdet: 2, blenderPb: 4 * GB, blenderWs: 5 * GB, agacAdet: 3, agacPb: 6 * GB, agacWs: 7 * GB },
      gpuListesiAyikla('0, NVIDIA GeForce RTX 3060, 9416, 12288'), 1_000_000, 200,
    )
    const satir = olcumGunlukSatiri(o, 'Koşu başlangıcı')
    expect(satir).toContain('Koşu başlangıcı')
    expect(satir).toMatch(/RAM \d+,\d \/ \d+,\d GB/)
    expect(satir).toMatch(/bütçe \d+,\d \/ \d+,\d GB \(kaynak: sayac\)/)
    expect(satir).toMatch(/kalan \d+,\d GB/)
    expect(satir).toContain('NVIDIA GeForce RTX 3060')
    expect(satir).toContain('Blender · 2 süreç')
    expect(satir).toContain('Yerel model çalıştırıcıları · 3 süreç')
    expect(satir).toContain('doluluk %')
  })
  it('süreç yokken de satır doğruyu söyler', () => {
    const o = olcumKur({ ...CANLI }, [], 1_000_000, 200)
    const satir = olcumGunlukSatiri(o, 'Hata')
    expect(satir).toContain('Blender süreci yok')
    expect(satir).toContain('Yerel model çalıştırıcısı yok')
    expect(satir).toContain('VRAM bilinmiyor')
  })
})
