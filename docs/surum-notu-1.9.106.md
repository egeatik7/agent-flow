# Sürüm notu — 1.9.106 (kare önce, UIA sonra: ölçüme dayalı sıra değişikliği)

**Kaynak**: kullanıcının sorusu — *"UIA okuma ne kadar sürüyor ki? screenshot'ın hemen arkasına koysa
UIA okumayı?"*

## Ölçüm (bu makinede, salt-okunur; hiçbir girdi gönderilmedi)

`scripts/measure-uia.ps1`, uygulamanın kendi yükleme yolunu kullanır (`worker.ps1` gibi `common.ps1` +
`screen.ps1` dot-source), yani gerçek fonksiyonlar:

| İş | Ölçüm |
| --- | --- |
| Pencere numaralandırma (`Get-ScanRoots`) | **2–42 ms** (13 kullanılabilir pencere) |
| **UIA yürüyüşü — tüm masaüstü** | **202–397 ms** (31–148 öğe) |
| **UIA yürüyüşü — tek pencere** | **73 ms** (86 öğe); boş pencere 3 ms |
| Kare yakalama (`Capture-Raw`, 1920×1080) | **15–60 ms** (ilk tur soğuk 60 ms) |

Yani **UIA, yakalamadan ~10–20 kat pahalı**; iki işlem arasındaki fark **UIA yürüyüşünün kendisi**
(≈0,2–0,4 sn tüm masaüstü, ≈0,07 sn pencere başına). `$script:UiaBudgetMs = 6000` yalnız en kötü durum
sınırıdır.

## Yapılan değişiklik (`a11y/screen.ps1:798-811`)

Sıra **`Capture-Raw` → UIA → OCR/ONNX → JPEG** oldu (eskiden `UIA → capture → …`).

- **Gerekçe:** sıra değiştirmek iki işlem arasındaki süreyi **yok etmez**, yalnız **hangisinin eski**
  olduğunu seçer. Modelin seçtiği kimlikler ve tıklamanın izlediği koordinatlar **listeden** gelir; görüntü
  ise promptta zaten yardımcı olarak tanımlıdır (`electron/openrouter.ts:671`: "etiketler özgün kimlikleri
  gösterebilir, seçimi liste koordinatlarıyla yap"). Bu yüzden **karar girdisi olan liste** taze olmalı:
  artık liste kareden **yeni**, eskiden **eskiydi**.
- **Değişmeyen garanti:** Windows OCR, ONNX okuması, yan (90°) ONNX okuması ve numaralı görüntü yine **tek
  kareden** gelir; onların kutu-kare uyumu her iki sırada da tam. UIA okuması artık `try` bloğunun içinde
  olduğu için bir UIA hatasında bitmap yine `finally` ile bırakılır (eskiden bitmap henüz alınmamıştı).
- `Get-ScanRoots`/`Get-UiaItems` **salt okuma** olduğu doğrulandı (odak/pencere öne getirme yok); pencere
  odaklanması zaten ikisinden de önce yapılıyor (`screen.ps1:785-790`, `Enter-Window` + 150 ms).

## Doğrulama

- `scripts/test-scan-frame.ps1` (ölçen harness) **yeni sırayı** doğrulayacak şekilde güncellendi ve
  **exit 0**: sıra `capture → uia → (win-ocr, onnx-shot, tilt, merge) → jpeg` · `marked` taramada **tek**
  yakalama · OCR/ONNX ham karesi/JPEG hepsi **aynı** yakalanan nesneden (`same-frame=True`,
  `copy-of-frame=True`) · görüntüye iki öğe de çizilir (`marks=True/items=2`) · `image='none'` taramasında
  kopya ve JPEG yok · 6000 ms bütçesi kaynakta bildirilmiş.
- `typecheck` ✓ · **Vitest 120 dosya / 953 geçti / 1 atlandı / 0 kırmızı** ✓ · **beş Node paketi +
  `test:lock`** hepsi 0 kırmızı (keys 3, input 7, recovery 27+12, targeting 20, stability 40+9, lock 1) ·
  **on iki PS 5.1 harness'i** exit 0 ✓.
- Paketlenmiş uygulamada worker dosyası kontrol edildi: `screen.ps1` içinde `Capture-Raw $rect` satırı
  `Get-UiaItems (Get-ScanRoots …)` satırından **önce** geliyor.

## Sınırlar (dürüst)

- UIA artık kareden **yeni** olduğu için, çok hızlı değişen bir arayüzde görüntüye çizilen UIA numarası
  öğenin *şimdiki* yerini gösterirken kare *eski* hâli gösterir. Ölçülen fark küçüktür (≈0,07–0,4 sn) ve
  prompt seçimi liste koordinatlarına bağladığı için kabul edildi.
- Ölçümler **bu makinede** alındı; çok büyük öğe ağaçlarında UIA süresi artar (bütçe 6 sn'de keser).
  Ölçüm oturumunda görüntü yüzeyi yoktu (sanal ekran 0×0), bu yüzden yakalama WinForms birincil ekran
  dikdörtgeniyle ölçüldü.
- Tam kare-kimliği istenirse kalan adım **UIA kutusunu aynı karenin OCR kanıtıyla doğrulamak**tır; bu
  motor davranışını değiştiren ayrı bir iştir ve **yapılmadı**.
- Canlı masaüstünde uçtan uca gözle test edilmedi; kanıt harness + ölçüm düzeyinde.
