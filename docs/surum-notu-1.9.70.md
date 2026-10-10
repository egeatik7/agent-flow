# Sürüm notu — 1.9.70 (paket çıkışı + iç içe döngüden devam: 1.9.63'te AÇIK kalan iki hata kapandı)

Kaynak: `Nubbo-Paket-Dongu-Duzeltmeleri-1.9.64`. `KURULUM.txt` üç patch veriyor ✓: **`update.patch`** →
**1.9.63 / `5029f5a`** ✓ (= benim 1.9.69 içeriğim ✓); `from-1.9.62.patch` → 1.9.62 ✗; `cumulative` → `6edcdcc` ✗.
Ölçüm ✓: **update düz `--check` = 0** (yalnız `package.json`/`package-lock.json` hariç ✓ — orada **tek fark
sürüm satırı** ✓, 1.9.63 → 1.9.64 ✗); diğer iki patch **uygulanamaz** ✗ (tabanlar daha eski ✓) → **yalnız
update**, **zorlamadan** ✓; `git diff --check` **0** ✓.

## Kapanan hata 1 — koşullu paket çıkışı ✗→✓
- Dış devam için **`packageExit` kaydının node'u VE çıkış portu fiilen seçilmiş olmalı** ✓;
  aksi hâlde paketin **dış sonraki adımı çalışmaz** ✓ (yanlış koşul dalı ✗ / iç alternatif adım ✗ → geçmez ✗).
- **Her ziyaret** kayıtlı çıkışın sonucunu **günceller** ✓ → sonraki bir **"yok"**, önceki **"var"** iznini
  **kaldırır** ✓.
- Paketleme sırasında **kaldırılmış dış bağlantı**, kayıtlı sınırla eşleşirse **çağıran paketin bağlantısı**
  sayılır ✓ (mevcut başarısızlık işleyicisi çalışır ✓).
- **Paket içindeki Bitiş**, kayıtlı çıkışı olan pakette **dış devam izni vermez** ✓.
- **Çıkış node'u silinmişse** → **dış devam verilmez** ✓; node kimliği veya JSON **yeniden yazılmaz** ✓.

## Kapanan hata 2 — iç içe döngüde seçilenden devam ✗→✓
- Seçilen node'a giden **döngü yolu yalnız İLK ilgili turda** taşınır ✓; **yeni iç/dış turlar normal
  başlangıçlarını** kullanır ✓ (B'den devam edilince sonraki dosyalarda A **atlanmaz** ✓).
- Döngüler **dıştan içe** açılmaya devam eder ✓; yalnız **iç başlangıç bilgisi** aşağı aktarılır ✓.
- Devam yolu, ilgili iç döngü çağrılmadan **önce tüketilir** ✓ (geri bağlantıda ikinci kez uygulanmaz ✓).
- **Dosya kimliği koşu boyunca yalnız bir kez** uygulanır ✓; sonraki döngü çağrıları kendi normal
  işaretlerini kullanır ✓.
- İç döngüden çıkarken **üst döngünün mevcut turu ve sonraki turları tamamlanır** ✓ (tüm üst katmanlarda ✓).

## JSON uyumluluğu (paketin açık beyanı)
- **JSON formatı ve kayıt işlemi DEĞİŞMEDİ** ✓; dosyalar topluca dönüştürülmez ✓, düğümler yeniden
  kimliklendirilmez ✓, bağlantılar yeniden kurulmaz ✓; yeni devam bilgileri **yalnız motorun koşu
  seçeneklerinde** tutulur ✓.
- **Çıkış kaydı OLMAYAN eski/elle yapılmış paketler eskisi gibi çalışır** ✗ — motor **tahmin yürütmez** ✓;
  böyle bir pakette hangi dalın dışarı devam edeceği JSON'dan belirlenemiyorsa **bu güncelleme onu
  kendiliğinden onaramaz** ✗ → **böyle bir paketi yeniden paketlemeniz gerekir** ✓.
- **Stop, adım limitleri, hata yakalama ve kurtarma ajanı eylem yetkileri GENİŞLETİLMEDİ** ✓.

## Doğrulama — paketin kaynağıyla birebir
- **3/3 dosya «İÇERİK AYNI»** ✓ (`docs/paket-dongu-duzeltmeleri-1.9.64.md` ✓,
  `docs/bug-duzeltmeleri-1.9.63.md` ✓, `electron/runner.ts` ✓); **`package.json`: tek fark sürüm satırı** ✓.
- Yeni test ✓: `tests/package-boundary-nested-entry.test.ts` ✓.
- `typecheck` ✓ · `build:electron` ✓ · **Vitest 78 dosya / 575 test** ✓ (paketin 570'i + Windows'a bağlı
  5 atlamanın tamamı ✓) · **beş npm paketi** ✓ · **sekiz Node regresyon 117/0** ✓ · `pack:win` ✓ · exe hash ✓.

## Doğrulanmayan (dürüst)
- **Canlı Windows masaüstü ve kullanıcının TÜM kişisel JSON dosyaları burada çalıştırılmadı** ✗ (paketin
  de yazdığı sınır ✓).
- **Tüm olası akışların hatasız olduğu veya sıfır risk garantisi YOK** ✗ (paketin açık beyanı ✓).
- **Elle yapılmış, çıkış kaydı olmayan** paketlerde koşullu çıkış **hâlâ eski davranışta** ✗ (tasarım
  gereği ✓) → kullanıcının böyle bir paketi **yeniden paketlemesi** gerekir ✓.