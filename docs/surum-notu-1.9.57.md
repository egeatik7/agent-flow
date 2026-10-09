# Sürüm notu — 1.9.57 (Nubbo_OCR_Separate_Readers + token sınırı kaldırma)

Kaynak: kullanıcının `Nubbo_OCR_Separate_Readers` paketi (taban `7cd5d13` = v1.9.56). SHA256SUMS
doğrulandı: **9/9 AYNI** ✓. Rehberin karar ağacı uygulandı ✓: **birleşik patch** `--check` ile geçti →
**zorlamadan** uygulandı ✓ (`Token_Limit_Only` **uygulanmadı** ✗ — rehber: "iki patch'i arka arkaya
uygulama" ✗). `git diff --check` temiz ✓.

## 1) OCR: iki okuyucu artık AYRI kalıyor
- **Windows ve ONNX okumaları**, aynı yerde **aynı yazı** olsa bile **ayrı gözlem** olarak kalır ✓; her
  gözlemin **kutusu, kaynak etiketi ve aday numarası** korunur ✓.
- Model girdisine **`overlapping-OCR`** alanı eklenir ✓: diğer okuyucunun **örtüşen aday numaralarını**
  gösterir ✓. Yüzde = **kesişim alanı / küçük kutunun alanı** ✓; **doğruluk veya "aynı düğme" kararı
  değildir** ✗; ilişki **en az %45** geometrik örtüşmede verilir ✓.
- **İki gözlem iki tıklama üretmez** ✓ — tek **seçilen kelimenin gerçek kutusuna** tıklanır ✓.
- ONNX **çok kelimeli satırlara ayrı kelime kutuları uydurulmaz** ✗ (1.9.52'deki kural korunur ✓).
- **Koşul salt okunur** davranır ✓ (değişmedi ✓).

## 2) Token sınırları kaldırıldı
- Nubbo'nun **800 / 1000 / 2500** token sınırları **kaldırıldı** ✓ → istekler artık
  `max_tokens` / `max_completion_tokens` **göndermiyor** ✓ → **sağlayıcının varsayılanı** geçerli ✓.
  Bu **gerçek anlamda sınırsız çıktı garantisi değildir** ✗ (paketin açık uyarısı ✓).
- **Düşünme (thinking) ayarı eklenmedi** ✗.
- **Korunanlar** ✓: **Durdur** ✓, **90 saniyelik istek zaman aşımı** ✓, API hataları ✓, **kesilmiş/geçersiz
  cevap denetimi** ✓, mevcut **model yeniden-deneme politikası** ✓.

## Ölçülen (bu makinede, gerçek Windows)
- `npm run typecheck` ✓ · `npm run build:electron` ✓
- **Vitest: 408 test geçti, 0 atlandı** ✓ (paketin 408 beklentisiyle uyumlu ✓; 8 yeni token-isteği testi
  **eski sınırlı kodda başarısız oluyordu** ✓, kaldırma sonrası geçiyor ✓)
- **Sekiz Node regresyon dosyası: 116 pass / 0 fail** ✓
- **Windows PowerShell 5.1'de 10 harness** ✓
- `pack:win` ✓ · exe masaüstünde ve hash ile doğrulandı ✓

## Doğrulanmayan (dürüst)
- **Gerçek Windows ekranında Win+Tab, gerçek model, gerçek OCR motorları ve yeni EXE canlı denenmedi** ✗
  (testlerde API ve masaüstü taklit ediliyor ✓); sağlayıcı varsayılanı nedeniyle **çıktı uzunluğu
  garanti değildir** ✗.
- Canlı kontrol önerisi ✓: Ekran Tarayıcı'da **iki okuyucunun okumaları ayrı ayrı** görünmeli ✓ ve aynı
  yazı için **örtüşme yüzdesi** listelenmeli ✓; bir **Tıkla** hedefi seçildiğinde **tek** tıklama
  gitmeli ✓ (aynı yazı iki kez tıklanmamalı ✗); uzun model cevaplarında **kesilme denetimi** çalışmalı ✓.