# Sürüm notu — 1.9.38

**Yazma (custom/Tk alanlar) ve görsel inisiyatif düzeltmesi.** Kaynak: kullanıcının
`Nubbo_Input_And_Initiative_Fix` paketi (taban `6576a61` = 1.9.37; `git apply --check` temiz).
Kullanıcı bu sorunların **motor içinde** düzeltilmesini açıkça istedi; kapsam genişletilmedi.

## Yazma tarafı
- **Özel/Tk alanlar için kopya yoklaması** (`electron/custom-input.ts`, `a11y/worker.ps1`):
  yoklama **seç/kopyala** yapar; **asla silmez, yapıştırmaz, yazmaz, Enter göndermez**
  (`Get-CopyProbeRejection`).
- **1×1 sahte Tk caret'i** artık geçerli sayılmaz (`caret.h < 4` → `TK_INVALID_CARET`).
- Yanlış veya **boş** alana **körlemesine Delete gönderilmez**.
- **Pano formatları korunur**; **Durdur sonrası yazma/Enter yok**.
- Dolu "Görsel İsimlendirici" yol alanına yazma senaryosu bu yolla çözülür.

## Görsel inisiyatif tarafı
- **Koordinatlı tek tıklama artık önce HAREKET olur**; sonraki karede `click_current` kararı verilir.
  Böylece model yanlış bir koordinata **tıklamadan** önce gözlemleyip düzeltebiliyor.
- **Yalnız fare oynatılıp `finished` denirse**, "önerilen tıklama yapıldı" **sayılmaz** (dürüstlük).
- Görsel sözleşme ile **liste motoru karıştırılmaz**.

## Korunanlar
- İkinci bir "görev bitti mi" LLM kontrolü **eklenmedi**; her node'a koşul eklenmedi; akış yeniden
  tasarlanmadı; normal Tıkla, standart Edit/native alanlar, tuş kısayolları ve döngüler korundu;
  **kayıtlı özel promptlar değiştirilmedi**.

## Doğrulanan
- `typecheck` ✓ · **Vitest 286 test** ✓ (yeni `tests/custom-input.test.ts`, `tests/target-response.test.ts`) ·
  `test:keys/input/recovery/stability/targeting` ✓ · `build:electron` ✓ ·
  `node --test scripts/test-input-recovery.cjs scripts/test-stability-agent.cjs` → **53 pass** ✓ ·
  **Windows PowerShell 5.1**'de 8 harness **hepsi PASS** ✓ (worker, key-input 129, stability-worker 22,
  input-recovery 60 — "dummy-caret copy proof" dahil, visual-input, hover-worker, cursor-frame,
  window-list 12) · `git diff --check` ✓ · `pack:win` ✓.
- Paketin regresyon kanıtı: **dört yeni üretim-ajanı vakası temel kodda KIRILDI, düzeltmeyle geçti**.

## Doğrulanmayan (dürüst not)
- **PowerShell 7 (`pwsh.exe`) bu makinede kurulu değil → atlandı.** Paket onu Linux'ta 7.4.12 ile
  sınamış; burada **Windows PowerShell 5.1** ile sınandı → iki motor birlikte kapsanmış oldu.
- **Canlı masaüstü/LLM testi yapılmadı**: gerçek Tk alanına yazma, gerçek Chrome profil akışı ve
  modelin hareket→click_current sözleşmesini canlı uygulaması ölçülmedi. PowerShell kontrolleri
  **gerçek üretim gövdelerini** çalıştırır ama klavye/fare API'leri **taklittir**.
- `npm ci` çalıştırılmadı: paket bağımlılık dosyalarına dokunmuyor, mevcut `node_modules` zaten
  kilit dosyasıyla uyumlu; temiz kurulum **ek bilgi vermezdi**.