# Sürüm notu — 1.9.48 (Nubbo_Direct_Actions_Fix)

Kaynak: kullanıcının verdiği `Nubbo_Direct_Actions_Fix` paketi (taban `72cc9fe` = v1.9.47).
`git apply --reverse --check` başarısız (henüz uygulanmamış), `git apply --check` başarılı → patch **zorlamadan** uygulandı; `git diff --check` temiz; **tam 11 dosya** değişti.

## Davranış sözleşmesi (paketin kendi metni)
- **Yazı Yaz**: alanı biz seçtiysek/tıkladıysak eski içerik, UIA'nın `Edit/Pane` demesi, caret geometrisi ve
  yazma sonrası içerik okuması **izin şartı değil**; `clearFirst` seçimi korunur (Ctrl+A → Delete → metin
  veya yalnız metin). Gerçek gönderim sonucu yine kontrol edilir: `writeSent` yok/false, `skippedClear`,
  `needChoice` → **başarı sayılmaz ve Enter gönderilmez**; hata üzerine sessiz ikinci yazma yok.
- **İnisiyatif**: ilk **hazırlanmamış** click/double/right önerisi **yalnız konumlandırır**; sonraki taze
  karede model **kendi** tıklama türünü seçer ve executor o türü **olduğu gibi** uygular (tür seçmez,
  otomatik çift tıklama yok). Sabit 3 px yakınlık, eski hover HWND'si ve "ekran değişmedi" ölçümü
  tıklamayı **veto etmez**.
- **Korunan gerçek kontroller**: Durdur, eksik API anahtarı/görüntü/geometri, tuş sözdizimi ve eski
  SendKeys değerleri, **gerçek PID'e göre Nubbo'nun kendisine girdi göndermeme**, açıkça kapanmış veya
  başka PID'e ait pencere kimliği, `SetCursorPos` hatası, gerçek worker/OS istisnaları, panonun yeni
  metni reddetmesi, kilitli masaüstünü bekleme.
- Runner/döngü, OCR/ONNX, akış kaydı, kullanıcı arayüzü ve kullanıcı akışları **değişmedi**.

## Bu paket dışında benim yaptığım tek değişiklik
`tests/target-response.test.ts`: patch `INITIATIVE_RULES`'tan "never turns your click into a move"
cümlesini kaldırdığı için (yeni tasarımda ilk öneri **bilerek** move oluyor) o beklenti **yeni sözleşmeye**
çevrildi: `The first unprepared click proposal positions the pointer ONLY` + `never picks a click type for you`.
Kontroller **gevşetilmedi**; yalnız metin gerçeğe uyduruldu.

## Ölçülen (bu makinede, gerçek Windows)
- `npm run typecheck` ✓ · `npm run build:electron` ✓
- **Vitest 44 dosya: 288 test geçti** ✓ (paketin atladığı `target-response.test.ts` dahil ✓)
- **Derlenmiş motor Node paketleri: 92 pass / 0 fail** ✓ (paketin bildirdiği 92 ile aynı ✓)
- **Windows PowerShell 5.1'de 10 harness hepsi PASS** ✓ — paketin **hiç denemediği** kısım ✓:
  `test-direct-input.ps1` **91 check** ✓, `test-key-input.ps1` **129** ✓, `test-worker.ps1` ✓,
  `test-hover-worker.ps1` ✓, `test-input-recovery.ps1` **69** ✓, ayrıca benim ek harness'lerim
  (`test-shell-window-click`, `test-visual-input`, `test-cursor-frame`, `test-stability-worker`,
  `test-window-list`) ✓
- `pack:win` ✓ · exe masaüstünde ve hash ile doğrulandı ✓

## Doğrulanmayan (dürüst)
- **Gerçek Blender/Tk/Chrome oturumunda canlı koşu yapılmadı**; hedef seçimini canlıda kullanıcı gözlemeli.
- Görsel model (gpt-luna) ile **gerçek inisiyatif koşusu** yapılmadı; model seçimi canlıda görülecek.
- Paketin Linux/PowerShell 7 ortamı ile benim Windows/PowerShell 5.1 ortamım **aynı değil**; bu yüzden
  sonuçlar birbirinin kanıtı değil, **birbirini tamamlayan** iki ölçümdür.