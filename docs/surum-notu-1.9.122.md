# Sürüm notu — 1.9.122 (görsel hedefte fare taşıma ve konum onayı)

**Kaynak paket:** `Nubbo_Gorsel_Fare_Onayi_1.9.120\nubbo-gorsel-fare-onayi.patch`
(SHA256 `5F24FE85B0DC6C94D461DF0FE271B88921B19878EA56F681FD44A3190E68F13C`).

**Taban/numara:** paketin tabanı **1.9.119** (`75c05bf`) ve kendi numarası 1.9.120; bizim `main` 1.9.121
olduğu için (1.9.120 numarasını biz farklı içerikle yayınlamıştık) sürüm **1.9.122** olarak ilerletildi.

## Uygulama

- `git apply --check` **yalnız iki dosyada** çakıştı: `package.json` ve `package-lock.json` (sürüm satırları).
  Paketin geri kalanı **zorlamadan** temiz uygulandı; sürüm dosyaları `--3way` ile alındı, çakışma
  **yalnız sürüm satırlarıydı** ve **bizim numaralandırma korundu** (sonra 1.9.122'ye çekildi).
- Paketin kendi talimatı (UYGULAMA.md) gereği: UIA/OCR seçim yoluna, eski tuval JSON'larına ve Koşul
  davranışına dokunulmadı; dosyalar toplu kopyalamayla ezilmedi; sürüm geriye çekilmedi.
- Android/APK bu iş için gerekmiyor (paketin kendi notu).

## Doğrulama

- `npm run typecheck` ✓ · **Vitest 118 dosya / 902 geçti / 0 kırmızı** (paketin getirdiği testler dahil).
- Beş Node paketi + `test:lock` **0 kırmızı** · **12 PowerShell harness 0 kırmızı** (paket
  `a11y/screen.ps1` ve `a11y/worker.ps1` dosyalarını değiştirdiği için bu koşu önemli).
- **Canlı GLM/Blender denemesi YAPILMADI**: paketin kendi uyarısı gereği gerçek hizalama, yeni kare, model
  onayı ve ardından seçili modda tıklama sırasının günlük/gözlemle doğrulanması gerekir.

## Sınır

Bu bir **kaynak patch** uygulamasıdır; masaüstündeki exe bu sürümden derlendi, ancak **görsel hedefleme
davranışının gerçek ekranda doğrulanması** kullanıcı koşusuyla yapılmalıdır.
