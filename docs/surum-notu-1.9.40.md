# Sürüm notu — 1.9.40

**İnisiyatif: önce konum, sonra modelin kendi tıklama türü.** Kaynak: kullanıcının
`Nubbo_Model_Click_After_Position` paketi (taban `3d52f39` = 1.9.39; `git apply --check` temiz).

## Değişen
- Model hedefe **önce fareyi götürür**; yeni ekran görüntüsü alınır; sonra **kendi normal
  `click` / `double` / `right`** eylemini gönderir ve **eylemin türü korunur** (script double'ı
  single'a çevirmez, bütün tıklamaları `click_current`'a zorlamaz).
- **`click_current` isteğe bağlı tek tık** olarak kalır; model buna zorlanmaz.
- **Hazırlanmamış** bir noktaya (veya başka bir noktaya) tıklama önerilirse **yalnız fare hareket
  eder**; sonraki karede model yeniden karar verir. **Hareketten sonra kendiliğinden tıklama yok.**
- **Fare hareketleri takılma sayacından çıkarıldı** (uygulama ekranını değiştirmeleri beklenmez),
  ama **`maxActions` bütün turları sınırlamaya devam ediyor**.
- Nokta/pencere değişimi ve **durdurma korumaları kaldırılmadı**.

## Korunan
- Açık **normal Tıkla node'u** ve tıklama modları (tek/çift/sağ/**Fareyi Oynat**) ile liste/OCR
  seçim yolu değişmedi; kayıtlı özel promptlar korunuyor (yeni sözleşme **çalışma-anı isteğinde**
  anlatılıyor).

## Doğrulanan
- `typecheck` ✓ · **Vitest 282 test** ✓ · `test:keys/input/recovery/stability/targeting` ✓ ·
  `build:electron` ✓ · `node --test scripts/test-input-recovery.cjs scripts/test-stability-agent.cjs`
  → **63 pass** ✓ · `git diff --check` ✓ · `pack:win` ✓.
- **Windows PowerShell 5.1**'de 6 harness **hepsi PASS** ✓ (worker, key-input 129, input-recovery
  **68 checks**, visual-input, hover-worker, cursor-frame).
- Paketin regresyon kanıtı: **yedi hedefli vaka önceki motorda 0/7 kırıldı, düzeltmeyle geçti.**

## Doğrulanmayan (dürüst not)
- **PowerShell 7 (`pwsh.exe`) bu makinede kurulu değil → atlandı.**
- **Canlı masaüstü/LLM testi yapılmadı**: modelin gerçekten `move` → yeni kare → `double` seçip
  çift tıklamayı yürütmesi, hazırlanmamış noktada yalnız hareket etmesi ve pencere değişimi
  senaryosu **ölçülmedi**. Testler gerçek üretim gövdelerini ve derlenmiş motoru çalıştırır ama
  gerçek masaüstü/LLM kanıtı değildir.