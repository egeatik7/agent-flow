# Tarama kare tutarlılığı — OCR kutuları, UIA listesi ve modele giden görüntü aynı ana mı ait?

**Durum: 1.9.106.** Bu belge ölçüm raporudur: neyin **ölçüldüğünü**, neyin kod okuması olduğunu ayırır.

## Kısa cevap

- **Windows OCR, ONNX okuması, yan (90°) ONNX okuması ve numaralı görüntü TEK BİR KAREDEN gelir.**
  Tarama başına **tam olarak bir** ekran yakalaması yapılır; OCR o bitmap üzerinde çalışır, görüntü o
  bitmap'in kopyasıdır, ONNX ise **aynı karenin** ham dosyasını okur. Bunlar arasında asenkronluk yoktur.
- **UIA okuması ayrı bir andadır** (teknik olarak zorunlu: UIA ağacı yürüyüşü ile ekran yakalama atomik
  yapılamaz). 1.9.106'dan **önce** UIA görüntüden **önce** okunuyordu, yani UIA listesi görüntüden
  **eskiydi**. Artık **kare önce, UIA sonra** okunuyor: **liste kareden yeni**, kaymanın yönü değişti.

## Ölçüm (bu makinede, salt-okunur; girdi gönderilmez)

`scripts/measure-uia.ps1` — uygulamanın kendi yükleme yolu (`worker.ps1` gibi `common.ps1` + `screen.ps1`
dot-source) ile gerçek fonksiyonlar; geniş alan gerçek pencere dikdörtgenlerinin birleşimidir.

| İş | Ölçüm |
| --- | --- |
| Pencere numaralandırma (`Get-ScanRoots`) | **2–42 ms** (13 kullanılabilir pencere) |
| **UIA yürüyüşü — tüm masaüstü** | **202–397 ms** (31–148 öğe) |
| **UIA yürüyüşü — tek pencere** | **73 ms** (86 öğe); boş pencere 3 ms |
| Kare yakalama (`Capture-Raw`, 1920×1080) | **15–60 ms** (ilk tur soğuk: 60 ms) |

Sonuç: **UIA, yakalamadan ~10–20 kat pahalıdır** ve iki işlem arasındaki fark **UIA yürüyüşünün kendisi**
(≈0,2–0,4 sn tüm masaüstü, ≈0,07 sn pencere başına). `$script:UiaBudgetMs = 6000` yalnız **en kötü durum**
sınırıdır; ölçülen tipik değer bunun çok altındadır.

## 1.9.106'da ne değişti ve neden

`a11y/screen.ps1` içinde sıra **`Capture-Raw` → UIA → OCR/ONNX → JPEG** oldu (eskiden UIA → capture → …).

- **Fark yok olmaz:** sıra değiştirmek iki işlem arasındaki süreyi değiştirmez; yalnız **hangisinin eski**
  olduğunu seçer.
- **Neden kare önce:** modelin seçtiği kimlikler ve tıklamanın izlediği koordinatlar **listeden** gelir;
  görüntü ise promptta zaten "etiketler özgün kimlikleri gösterebilir, seçimi liste koordinatlarıyla yap"
  diye **yardımcı** olarak tanımlıdır (`electron/openrouter.ts:671`). Karar girdisini taze yapmak, yardımcı
  görseli taze yapmaktan daha değerlidir.
- **Değişmeyen garanti:** Windows OCR, ONNX ve numaralı görüntü yine **tek kareden** gelir; onların
  kutu-kare uyumu her iki sırada da tamdır. Değişen yalnız **UIA girdilerinin kareye göre yaşı**dır.

## Kanıt

**Ölçen harness** — `scripts/test-scan-frame.ps1` (exit 0):
`screen.ps1`'in yalnız fonksiyon tanımlarını AST'ten yükler (üst düzey `Add-Type` çalışmaz, ekran
yakalanmaz, pencereye dokunulmaz), yakalama/OCR/JPEG çağrılarını stub'lar ve **çağrı sırası + nesne
kimliği** kaydeder. Ölçtüğü iddialar: sıra `capture → uia → (win-ocr, onnx-shot, tilt, merge) → jpeg` ·
`marked` taramada **tek** yakalama · Windows OCR/ONNX ham karesi/JPEG hepsi **aynı** yakalanan nesneden
(`same-frame=True`, `copy-of-frame=True`) · görüntüye **iki** öğe de çizilir (`marks=True/items=2`) ·
`image='none'` taramasında kopya ve JPEG yok · 6000 ms bütçesi kaynakta bildirilmiş.

**Kod kanıtı:** tek yakalama ve sıra `a11y/screen.ps1:798-811` · görüntü kopyası `:820` · Windows OCR
`:829` · ONNX ham kare `:831` (köprü aynı dosyayı okur: `electron/a11y-bridge.ts:332-349`) · döndürülmüş
OCR aynı karenin döndürülmüşü `:833-837` + kutu geri taşıma `:446-455` · numaralar `:688,700-704` ·
JPEG `:851` · görüntü + liste tek `scan` nesnesinden (`electron/openrouter.ts:664-681`) · koşulda resim yok
(`electron/agent.ts` koşul okuyucuları `image:'none'`).

## "Aynı ana koysak, tek işlem farkla?" — neden mümkün değil, ama pratikte ne oluyor?

UIA okuması zaten karenin **hemen ardındaki tek işlemdir** (araya başka bir iş girmiyor): `Capture-Raw`
→ UIA. Yine de "aynı an" olmaz, çünkü:

1. **UIA okuması bir an değil, bir süredir:** ağaç yürüyüşü ölçülen **180–315 ms** sürüyor; öğeler bu
   aralık boyunca tek tek okunur. Kare ise **tek bir BitBlt** (15–60 ms). İki farklı işletim sistemi
   mekanizması (GDI ekran kopyası ↔ UIA/COM ağaç yürüyüşü) atomik yapılamaz; "1 işlem fark" zaten budur.
2. **Paralel okumak da çözmez:** UIA yürüyüşü ayrı bir iş parçacığına alınsa *ortalama* kayma yarıya iner,
   ama aralık sıfırlanmaz; üstüne COM/cache tutarlılığı ve worker karmaşıklığı eklenir. Bilinçli olarak
   yapılmadı.
3. **Ölçülen gerçek etki — bu makinede:** `scripts/measure-uia-drift.ps1` (UIA → kare → UIA, salt okuma):

   | Tur | UIA1 | kare | UIA2 | Aralık | Karşılaştırılan | >2 px kayan | En büyük fark |
   | --- | --- | --- | --- | --- | --- | --- | --- |
   | 1 | 315 ms | 47 ms | 180 ms | **542 ms** | 146 öğe | **0** | **0 px** |
   | 2 | 195 ms | 19 ms | 184 ms | **398 ms** | 145 öğe | **0** | **0 px** |

   Yani **durağan bir arayüzde yarım saniyelik aralıkta bile hiçbir öğe kaymadı**. Risk, o pencerede
   değişen arayüzlerle sınırlıdır: animasyon, kaydırma, ilerleme göstergesi, yeni açılan diyalog.

**Farkı küçültmenin gerçek kaldıraçları (ölçülü):**
- **Hedef pencere seçmek:** UIA yürüyüşü tüm masaüstünde 202–397 ms, **tek pencerede 73 ms** → ~5 kat
  küçük aralık. Bu zaten bir kullanıcı ayarıdır (Ayarlar > Hedef pencere).
- **Kapsamı daraltmak / daha çok özelliği önbelleğe almak:** `Get-UiaItems` Name, ControlType,
  BoundingRectangle ve AutomationId'yi zaten `CacheRequest` ile toplu okuyor (`screen.ps1:527-531`);
  kalan süre ağaç yürüyüşünün kendisidir.
- **Aralığı yok sayıp sonucu doğrulamak (asıl çözüm, seçenek C):** UIA kutusunu aynı karenin OCR kanıtıyla
  karşılaştırıp örtüşmeyeni numaralamadan listelemek. Bu, zamanlamaya değil **veriye** dayalı bir garanti
  verir. Bedeli var: OCR'ın görmediği (yalnız simge olan) düğmeler düşebilir; bu yüzden ölçülen 0 px
  kayma göz önüne alınarak **şimdilik yapılmadı**.



1. **UIA artık kareden yeni:** çok hızlı değişen bir arayüzde, görüntüye çizilen UIA numarası öğenin
   *şimdiki* yerini gösterirken kare *eski* hâli gösterir. Ölçülen fark küçüktür (≈0,07–0,4 sn) ve prompt
   seçimi liste koordinatlarına bağladığı için kabul edildi.
2. **Koşul node'u iki ayrı taramadır** (bir kez UIA, gerekirse bir kez OCR) — tasarım gereği; koşulda
   görüntü gönderilmediği için "görüntü ↔ kutu" uyuşmazlığı yoktur.
3. **Taramadan tıklamaya kadar geçen süre** doğaldır; giriş yolunda pencere/hedef yeniden doğrulanır.
4. Bu ölçümler **bu makinede** alındı; çok büyük öğe ağaçlarında UIA süresi artar (bütçe 6 sn'de keser) ve
   ölçüm oturumunda görüntü yüzeyi olmadığı için yakalama WinForms birincil ekran dikdörtgeniyle ölçüldü.
5. Tam kare-kimliği isteniyorsa kalan adım **C**'dir: UIA kutusunu aynı karenin OCR kanıtıyla doğrulayıp
   örtüşmeyeni numaralamadan listelemek. Bu, motor davranışını değiştiren ayrı bir iştir ve **yapılmadı**.
