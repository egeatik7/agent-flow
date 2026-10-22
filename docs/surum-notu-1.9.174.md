# 1.9.174 — Nubbo Dosyalar ve bağımsız üretim tuvalleri

Kullanıcı giriş ve çıkış klasörlerini Nubbo içinden seçebilir. Dosyalar paneli gerçek Windows klasörlerini yönetir; klasör oluşturma, alt klasör, kopyalayarak içe alma, sürükleyip bırakma, yerinde bağlama, içerik listeleme ve görünen ad değiştirme bulunur. Çıktılar ve çalışma dizinleri panelde ayrı görünümlere sahiptir. Listeden kaldırmak fiziksel dosyaları silmez.

Başlangıç node'undaki isteğe bağlı dosya ayarı, çalıştırmada giriş/çıkış seçimini açar. Ara çalışma klasörleri yeni çalışma kimliğiyle hazırlanır. Değer ekle menüsü giriş, çıkış, çalışma, kayıtlı klasör ve belirli dış döngü başvuruları sunar. Eski sabit yollar ve öğe değişkenleri korunur. Yeni özellik içeren JSON/ZIP belgeleri v2; eski belgeler v1 olarak okunur/yazılır. Kaynak tarifi node üzerinde saklandığından mevcut paket ve graph kayıt yollarında taşınır; Farklı Kaydet kopyaları bağımsız çalışma kimliği alır.

Yeni klasör kaynaklı döngüler dosya/klasör ve uzantı filtresi kullanır; liste döngüye girişte alınır, boş klasör sayı tekrarına dönüşmez. Checkpoint dosya bağlamını saklar ve ilgili çıktı/çalışma köklerini izler. Modern tuvalin seçiliden/checkpoint'ten çalışması yalnız o tuvalde kalır; açık sıra oynatma eylemi korunur.

İki örnek bağımsız tuval: Görsel → İsimlendir → Hunyuan → GLB (ilk 48 görsel, hesap başına 16, sekme başına 8) ve GLB → Remesh → Blend (tüm seçili GLB'ler, grup başına 15). Görsel isimlendirme hazırlık kopyasında yapılır; remesh kaynak GLB'leri taşımaz. Blend dosya adı çalışma koduyla ayrılır. Mevcut Tools uygulamaları görünür arayüzleriyle kullanılmaya devam eder; komut satırı/API desteği varsayılmaz.

Doğrulama: 24 yeni test geçti. Tam Vitest: 1587 geçti, 14 başarısız, 5 atlandı; başarısız testler temiz tabanla birebir aynı. Ayrı Node regresyonları: 98 geçti, 21 atlandı. Typecheck ile renderer/main kaynak derlemeleri geçti. Windows/Hunyuan/Blender ve gerçek EXE arayüzleri bu Linux ortamında canlı denenmedi. Kurulabilir Windows EXE bu teslimin parçası değildir.

## Paket doğrulaması (yerel, Windows)

Kaynak paket: `C:\Users\ASUS TUF\Downloads\Nubbo-Klasor-Sistemi-Patch-1.9.174`
(`nubbo-klasor-sistemi-1.9.174.patch`, `UYGULAMA.md`, `DOGRULAMA.md`, `MANIFEST.sha256`).

- Taban `122aaa3` (1.9.173) temizdi; `git apply --reverse --check` **başarısız** (henüz uygulanmamış),
  `git apply --check` **geçti**, uygulama zorlamasız yapıldı; `git diff --check` **temiz**.
- `MANIFEST.sha256` içindeki **36 dosyanın tamamı** uygulama sonrası içerikle **birebir eşleşti**
  (satır sonu normalleştirilerek; ham bayt farkı yalnız repoda yerleşik CRLF).
- Değişenler: 13 mevcut Electron kaynağı, 12 arayüz/kütüphane dosyası, 3 yeni Electron modülü
  (`file-contract`, `file-library`, `file-list`), 3 yeni arayüz bileşeni, `src/styles/files.css`,
  3 yeni test dosyası, 2 örnek döngü JSON'u, `scripts/test-stability-main.cjs`, `package.json`
  (yalnız sürüm satırı), sürüm notu.

## Bu makinede ölçülen geçit (Windows)

- `npm run typecheck` ✓ (üç proje).
- Yeni dosya sistemi testleri: `file-workspaces` 17 · `file-flow-execution` 4 · `file-dialog` 3 =
  **24/24**; `run-preflight-regressions` ile birlikte **34/34** ✓.
- `npx vitest run` → **205 dosya / 1607 test yeşil** (1.9.173'te 202/1583; +3 dosya, +24 test).
- Altı Node paketi: `test:keys` 3 · `test:input` 7 · `test:recovery` 27 · `test:targeting` 20 ·
  `test:stability` 40 · `test:lock` 1 → **98 geçti, 21 atlandı, 0 başarısız** (paketin sayılarıyla aynı).
- Yedi PowerShell **5.1** harness'ı `exit=0`: `test-worker`, `test-keyboard-safety`,
  `test-visual-input`, `test-screen`, `test-scan-frame`, `test-visual-crop-geometry`,
  `test-screen-opaque`. (`test-screen` çıktısındaki bitmap bırakma **PARTIAL** notu bu patch'ten önce
  de vardı; `a11y/screen.ps1` değişmedi.)
- `npm run build:electron` ✓ (renderer + Electron main).

## Sınırlar (dürüst)

- Paketin kendi Linux ortamındaki tam taraması **kırmızıydı** (14 başarısız + 1 dosya yükleme hatası:
  checkpoint yol/kök, kütüphane kilidi EPERM, Chrome/Electron ikilisi eksikliği); temiz tabanla
  birebir aynı küme olduğu bildirildi. Bu makinede tam tarama **yeşil**; bu, Windows davranışının
  canlı kanıtı değildir.
- **Canlı Windows kabulü yapılmadı:** gerçek fare, Hunyuan web akışı, Nubbo Tools EXE'leri,
  Blender/Custom GLB/Custom Remesh, ProcessWatcher OCR ve Explorer sürükleme köprüsü denenmedi.
  Dosya sistemi davranışı gerçek geçici klasörlerle otomatik testlerde sınandı; arayüz jsdom ile.
- Örnek döngülerin runner koşusu yer tutucu GLB/Blend içerikleriyle yapıldı; gerçek 3B üretim veya
  remesh kalitesi doğrulanmadı.

## EXE

`Nubbo-1.9.174.exe` · `C:\Users\ASUS TUF\Desktop\Nubbo-1.9.174.exe` · SHA256
`80E6FF4AF9A56A1C518118DC7FA0F30D8AABBD23AD77D457DD8162AD0949B09D` (build = masaüstü kopyası,
97.602.215 bayt). Build damgası `resources/build.json` içinde `a196d81`, `dirty=false`,
`version=1.9.174` — etiketli commit ile aynı ağaçtan üretildi. Masaüstündeki eski `Nubbo-*.exe`
dosyaları silinmedi.
