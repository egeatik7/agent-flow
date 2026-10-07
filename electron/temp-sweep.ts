/**
 * Portable çalıştırmanın %TEMP% klasörlerini süpürme kuralı — SAF fonksiyon.
 *
 * Neden var: `Nubbo-1.9.26.exe` gibi **portable** paket, her açılışta kendini
 * `%TEMP%\<rastgele>\Nubbo Agent Studio.exe` altına açar (~330 MB) ve **normal çıkışta** bu
 * klasörü siler. Ama süreç **zorla öldürülürse** (geliştirme döngüsü `taskkill /T /F` kullanıyor)
 * stub silemez → klasör kalır. Ölçüldü: 5 günde 16 klasör · 4,93 GB; disk 10,7 GB boştu.
 *
 * Kural kasıtlı olarak dar: yalnız (1) içinde BİZİM exe'miz, (2) çıkarma yükü (resources.pak ya da
 * app-64.7z), (3) portable rastgele ad deseni olan, (4) **kendi klasörümüz olmayan** ve
 * (5) yeterince **eski** (yeni açılmış bir örneği öldürmemek için) klasörler seçilir.
 * Başka uygulamaların geçici klasörlerine dokunulmaz.
 */

export type GeciciGirdi = {
  /** Klasör adı (portable'da 20-40 karakterlik rastgele harf/rakam). */
  ad: string
  /** Tam yol. */
  yol: string
  /** İçinde `Nubbo Agent Studio.exe` var mı. */
  exeVar: boolean
  /** İçinde çıkarma yükü var mı: `resources.pak` ya da `app-64.7z`. */
  yukVar: boolean
  /** Klasörün son değişim zamanı (ms). */
  mtimeMs: number
}

/** Varsayılan koruma süresi: yeni açılmış bir örneğin klasörü 10 dakika korunur. */
export const KORUMA_MS = 10 * 60_000

/**
 * Bayat (silinebilir) çıkarma klasörlerini seçer.
 *
 * @param girdiler `%TEMP%` altındaki klasörlerin ölçülmüş hâli
 * @param opts `now` (şimdi), `ownDir` (bu sürecin çalıştığı klasör), `keepMs` (koruma süresi)
 */
export function bayatCikarmaKlasorleri(
  girdiler: GeciciGirdi[],
  opts: { now: number; ownDir?: string; keepMs?: number }
): GeciciGirdi[] {
  const koruma = typeof opts.keepMs === 'number' ? opts.keepMs : KORUMA_MS
  const kendi = (opts.ownDir ?? '').replace(/[\\/]+$/, '').toLowerCase()
  return girdiler.filter((g) => {
    // En güçlü kimlik BİZİM exe'mizdir; pp-64.7z başka Electron uygulamalarında da bulunur, o
    // yüzden tek başına ölçüt değildir. Yarım kalmış çıkarmalar da (yalnız exe) temizlenir.
    if (!g.exeVar) return false
    if (!/^[A-Za-z0-9]{20,40}$/.test(g.ad)) return false
    if (kendi && g.yol.replace(/[\\/]+$/, '').toLowerCase() === kendi) return false
    if (opts.now - g.mtimeMs < koruma) return false
    return true
  })
}

/**
 * `%TEMP%` kökünden girdi listesi kurar (dosya sistemi erişimi burada, kural yukarıda kalır).
 * `readdir`/`exists` enjekte edilebilir, böylece kural tek başına test edilebilir.
 */
export function geciciGirdileriTopla(opts: {
  tempDir: string
  adlar: string[]
  varMi: (yol: string) => boolean
  mtimeMs: (yol: string) => number
}): GeciciGirdi[] {
  const birlestir = (a: string, b: string) => `${a.replace(/[\\/]+$/, '')}\\${b}`
  return opts.adlar.map((ad) => {
    const yol = birlestir(opts.tempDir, ad)
    return {
      ad,
      yol,
      exeVar: opts.varMi(birlestir(yol, 'Nubbo Agent Studio.exe')),
      yukVar: opts.varMi(birlestir(yol, 'resources.pak')) || opts.varMi(birlestir(yol, 'app-64.7z')),
      mtimeMs: opts.mtimeMs(yol),
    }
  })
}
