# Android görünüm düzeltmesi — **Nubbo Viewer 1.0.1** (APK), PC sürümü değişmedi

**Kaynak**: kullanıcının `Nubbo_Android_XP_Paket (1)` paketi (`Nubbo_Android_XP.patch`, SHA256 `a204bc72…`).
**PC tarafı değişmiyor** — paketin `Kurulum.txt`'si açıkça yazıyor: *“PC EXE'sini bu Android görünüm düzeltmesi için
değiştirmen gerekmiyor.”* Bu yüzden **yeni PC sürümü çıkarılmadı** ve **exe yeniden üretilmedi**; yalnız Android
kaynakları repoya girdi.

## Gelen
- **Bağlantı ekranı** artık PC'deki **XP stil dosyaları**, **Nubbo maskotu** ve **logo** ile çizilir ✓.
- **QR kamera ekranının başlık/düğmeleri** de **XP görünümünde** ✓.
- **Yeni dosyalar**: `android-viewer/assets/connections.html` ✓ · `android-viewer/build.py` ✓; ayrıca
  `android-viewer/AndroidManifest.xml` ✓ ve `android-viewer/src/com/nubbo/viewer/MainActivity.java` güncellendi ✓.
- **APK**: **`Nubbo_Viewer_1.0.1.apk`** ✓ — `versionCode: 2` ✓, **v2/v3 imza doğrulandı** ✓,
  **1.0.0 ile aynı sertifika** ✓ (bu yüzden üzerine **Güncelle** denebilir ✓, kaldırmaya gerek yok ✓),
  SHA256 `ac3d057c9187cd33bcf4415b6bed994b53139481946cf64f436850f4dec18a3e` ✓ —
  **paketin `Dogrulama.json`'undaki değerle birebir aynı** ✓.
- Tuval/node değişiklikleri **PC'den** gelmeye devam eder ✓; Android'e özel bu düzeltme için **APK bir kez** güncellenir ✓.

## Uygulama
Patch **4 dosya** ✓ ve **tamamı** `android-viewer/` altında ✓ → PC kaynakları **hiç değişmedi** ✓ (ölçüldü ✓),
`git apply --check` temiz ✓, **çakışma yok** ✗, `package.json` **değişmiyor** ✗, sürüm **1.9.92 olarak kalıyor** ✓.

## Doğrulama
`typecheck` ✓ · **Vitest 102 dosya** ✓ · **sekiz Node regresyon** ✓ · APK SHA256 **paketin beyanıyla aynı** ✓ ·
APK masaüstüne kopyalandı ve **hash ile doğrulandı** ✓.

## Doğrulanmayan
**Fiziksel Android cihazda denenmedi** ✗ (paketin `Dogrulama.json`'u da `physical_android_tested: false` diyor ✓);
ölçümler **tarayıcı** yerleşim ölçümleri ✓ (1280×800 ✓, 800×1280 ✓, **360×640** ✓, 640×360 ✓ — dördünde de başlık 30 px ✓
ve görseller yüklendi ✓). **Özel imzalama anahtarı pakette yok** ✓ → sonraki APK'lar **aynı anahtarla** imzalanmalı ✓.