# Sürüm notu — 1.9.90 (**kütüphane tek SQLite dosyası** + sekme/otomasyon düzeltmeleri)

**Kaynak** ✓: `Nubbo_1.9.90_update.patch` ✓ (SHA256 `e6e31712…` ✓). Paketin rehberi **“tek patch seçin”** diyor ✓:
*“kaynağınız `1211be9` ise **update.patch**, `origin/main 82113e7` ise **main.patch**”* ✓ — benim ağacım **1.9.88 (XP kütüphane)**
+ **1.9.89 (tablet)** işlerini zaten içerdiği için **doğru seçim `update.patch`** oldu ✓. `main.patch` (51 dosya ✓)
**birikimli** ✗ ve **uygulanmadı** ✗ (`android-viewer/…: already exists` hatası veriyor ✓).

**Uygulama** ✓: `git apply --exclude=package-lock.json` ✓ ile uygulandı ✓; tek çatışma `package-lock.json:1` ✓ idi çünkü
benim lock'um **1.9.89'da `npm install` ile yeniden üretilmişti** ✓. `package.json` farkı **incelendi** ✓ ve **yalnız sürüm
satırı değil** ✓: **`1.9.89 → 1.9.90`** ✓ + **`sql.js ^1.14.2`** ✓ (runtime) + `@types/sql.js ^1.4.11` ✓ (dev) →
`npm install` **3 paket** ✓ kurdu ve lock'u yeniden üretti ✓. **17 dosya** ✓ (14 değişen ✓ + `electron/library-database.ts` ✓ +
`docs/LIBRARY-1.9.90.md` ✓ + `tests/canvas-tab-drag.test.ts` ✓).

## Gelen (`Degisiklikler.md`'den ✓)
1. **Kütüphane artık `Nubbo.library` adlı gerçek SQLite dosyası** ✓: klasörler ✓, tuvaller ✓, otomasyonlar ✓ ve otomasyon
   sırası ✓ **ayrı tablolarda** ✓, bağlantılar **yabancı anahtarlarla** doğrulanır ✓; node grafikleri eski akışlarla
   uyumluluk için tuval kaydının **içerik alanında JSON** olarak serileştirilir ✓.
2. **Eski `nubbo-library.json` otomatik aktarılır** ✓; tuval/node/otomasyon **kimlikleri ve klasör bağlantıları korunur** ✓;
   özgün JSON **`Backups/Legacy-…json`** olur ✓; **bozuk kaynak veya veritabanı üzerine BOŞ kütüphane yazılmaz** ✓.
3. **Kilit ve başka yazar algılama** ✓: yeni veritabanı **geçici dosya + fsync + atomik değiştirme** ile yayınlanır ✓;
   eski veritabanının **yedeği** tutulur ✓; **başarısız disk kaydında önceki sürüm korunur** ✓; **son 30 normal yedek** ✓ ve
   **eski JSON aktarım yedeği bu temizliğe dahil edilmez** ✓.
4. **Dosya yöneticisi** ✓: **Shift** aralık ✓, **Ctrl** çoklu ✓ ve **boş alandan kutuyla seçim** ✓; çoklu seçim **birlikte
   taşınır** ✓; klasörde bekleyen sürükleme **klasörü açar** ✓; boş alana bırakmak **ana klasöre** taşır ✓; alt öğeler
   üstleriyle seçildiğinde **klasör yapısı bozulmaz** ✓; **tablet görünümünde düzenleme açılmaz** ✓.
5. **Otomasyon taslağı** ✓: yeni taslak **doğrudan seçilen klasörde** görünür ✓ ve kayıt sonrası **aynı yerde** kalır ✓;
   kayıtlı taslak **aynı disk işleminde** güncellenir ✓; yeniden açılışta **eski yeni-otomasyon taslağı geri gelmez** ✓;
   başka otomasyonun sağ tık menüsünden **açık editörün yanlışlıkla kaydedilmesi engellenir** ✓.
6. **Üst sekmeler** ✓: **ayrı renkler** ✓, **sürükleyerek sıralama** ✓, **sağ-sol oklar KALDIRILDI** ✓ (yalnız kapatma ✗ ✓),
   yeni ad sınırı **24 karakter** ✓; **eski uzun adların tam metni ve kimlikleri korunur** ✓ (ekranda kısaltılır ✓).
7. **Paylaşım** ✓: programı kapatıp **kütüphane klasörünü** gönder ✓ veya **Farklı Klasöre Kaydet…** ✓ / **Başka Kütüphane
   Aç…** ✓; **JSON akış/otomasyon içe-dışa aktarma sürer** ✓; **önceki Android APK bu PC sürümüne bağlanabilir** ✓ ve
   güncel izleme arayüzünü **PC'den alır** ✓.

## Doğrulama
`typecheck` ✓ · `build:electron` ✓ · **Vitest 101 dosya / 746 test** ✓ (paketin iddiası **741** ✓; fazlası benim ek
testlerim ✓) · **beş npm paketi** ✓ (skip: recovery **12** ✓, stability **9** ✓ = eski İnisiyatif motorunun emekli testleri ✓) ·
**sekiz Node regresyon 97/0 + 21 skip** ✓ · **PS 5.1'de 10 harness** ✓ (**paket bunları koşmadı** ✗) · `pack:win` ✓ ·
**masaüstü kopyası hash ile doğrulandı** ✓ · **ASAR'ın içinden** izler ölçüldü ✓.

## Bilinçli sapma ✗
Paket *“GitHub'a yazma erişimi yok”* diyor ✗ → **senin otomatik yayın kuralın** gereği **`main`'e commit + etiket + push**
yapıldı ✓. Başka sapma **yok** ✗ (sürüm numarası paketin istediği gibi **1.9.90** ✓).

## Doğrulanmayan (dürüst ✗)
- **Fiziksel Windows/Android etkileşimi denenmedi** ✗ (paketin `Dogrulama.json`'u da
  *“physicalWindowsInteraction: not tested”* diyor ✓).
- **SQLite aktarımı ve gerçek disk hataları** yalnız **otomatik testlerle** ve **bağımsız bir SQLite okuyucuyla** doğrulandı ✓
  — **canlı profilde denenmedi** ✗ (yani gerçek `nubbo-library.json` → `Nubbo.library` geçişi **kanıtlanmadı** ✗).
- Paketin `Dogrulama.json`'undaki exe **`sha256` (`05ee31ba…`) benim derlememle aynı olmayacak** ✗ (farklı makine/zaman ✓);
  benim exe **aynı kaynaktan** üretildi ✓.
- **APK hâlâ hiçbir pakette yok** ✗ → **yalnız PC tarafı** teslim edildi ✓.