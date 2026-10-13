/**
 * CANLI BELLEK ÖLÇÜMÜ — YALNIZ ÖLÇÜM VE RAPORLAMA.
 *
 * Kapsam kuralı (kullanıcı kararı): bu modül HİÇBİR ŞEY TEMİZLEMEZ. Bellek boşaltmaz, süreç
 * kapatmaz, model boşaltmaz, üretim ayarı/model ayarı değiştirmez, LLM çağırmaz ve yeni yardımcı EXE
 * çalıştırmaz. Tek ürettiği şey `BellekOlcumu` adlı veri nesnesidir; kart o nesneden yazılır ve
 * günlük METNİ AYRIŞTIRILMAZ.
 *
 * ÖLÇÜM KAYNAKLARI (uydurma yok; ölçülemeyen alan `null` = "bilinmiyor"):
 *   · RAM kullanılan/toplam  → GlobalMemoryStatusEx (kernel32, belgelenmiş): ullTotalPhys/ullAvailPhys
 *   · Sistem bellek bütçesi  → ÖNCE Windows performans sayacı (`\Memory\Committed Bytes`,
 *     `\Memory\Commit Limit`), okunamazsa AYNI belgelenmiş yapının sayfa dosyası alanları
 *     (ullTotalPageFile = commit sınırı, ullAvailPageFile'den kullanım). İki kaynak da `kaynak`
 *     alanında AÇIKÇA yazılır.
 *   · VRAM                   → nvidia-smi, GPU BAŞINA (indeks + ad) ayrı değer.
 *   · Blender süreçleri      → blender.exe: private bytes (commit) ve working set TOPLAMI.
 *   · Yerel model çalıştırıcıları → ÖNCE ollama.exe süreç AĞACI (ParentProcessId ile kök + soy),
 *     gerçek yükleyici süreçleri dâhil; ağaç kurulamazsa AYNI çalıştırıcı adları (ollama,
 *     ollama_llama_server, llama-server, llama-server.exe…). Adı UYDURULMAZ; isimden GUI-Owl diye
 *     varsayılmaz. Emin olunamayan artık `kaynak` alanında "isim" olarak işaretlenir.
 *
 * TERİM UYARISI: süreç "private bytes" değeri FİZİKSEL RAM KULLANIMI DEĞİLDİR (sayfa dosyasına
 * taşınmış sayfaları da içerir); kart bunu "commit" diye etiketler. Sistem commit'i süreç
 * sayaçlarının TOPLAMINDAN ÜRETİLMEZ; doğrudan Windows'un kendi sayacından/yapısından okunur.
 * Working set toplamında süreçlerin ortak (paylaşılan) sayfaları birden çok kez sayılabilir.
 *
 * EŞZAMANLILIK: sorgular ASENKRON spawn ile başlar, senkron süreç çalıştırma YOKTUR; önceki ölçüm
 * bitmeden yenisi BAŞLATILMAZ. Zaman aşımında süreç ağacıyla öldürülür. Ana süreç ve otomasyon
 * beklemez; hata fırlatılmaz, yalnız "bilinmiyor" döner.
 */
import { spawn } from 'node:child_process'

/** Gigabayt gösterimi: bayt → "12,1" (Türkçe ondalık). Ölçülemeyen değer "bilinmiyor". */
export function gbYaz(bayt: number | null | undefined): string {
  if (typeof bayt !== 'number' || !Number.isFinite(bayt) || bayt < 0) return 'bilinmiyor'
  return (bayt / 1024 ** 3).toFixed(1).replace('.', ',')
}

/** "kullanılan / toplam GB" ya da eksik değerde "bilinmiyor". Toplam okunamazsa oran UYDURULMAZ. */
export function gbOran(kullanilan: number | null | undefined, toplam: number | null | undefined): string {
  const k = typeof kullanilan === 'number' && Number.isFinite(kullanilan) && kullanilan >= 0 ? kullanilan : null
  const t = typeof toplam === 'number' && Number.isFinite(toplam) && toplam > 0 ? toplam : null
  if (k === null || t === null) return 'bilinmiyor'
  return `${gbYaz(k)} / ${gbYaz(t)} GB`
}

/** Negatif olmayan sonlu sayı ya da null ("bilinmiyor"). */
export function sayiYaNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Süreç sayaçları: private bytes (commit) ve working set. Okunamayan alan "bilinmiyor" olur. */
export type BellekGrubu = {
  etiket: string
  /** Kaç süreç toplandı. */
  adet: number
  /** Süreç commit'i (private bytes) TOPLAMI. Fiziksel RAM kullanımı DEĞİLDİR. */
  privateBayt: number | null
  /** Working set TOPLAMI. Ortak (paylaşılan) sayfalar birden çok kez sayılabilir. */
  workingSetBayt: number | null
  /** Toplamın nasıl kurulduğu: 'agac' = ollama süreç ağacı, 'isim' = çalıştırıcı adları. */
  kaynak: 'agac' | 'isim'
  /** İnsan okur satır: "Blender · 3 süreç · commit 4,2 GB · working set 5,1 GB". */
  metin: string
}

export type GpuOlcumu = {
  /** nvidia-smi GPU indeksi. */
  indeks: number
  /** Sürücünün bildirdiği GPU adı (yoksa "GPU <indeks>"). */
  ad: string
  kullanilanBayt: number | null
  toplamBayt: number | null
  /** "9,2 / 12,0 GB" ya da "bilinmiyor". */
  metin: string
}

export type BellekOlcumu = {
  /** Ölçümün alındığı an (ms). */
  olcumAt: number
  /** Ölçümün sürdüğü süre (ms) — rapor ve günlük için. */
  sureMs: number
  sunucu: {
    /** Fiziksel bellek toplamı. */
    ramToplamBayt: number | null
    ramKullanilanBayt: number | null
    /** Windows'un RAM + sayfa dosyasıyla karşılayabildiği bellek: commit sınırı. */
    commitSinirBayt: number | null
    /** commit sınırı − serbest commit (yani kullanılan commit). */
    commitKullanilanBayt: number | null
    /** commit sınırı − commit kullanımı: kalan bellek bütçesi. */
    commitKalanBayt: number | null
    /** Commit doluluğu (0–1); sınır/kullanım bilinmiyorsa null. */
    commitDoluluk: number | null
    /** Değerin hangi belgelenmiş kaynaktan geldiği. */
    kaynak: 'sayac' | 'sayfa-dosyasi' | 'bilinmiyor'
  }
  /** GPU başına VRAM (çoklu GPU ayrı ayrı). Boş dizi = ölçülemedi. */
  gpu: GpuOlcumu[]
  blender: BellekGrubu | null
  /** Yerel model çalıştırıcıları (ollama ağacı; ağaç yoksa ad eşleşmesi). */
  model: BellekGrubu | null
  /** Adı bilinen ama ağacı kurulamayan ek çalıştırıcı grupları (varsa). */
  digerCalistiricilar: BellekGrubu[]
  /** Ölçüm sırasında oluşan ama ölçümü geçersiz kılmayan notlar (ör. sayaç okunamadı). */
  notlar: string[]
}

/** Ölçüm tamamen alınamadı: uygulama ETKİLENMEZ, kart son geçerli değeri "eski" diye gösterir. */
export type OlcumHatasi = { at: number; mesaj: string }

export const BELLEK_OLCUM_MS = 3000
export const BELLEK_ZAMAN_ASIMI_MS = 8000

/**
 * Windows'ta sistem ve süreç sayaçlarını TEK PowerShell sürecinde toplar ve JSON yazar.
 * Neden tek süreç: her 3 saniyede dört ayrı sorgu başlatmak ölçümün kendisini yüke çevirirdi.
 * `Get-Process` .NET'ten okur (WMI/RPC gerektirmez): süreç listesi erişilemezse ölçüm diğer
 * alanlarla yine döner, yalnız süreç grupları "bilinmiyor" olur.
 */
export const OLCUM_BETIGI = [
  "$out=[ordered]@{ ramToplam=$null; ramKullanilan=$null; serbestCommit=$null; sayfaSinir=$null; sayacHata=''; olcumHata=''; surecHata=''; blenderAdet=0; blenderPb=0; blenderWs=0; isimAdet=0; isimPb=0; isimWs=0; isimEslesen=0; agacAdet=0; agacPb=0; agacWs=0 }",
  'try {',
  '  $sig=@\'',
  'using System;',
  'using System.Runtime.InteropServices;',
  'public class NubboBellek {',
  '  [StructLayout(LayoutKind.Sequential)]',
  '  public struct MEMORYSTATUSEX {',
  '    public uint dwLength; public uint dwMemoryLoad; public ulong ullTotalPhys; public ulong ullAvailPhys;',
  '    public ulong ullTotalPageFile; public ulong ullAvailPageFile; public ulong ullTotalVirtual; public ulong ullAvailVirtual; public ulong ullAvailExtendedVirtual;',
  '  }',
  '  [DllImport("kernel32.dll", SetLastError=true)]',
  '  [return: MarshalAs(UnmanagedType.Bool)]',
  '  static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);',
  '  public static ulong[] Oku() {',
  '    MEMORYSTATUSEX m=new MEMORYSTATUSEX(); m.dwLength=(uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));',
  '    if(!GlobalMemoryStatusEx(ref m)) return new ulong[0];',
  '    return new ulong[]{ m.ullTotalPhys, m.ullAvailPhys, m.ullTotalPageFile, m.ullAvailPageFile };',
  '  }',
  '}',
  '\'@',
  '  Add-Type -TypeDefinition $sig -ErrorAction Stop',
  '  $m=[NubboBellek]::Oku()',
  '  if($m.Length -ge 4){',
  '    $out.ramToplam=[uint64]$m[0]',
  '    $out.ramKullanilan=[uint64]($m[0]-$m[1])',
  '    $out.sayfaSinir=[uint64]$m[2]',
  '    $out.serbestCommit=[uint64]$m[3]',
  '  } else { $out.olcumHata="bellek yapisi deger dondurmedi" }',
  '} catch { $out.olcumHata="bellek yapisi: $($_.Exception.Message)" }',
  // Belgelendirilmis Windows performans sayaci ONCE denenir. Sayac okunamazsa (yerelleştirilmis
  // sistem, izin, kapali servis) AYNI yapidaki sayfa dosyasi alanlari kullanilir; secim `kaynak`
  // alaninda acikca yazilir. Deger HICBIR ZAMAN surec sayaclarindan toplanmaz.
  'try {',
  "  $c=(Get-Counter -Counter '\\Memory\\Committed Bytes','\\Memory\\Commit Limit' -MaxSamples 1 -ErrorAction Stop).CounterSamples",
  "  $cv=$c | Where-Object { $_.Path -match 'committed bytes' } | Select-Object -First 1",
  "  $lv=$c | Where-Object { $_.Path -match 'commit limit' } | Select-Object -First 1",
  '  if($cv -and $lv){ $out.serbestCommit=[uint64][math]::Round(($lv.CookedValue-$cv.CookedValue)); $out.sayfaSinir=[uint64][math]::Round($lv.CookedValue) }',
  "  else { $out.sayacHata='sayac degerleri okunamadi' }",
  '} catch { $out.sayacHata=[string]$_.Exception.Message }',
  'try {',
  '  $ps=Get-Process',
  '  $parent=@{}',
  '  foreach($p in $ps){ $parent[[int]$p.Id]=[int]$p.ParentProcessId }',
  '  $grup=@{}',
  '  foreach($p in $ps){ $n=([string]$p.ProcessName).ToLowerInvariant(); if(-not $grup.ContainsKey($n)){ $grup[$n]=@() }; $grup[$n]+=$p }',
  // ollama surec AGACI: kok + TUM soy (gercek yukleyici surecleri dâhil). Ad tahmini DEGIL.
  "  $kok=@(); foreach($n in @('ollama','ollama app','ollama-app')){ if($grup.ContainsKey($n)){ $kok+=$grup[$n] } }",
  '  $sec=New-Object "System.Collections.Generic.HashSet[int]"',
  '  foreach($p in $kok){ [void]$sec.Add([int]$p.Id) }',
  '  $degisti=$true; $tur=0',
  '  while($degisti -and $tur -lt 12){',
  '    $degisti=$false; $tur++',
  '    foreach($p in $ps){ $id=[int]$p.Id; if($sec.Contains($id)){ continue }',
  '      $par=0; if($parent.ContainsKey($id)){ $par=[int]$parent[$id] }',
  '      if($par -gt 0 -and $sec.Contains($par)){ [void]$sec.Add($id); $degisti=$true } }',
  '  }',
  '  $agac=@(); foreach($p in $ps){ if($sec.Contains([int]$p.Id)){ $agac+=$p } }',
  "  $adlar=@('ollama','ollama app','ollama-app','ollama_llama_server','llama-server','llamafile','koboldcpp','text-generation-launcher','vllm','lm-studio','lmstudio','jan','gpt4all','localai','comfyui','sglang')",
  '  $isim=@(); foreach($p in $ps){ $n=([string]$p.ProcessName).ToLowerInvariant(); if($adlar -contains $n){ $isim+=$p } }',
  // Agaçtaki süreçlerden kaçı TANINAN çalıştırıcı adını taşıyor: ağaç dışı artık = isim toplamı - bu.
  '  $eslesen=0; foreach($p in $agac){ $n=([string]$p.ProcessName).ToLowerInvariant(); if($adlar -contains $n){ $eslesen++ } }',
  '  $out.isimEslesen=$eslesen',
  '  $out.agacAdet=$agac.Count; $out.agacPb=[uint64](($agac | Measure-Object -Property PrivateMemorySize64 -Sum).Sum); $out.agacWs=[uint64](($agac | Measure-Object -Property WorkingSet64 -Sum).Sum)',
  '  $out.isimAdet=$isim.Count; $out.isimPb=[uint64](($isim | Measure-Object -Property PrivateMemorySize64 -Sum).Sum); $out.isimWs=[uint64](($isim | Measure-Object -Property WorkingSet64 -Sum).Sum)',
  "  $bl=@(); if($grup.ContainsKey('blender')){ $bl=$grup['blender'] }",
  '  $out.blenderAdet=$bl.Count; $out.blenderPb=[uint64](($bl | Measure-Object -Property PrivateMemorySize64 -Sum).Sum); $out.blenderWs=[uint64](($bl | Measure-Object -Property WorkingSet64 -Sum).Sum)',
  '} catch { $out.surecHata=[string]$_.Exception.Message }',
  '[Console]::Out.Write(($out | ConvertTo-Json -Compress -Depth 3))',
].join('\n')

/** Gövdeyi PowerShell'e base64/UTF-16LE olarak verir: tırnak ve kaçış tuzağı yok. */
export function kodla(govde: string): string[] {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(govde, 'utf16le').toString('base64')]
}

/** Ham sayaç JSON'undan sistem bloğunu kurar. Sayfa dosyası değerleri YALNIZ sayaç yokken kullanılır. */
export function sistemBloguYap(ham: Record<string, unknown> | null | undefined): BellekOlcumu['sunucu'] {
  const h = ham ?? {}
  const sayfaSinir = sayiYaNull(h.sayfaSinir)
  const serbestCommit = sayiYaNull(h.serbestCommit)
  const ramToplam = sayiYaNull(h.ramToplam)
  const ramKullanilan = sayiYaNull(h.ramKullanilan)
  const sayacHata = typeof h.sayacHata === 'string' ? h.sayacHata.trim() : ''
  // Sistem commit'i DOĞRUDAN Windows değerinden gelir; süreç sayaçlarından TOPLANMAZ.
  const commitSinir = sayfaSinir && sayfaSinir > 0 ? sayfaSinir : null
  const commitKullanilan = commitSinir !== null && serbestCommit !== null && serbestCommit <= commitSinir
    ? commitSinir - serbestCommit
    : null
  const commitKalan = commitKullanilan !== null && commitSinir !== null ? commitSinir - commitKullanilan : null
  const commitDoluluk = commitKullanilan !== null && commitSinir ? commitKullanilan / commitSinir : null
  return {
    ramToplamBayt: ramToplam && ramToplam > 0 ? ramToplam : null,
    ramKullanilanBayt: ramKullanilan !== null && (ramToplam ?? 0) > 0 && ramKullanilan <= (ramToplam as number) ? ramKullanilan : null,
    commitSinirBayt: commitSinir,
    commitKullanilanBayt: commitKullanilan,
    commitKalanBayt: commitKalan,
    commitDoluluk,
    // Sayaç okunamadıysa değer AYNI belgelenmiş yapının sayfa dosyası alanlarından gelir ve bu yazılır.
    kaynak: commitSinir === null ? 'bilinmiyor' : sayacHata ? 'sayfa-dosyasi' : 'sayac',
  }
}

/** Bir süreç grubu: adet ve iki sayaç. Toplanacak süreç yoksa `null` (uydurma sıfır yazılmaz). */
export function surecGrubuYap(etiket: string, adetHam: unknown, pbHam: unknown, wsHam: unknown, kaynak: 'agac' | 'isim'): BellekGrubu | null {
  const adet = Number(adetHam)
  if (!Number.isFinite(adet) || adet <= 0) return null
  const pb = sayiYaNull(pbHam)
  const ws = sayiYaNull(wsHam)
  const parca = [`${etiket} · ${adet} süreç`]
  parca.push(`commit ${pb === null ? 'bilinmiyor' : `${gbYaz(pb)} GB`}`)
  parca.push(`working set ${ws === null ? 'bilinmiyor' : `${gbYaz(ws)} GB`}`)
  return { etiket, adet, privateBayt: pb, workingSetBayt: ws, kaynak, metin: parca.join(' · ') }
}

/**
 * nvidia-smi CSV çıktısı → GPU BAŞINA liste. Her satır bir GPU'dur; satırlar BİRLEŞTİRİLMEZ
 * (çoklu GPU tek toplam gibi gösterilmez). Biçim: `index, name, used MiB, total MiB`.
 */
export function gpuListesiAyikla(cikti: unknown): GpuOlcumu[] {
  const satirlar = String(cikti ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  const liste: GpuOlcumu[] = []
  for (const satir of satirlar) {
    const parca = satir.split(',').map((s) => s.trim())
    if (parca.length < 4) continue
    const indeks = Number(parca[0])
    const ad = parca[1] || `GPU ${Number.isFinite(indeks) ? indeks : liste.length}`
    const kullanilanMb = Number(parca[2])
    const toplamMb = Number(parca[3])
    if (!Number.isFinite(kullanilanMb) || !Number.isFinite(toplamMb) || toplamMb <= 0) continue
    const kullanilanBayt = kullanilanMb * 1024 ** 2
    const toplamBayt = toplamMb * 1024 ** 2
    liste.push({
      indeks: Number.isFinite(indeks) ? indeks : liste.length,
      ad,
      kullanilanBayt,
      toplamBayt,
      metin: gbOran(kullanilanBayt, toplamBayt),
    })
  }
  return liste
}

/** Ham JSON'dan tam ölçüm nesnesi. Ana süreçte ağ/disk erişimi YOKTUR: saf dönüşüm (test edilir). */
export function olcumKur(ham: Record<string, unknown> | null | undefined, gpu: GpuOlcumu[], olcumAt: number, sureMs: number): BellekOlcumu {
  const h = ham ?? {}
  const notlar: string[] = []
  const olcumHata = typeof h.olcumHata === 'string' ? h.olcumHata.trim() : ''
  const surecHata = typeof h.surecHata === 'string' ? h.surecHata.trim() : ''
  if (olcumHata) notlar.push(`Sistem belleği okunamadı: ${olcumHata}`)
  if (surecHata) notlar.push(`Süreç sayaçları okunamadı: ${surecHata}`)
  const blender = surecGrubuYap('Blender', h.blenderAdet, h.blenderPb, h.blenderWs, 'isim')
  // Yerel model çalıştırıcıları: ÖNCE gerçek ollama süreç AĞACI, yoksa aynı çalıştırıcı adları.
  const agac = surecGrubuYap('Yerel model çalıştırıcıları', h.agacAdet, h.agacPb, h.agacWs, 'agac')
  const isim = surecGrubuYap('Yerel model çalıştırıcıları', h.isimAdet, h.isimPb, h.isimWs, 'isim')
  const model = agac ?? isim
  const diger: BellekGrubu[] = []
  // Ağaç kurulabildiği hâlde AĞAÇ DIŞINDA kalan tanınan çalıştırıcı süreçleri varsa (ör. ayrı
  // başlatılmış bir llama-server), bunlar "Yerel model çalıştırıcıları" toplamına KARIŞTIRILMAZ:
  // ayrı ve açıkça etiketlenmiş bir grup olarak yazılır. Ağacın içindeki süreçler iki kez sayılmaz.
  const agacEslesen = sayiYaNull(h.agacEslesen) ?? 0
  const artikAdet = isim ? Math.max(0, isim.adet - agacEslesen) : 0
  if (agac && isim && artikAdet > 0) {
    const etiket = 'Tanınan diğer yerel çalıştırıcılar (ağaç dışı)'
    const artik = surecGrubuYap(etiket, artikAdet, null, null, 'isim')
    if (artik) diger.push(artik)
  }
  if (gpu.length === 0) notlar.push('VRAM ölçülemedi (nvidia-smi yok veya GPU yok).')
  return {
    olcumAt,
    sureMs,
    sunucu: sistemBloguYap(h),
    gpu,
    blender,
    model,
    digerCalistiricilar: diger,
    notlar,
  }
}

export type BellekOlcumuKaynagi = () => Promise<BellekOlcumu>

export type BellekOlcumuGirdisi = {
  /** Ölçümü yapan asenkron kaynak (test edilebilirlik için dışarıdan verilebilir). */
  olc?: BellekOlcumuKaynagi
  /** Ölçüm aralığı (ms). Varsayılan 3 sn. */
  aralikMs?: number
  zamanAsimiMs?: number
  /** Süreç çalıştırıcı: yalnız testte değiştirilir. */
  calistir?: (govde: string, zamanAsimiMs: number) => Promise<{ cikti: string }>
  simdi?: () => number
  /** Kart değişince çağrılır. Hata fırlatsa bile ölçüm döngüsü ETKİLENMEZ. */
  dinleyici?: (olcum: BellekOlcumu, onceki: BellekOlcumu | null) => void
  /** Ölçüm başarısız olduğunda çağrılır; döngü devam eder. */
  hataDinleyici?: (hata: OlcumHatasi, sonGecerli: BellekOlcumu | null) => void
  /** Ölçüm günlüğü: her örnek DEĞİL, yalnız değişen/açılan durumlar (main karar verir). */
  gunluk?: (satir: string) => void
}

export type BellekOlcumuDongusu = {
  olcum(): BellekOlcumu | null
  /** Son ölçüm hatası (yoksa null) — "hata kaydında örneğin yaşı belli olsun" için. */
  sonHata(): OlcumHatasi | null
  /** Ölçüm sürüyor mu (üst üste sorgu başlatılmadığının kanıtı). */
  olcuyor(): boolean
  basla(): void
  dur(): void
}

/**
 * PowerShell çağrısı: ASENKRON, `windowsHide`, kısa zaman sınırı. Zaman aşımında süreç AĞACIYLA
 * öldürülür ki arkada asılı kalan bir ölçüm süreci birikmesin. Hata fırlatmaz.
 */
export function psCalistir(govde: string, zamanAsimiMs: number): Promise<{ cikti: string }> {
  return new Promise((resolve) => {
    let bitti = false
    let cocuk: ReturnType<typeof spawn> | null = null
    const bitir = (cikti: string) => {
      if (bitti) return
      bitti = true
      resolve({ cikti })
    }
    try {
      cocuk = spawn('powershell.exe', kodla(govde), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      bitir('')
      return
    }
    let tampon = ''
    cocuk.stdout?.setEncoding('utf8')
    cocuk.stdout?.on('data', (parca: string) => { if (tampon.length < 1_000_000) tampon += parca })
    cocuk.stderr?.on('data', () => { /* ölçüm hatası kart/günlük üzerinden raporlanır */ })
    cocuk.on('error', () => bitir(''))
    cocuk.on('close', () => bitir(tampon))
    const zaman = setTimeout(() => {
      const pid = cocuk?.pid
      if (pid) {
        // Ağaç hâlinde öldür: asılı kalan ölçüm süreci bir sonraki ölçümü kilitlemesin.
        try {
          const oldurucu = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
          oldurucu.on('error', () => { try { cocuk?.kill() } catch { /* zaten gitti */ } })
          oldurucu.on('close', () => { try { cocuk?.kill() } catch { /* zaten gitti */ } })
        } catch {
          try { cocuk?.kill() } catch { /* zaten gitti */ }
        }
      }
      bitir(tampon)
    }, Math.max(500, zamanAsimiMs))
    cocuk.on('close', () => clearTimeout(zaman))
  })
}

/** nvidia-smi: GPU BAŞINA kullanılan/toplam. Asenkron, `windowsHide`, kısa sınır; yoksa boş liste. */
export function gpuOlc(zamanAsimiMs = 2500): Promise<GpuOlcumu[]> {
  return new Promise((resolve) => {
    let bitti = false
    let cocuk: ReturnType<typeof spawn> | null = null
    const bitir = (liste: GpuOlcumu[]) => { if (!bitti) { bitti = true; resolve(liste) } }
    try {
      cocuk = spawn('nvidia-smi', ['--query-gpu=index,name,memory.used,memory.total', '--format=csv,noheader,nounits'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      bitir([])
      return
    }
    let tampon = ''
    cocuk.stdout?.setEncoding('utf8')
    cocuk.stdout?.on('data', (parca: string) => { if (tampon.length < 200_000) tampon += parca })
    cocuk.on('error', () => bitir([]))
    cocuk.on('close', () => bitir(gpuListesiAyikla(tampon)))
    const zaman = setTimeout(() => {
      try { cocuk?.kill() } catch { /* zaten gitti */ }
      bitir([])
    }, Math.max(300, zamanAsimiMs))
    cocuk.on('close', () => clearTimeout(zaman))
  })
}

/** Varsayılan ölçüm: sistem/süreç sayaçları (tek PowerShell) + GPU, paralel ve asenkron. */
export function varsayilanOlcum(zamanAsimiMs = BELLEK_ZAMAN_ASIMI_MS): BellekOlcumuKaynagi {
  return async () => {
    const basi = Date.now()
    const [ps, gpu] = await Promise.all([psCalistir(OLCUM_BETIGI, zamanAsimiMs), gpuOlc(2500)])
    let ham: Record<string, unknown> = {}
    try {
      const metin = ps.cikti.slice(ps.cikti.indexOf('{'))
      if (metin) ham = JSON.parse(metin) as Record<string, unknown>
    } catch {
      // Bozuk/eksik çıktı = ölçüm başarısız: son geçerli değer "eski" olarak işaretlenir.
      throw new Error('Bellek ölçümü okunamadı (sayaç çıktısı çözümlenemedi).')
    }
    return olcumKur(ham, gpu, Date.now(), Date.now() - basi)
  }
}

/**
 * ÖLÇÜM DÖNGÜSÜ. Kurallar:
 *   · Önceki ölçüm bitmeden yenisi BAŞLATILMAZ (`olcuyor()` iken zamanlayıcı atlar).
 *   · Hata uygulamayı ETKİLEMEZ: son geçerli ölçüm korunur, `sonHata()` yaşıyla raporlanır.
 *   · `dur()` timer'ı ve bekleyen işi bırakır; kapanan bir ölçüm sonradan kart YAZMAZ.
 */
export function bellekOlcumDongusu(girdi: BellekOlcumuGirdisi = {}): BellekOlcumuDongusu {
  const olc = girdi.olc ?? varsayilanOlcum(girdi.zamanAsimiMs ?? BELLEK_ZAMAN_ASIMI_MS)
  const aralik = Math.max(1000, girdi.aralikMs ?? BELLEK_OLCUM_MS)
  const simdi = girdi.simdi ?? (() => Date.now())
  let son: BellekOlcumu | null = null
  let hata: OlcumHatasi | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let calisiyor = false
  let durdu = true
  let nesil = 0

  const guvenli = (fn: (() => void) | undefined) => {
    if (!fn) return
    try { fn() } catch { /* dinleyici hatası ölçümü durdurmaz */ }
  }

  async function olcVeYayinla() {
    if (calisiyor) return
    calisiyor = true
    const benim = nesil
    try {
      const yeni = await olc()
      if (durdu || benim !== nesil) return
      const onceki = son
      son = yeni
      hata = null
      guvenli(() => girdi.dinleyici?.(yeni, onceki))
    } catch (e) {
      if (durdu || benim !== nesil) return
      const kayit: OlcumHatasi = { at: simdi(), mesaj: e instanceof Error ? e.message : String(e) }
      hata = kayit
      // Son geçerli ölçüm KORUNUR: kart onu "eski ölçüm" diye yaşıyla gösterir. Hata fırlatılmaz.
      guvenli(() => girdi.hataDinleyici?.(kayit, son))
    } finally {
      calisiyor = false
    }
  }

  const zamanla = () => {
    if (durdu) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void olcVeYayinla().finally(zamanla)
    }, aralik)
  }

  return {
    olcum: () => son,
    sonHata: () => hata,
    olcuyor: () => calisiyor,
    basla() {
      if (!durdu) return
      durdu = false
      nesil++
      void olcVeYayinla().finally(zamanla)
    },
    dur() {
      durdu = true
      nesil++
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      // Bekleyen ölçüm sonucu artık kart yazmaz (`durdu`/nesil denetimi); süreç zaman aşımıyla ölür.
    },
  }
}

/**
 * GÜNLÜK KURALI (kullanıcı isteği): her 3 saniyede tüm ölçüm DİSKE YAZILMAZ. Yalnız
 *   (1) çalıştırma başlangıcı, (2) uyarı eşiği GEÇİŞLERİ, (3) hata anı
 * kaydedilir. Bu fonksiyon karar verir; yazma işini çağıran yapar (saf, test edilir).
 */
export type GunlukKarari =
  | { yaz: true; neden: 'baslangic' | 'esik' | 'hata'; satir: string }
  | { yaz: false; neden: 'yok' }

export const COMMIT_UYARI_ESIGI = 0.9

/** Commit doluluğu %90 ve üstünde mi. GÖSTERGE eşiğidir; çökme tahmini veya garanti DEĞİLDİR. */
export function commitDaraliyor(o: BellekOlcumu['sunucu'] | null | undefined): boolean {
  const d = o?.commitDoluluk
  return typeof d === 'number' && Number.isFinite(d) && d >= COMMIT_UYARI_ESIGI
}

/** Ölçümün tek satırlık günlük biçimi (zaman damgası ÇAĞIRAN tarafından eklenir). */
export function olcumGunlukSatiri(o: BellekOlcumu, etiket: string): string {
  const s = o.sunucu
  const gpu = o.gpu.length ? o.gpu.map((g) => `${g.ad} ${g.metin}`).join(' | ') : 'bilinmiyor'
  const parca = [
    `${etiket}`,
    `RAM ${gbOran(s.ramKullanilanBayt, s.ramToplamBayt)}`,
    `bütçe ${gbOran(s.commitKullanilanBayt, s.commitSinirBayt)} (kaynak: ${s.kaynak})`,
    `kalan ${s.commitKalanBayt === null ? 'bilinmiyor' : `${gbYaz(s.commitKalanBayt)} GB`}`,
    `VRAM ${gpu}`,
    o.blender ? o.blender.metin : 'Blender süreci yok',
    o.model ? o.model.metin : 'Yerel model çalıştırıcısı yok',
  ]
  if (s.commitDoluluk !== null) parca.push(`doluluk %${(s.commitDoluluk * 100).toFixed(0)}`)
  return parca.join(' · ')
}

/**
 * Günlük yazma kararı. `son` önceki kararın durumu; eşik GEÇİŞİ (altına inme/üstüne çıkma) yazılır,
 * eşikte kalmak her örnekte tekrar yazılmaz. Hata anı HER ZAMAN yazılır ve örneğin YAŞI yazılır.
 */
export function gunlukKarari(
  durum: { esikte: boolean; baslangicYazildi: boolean },
  olay: { tur: 'baslangic' } | { tur: 'olcum'; olcum: BellekOlcumu } | { tur: 'hata'; hata: OlcumHatasi; sonGecerli: BellekOlcumu | null },
): GunlukKarari {
  if (olay.tur === 'baslangic') {
    durum.baslangicYazildi = true
    return { yaz: true, neden: 'baslangic', satir: 'Bellek ölçümü başladı.' }
  }
  if (olay.tur === 'hata') {
    const yas = olay.sonGecerli ? `son geçerli örnek ${Math.max(0, olay.hata.at - olay.sonGecerli.olcumAt)} ms önce alındı` : 'geçerli örnek yok'
    return { yaz: true, neden: 'hata', satir: `Bellek ölçümü başarısız: ${olay.hata.mesaj} · ${yas}` }
  }
  const dar = commitDaraliyor(olay.olcum.sunucu)
  const gecis = dar !== durum.esikte
  durum.esikte = dar
  if (!gecis) return { yaz: false, neden: 'yok' }
  return {
    yaz: true,
    neden: 'esik',
    satir: dar
      ? `Bellek bütçesi daralıyor: doluluk %${((olay.olcum.sunucu.commitDoluluk ?? 0) * 100).toFixed(0)} (gösterge eşiği %90; çökme tahmini değil).`
      : `Bellek bütçesi eşiğin altına indi: doluluk %${((olay.olcum.sunucu.commitDoluluk ?? 0) * 100).toFixed(0)}.`,
  }
}

// ---------------------------------------------------------------------------
// KART: yalnız gösterim. Kart nesnesi ölçümden ÜRETİLİR; günlük metni ayrıştırılmaz.
// ---------------------------------------------------------------------------

export type BellekKarti = {
  /** Kısa bölüm 1. satır: "RAM 12,1 / 15,8 GB · VRAM 9,2 / 12,0 GB". */
  ramVram: string
  /** Kısa bölüm 2. satır: "Bellek bütçesi 43,0 / 50,0 GB · kalan 7,0 GB". */
  butce: string
  /** GPU başına ayrı satırlar (çoklu GPU birleştirilmez). */
  gpuSatirlari: string[]
  /** Ayrıntı satırları: Blender ve model süreç sayaçları. */
  surecSatirlari: string[]
  /** Süreç toplamlarının ne olduğunu söyleyen kullanıcı açıklamaları. */
  aciklamalar: string[]
  /** Commit doluluğu %90+ ise true: "Bellek bütçesi daralıyor" gösterilir. */
  daraliyor: boolean
  /** Uyarı metni (yoksa boş). GÖSTERGE eşiğidir; çökme tahmini/garanti değildir. */
  uyari: string
  /** Ölçüm var mı (yoksa kart "bilinmiyor" satırlarıyla yine çizilir). */
  olcumVar: boolean
  /** Ölçüm "eski" mi (yaş > BELLEK_ESKI_MS ya da hata sonrası). */
  eski: boolean
  /** "3 sn önce ölçüldü" / "ölçüm zamanı bilinmiyor". */
  yas: string
  /** Ölçüm hatası varsa kısa metin (kartta gösterilir; uygulama etkilenmez). */
  hata: string
  /** Kartta gösterilecek TÜM satırlar (masaüstü ve telefon aynı nesneyi kullanır). */
  satirlar: string[]
}

/** Ölçüm "eski" sayılma sınırı: bu yaştan sonra değer GÜNCEL gibi sunulmaz. */
export const BELLEK_ESKI_MS = 3 * BELLEK_OLCUM_MS

/** Ölçüm yaşı: "az önce ölçüldü" / "12 sn önce ölçüldü" / "3,4 dk önce ölçüldü". */
export function olcumYasiYaz(olcumAt: number | null | undefined, simdi: number): string {
  if (typeof olcumAt !== 'number' || !Number.isFinite(olcumAt) || olcumAt <= 0) return 'ölçüm zamanı bilinmiyor'
  const fark = Math.max(0, simdi - olcumAt)
  const sn = fark / 1000
  if (sn < 2) return 'az önce ölçüldü'
  if (sn < 60) return `${sn.toFixed(0)} sn önce ölçüldü`
  const dk = sn / 60
  if (dk < 60) return `${dk.toFixed(1).replace('.', ',')} dk önce ölçüldü`
  return `${(dk / 60).toFixed(1).replace('.', ',')} sa önce ölçüldü`
}

export type BellekKartiGirdisi = {
  olcum: BellekOlcumu | null
  hata?: OlcumHatasi | null
  simdi: number
}

/**
 * Ölçümden kart nesnesi. Kullanıcı terimleri KORUNUR:
 *   · "RAM: fiziksel bellek."   · "Bellek bütçesi: Windows'un RAM ve sayfa dosyasıyla karşılayabildiği bellek."
 * Süreç commit'i FİZİKSEL RAM diye etiketlenmez; sistem commit'i süreç toplamından üretilmez.
 */
export function bellekKartiYap(g: BellekKartiGirdisi): BellekKarti {
  const o = g.olcum
  const s = o?.sunucu
  const ramVram = o
    ? `RAM ${gbOran(s?.ramKullanilanBayt, s?.ramToplamBayt)}${o.gpu.length ? ` · VRAM ${o.gpu.length === 1 ? o.gpu[0].metin : o.gpu.map((x) => x.metin).join(' | ')}` : ' · VRAM bilinmiyor'}`
    : 'RAM bilinmiyor · VRAM bilinmiyor'
  const butce = o
    ? `Bellek bütçesi ${gbOran(s?.commitKullanilanBayt, s?.commitSinirBayt)} · kalan ${s?.commitKalanBayt === null || s?.commitKalanBayt === undefined ? 'bilinmiyor' : `${gbYaz(s.commitKalanBayt)} GB`}`
    : 'Bellek bütçesi bilinmiyor · kalan bilinmiyor'

  const gpuSatirlari = o
    ? o.gpu.map((x) => `${x.ad} (GPU ${x.indeks}) VRAM ${x.metin}`)
    : []
  if (o && o.gpu.length === 0) gpuSatirlari.push('VRAM: bilinmiyor (nvidia-smi okunamadı)')

  const surecSatirlari: string[] = []
  if (o) {
    surecSatirlari.push(o.blender ? o.blender.metin : 'Blender süreci bulunamadı')
    surecSatirlari.push(o.model ? o.model.metin : 'Yerel model çalıştırıcısı bulunamadı')
    for (const d of o.digerCalistiricilar) surecSatirlari.push(d.metin)
    if (s?.commitDoluluk !== null && s?.commitDoluluk !== undefined) surecSatirlari.push(`Bütçe doluluğu %${(s.commitDoluluk * 100).toFixed(0)} (kaynak: ${s.kaynak === 'sayac' ? 'Windows performans sayacı' : s.kaynak === 'sayfa-dosyasi' ? 'Windows bellek yapısı / sayfa dosyası' : 'bilinmiyor'})`)
    for (const n of o.notlar) surecSatirlari.push(n)
  }

  const aciklamalar = [
    'RAM: fiziksel bellek.',
    'Bellek bütçesi: Windows’un RAM ve sayfa dosyasıyla karşılayabildiği bellek.',
    'Süreç commit’i (private bytes) fiziksel RAM kullanımı değildir; sayfa dosyasına taşınan sayfaları da içerir.',
    'Working set toplamı ortak (paylaşılan) sayfaları birden çok kez sayabilir; bu yüzden toplamlar yaklaşıktır.',
    'Sistem bellek bütçesi doğrudan Windows sayacından okunur; süreç sayaçları toplanarak üretilmez.',
  ]

  const daraliyor = commitDaraliyor(s)
  const uyari = daraliyor ? 'Bellek bütçesi daralıyor' : ''
  const eski = !!o && (g.simdi - o.olcumAt > BELLEK_ESKI_MS || !!g.hata)
  const yas = olcumYasiYaz(o?.olcumAt, g.simdi)
  const hata = g.hata ? `${g.hata.mesaj} (${olcumYasiYaz(g.hata.at, g.simdi)} denendi)` : ''

  const satirlar = [ramVram, butce]
  if (eski && o) satirlar.push(`Eski ölçüm · ${yas}`)
  if (!o) satirlar.push('Ölçüm: bilinmiyor')
  if (hata) satirlar.push(`Ölçüm hatası: ${hata}`)
  satirlar.push(...gpuSatirlari.filter((x) => o && o.gpu.length > 1), ...surecSatirlari)

  return {
    ramVram,
    butce,
    gpuSatirlari,
    surecSatirlari,
    aciklamalar,
    daraliyor,
    uyari,
    olcumVar: !!o,
    eski,
    yas,
    hata,
    satirlar,
  }
}
