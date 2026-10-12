# Tarama kare tutarlılığı — OCR kutuları ile modele giden görüntü aynı ana mı ait?

**Durum: 1.9.105.** Bu belge bir ölçüm raporudur; `scripts/test-scan-frame.ps1` harness'i ile **ölçülen**
gerçekleri, kod kanıtlarını ve önerilen düzeltme seçeneklerini ayırır.

## Kısa cevap

- **Windows OCR, ONNX okuması, yan (90° döndürülmüş) ONNX okuması ve modele giden numaralı görüntü
  TEK BİR KAREDEN gelir** — asenkron değiller. Tarama başına **tam olarak bir** ekran yakalama yapılır;
  OCR o bitmap üzerinde çalışır, görüntü o bitmap'in kopyasıdır, ONNX ise **aynı karenin** ham dosyasını
  okur.
- **UIA öğeleri bu garantinin DIŞINDADIR:** UIA ağacı, ekran görüntüsü **alınmadan ÖNCE** okunur.
  Aradaki süre `$script:UiaBudgetMs = 6000` ile sınırlıdır; yani bir UIA kutusu görüntüden **en çok
  6 saniye eski** olabilir. Numaralı görüntüde UIA öğelerinin numaraları da çizildiği için, o kutu
  görüntüde **kaymış bir yeri** gösterebilir.

## Ölçüm (yeni harness, canlı masaüstü gerektirmez)

`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/test-scan-frame.ps1`
→ **exit 0**, çıktı: `PASS scan frame: UIA read happens BEFORE the capture (drift window <= 6000 ms);
Windows OCR, the ONNX raw shot and the marked picture all come from that one captured frame.`

Harness `a11y/screen.ps1`'in **yalnız fonksiyon tanımlarını** AST'ten yükler (üst düzey `Add-Type`
kodu çalışmaz, ekran yakalanmaz, pencereye dokunulmaz), yakalama/OCR/JPEG çağrılarını stub'lar ve
**çağrı sırasını + nesne kimliğini** kaydeder. Ölçtüğü iddialar:

1. Sıra: `uia` → `capture` → (`win-ocr`, `onnx-shot`, `tilt`, `merge`) → `jpeg`.
2. `marked` taramada **tek** yakalama vardır (OCR ile görüntü arasında ikinci yakalama yok).
3. Windows OCR, **yakalanan nesnenin kendisini** okur (`same-frame=True`).
4. ONNX ham kare dosyası **aynı** nesneden kaydedilir (`same-frame=True`).
5. JPEG, o karenin **kopyasından** üretilir (`copy-of-frame=True`) ve görüntüye **iki** öğe de çizilir
   (`marks=True/items=2`) — yani UIA öğesi de bu görüntüde numaralanır.
6. `image='none'` taramasında: yine tek yakalama, **kopya yok**, **JPEG yok**.
7. `screen.ps1` gerçekten `6000 ms` UIA bütçesi bildirir (kaynak metinden okunur; kayma penceresinin
   üst sınırı budur).

## Kod kanıtı (satırlar)

| Ne | Yer | Anlamı |
| --- | --- | --- |
| UIA okuması | `a11y/screen.ps1:798-800` | Görüntüden **önce**. |
| Tek yakalama | `a11y/screen.ps1:802` (`Capture-Raw`) | Tarama başına bir kare. |
| Görüntü kopyası | `a11y/screen.ps1:816` (`Copy-Bitmap32 $bmp`) | Pencereye giden resim bu karenin kopyası. |
| Windows OCR | `a11y/screen.ps1:825` (`Get-OcrPhrases $bmp …`) | **Aynı** kare üzerinde. |
| ONNX ham kare | `a11y/screen.ps1:827` (`Save-OnnxShot $bmp`) | ONNX bu dosyadan okur, yeniden yakalamaz. |
| Döndürülmüş OCR | `a11y/screen.ps1:829-833` (`[XpTurn]::Ccw($bmp)`) | Aynı karenin döndürülmüş hâli; kutular `Convert-TiltRect` ile geri taşınır (`:446-455`). |
| Numaraların çizimi | `a11y/screen.ps1:688,700-704` (`$marks`, `DrawRectangle`, `DrawString $it.id`) | Numaralar = öğe kimlikleri. |
| JPEG üretimi | `a11y/screen.ps1:847` | Kopya + birleşik öğe listesi. |
| ONNX ikinci yol (ertelenmiş) | `electron/a11y-bridge.ts:332-349` | Yine **kaydedilmiş aynı kare** dosyasını okur (`readRawShot`), yeniden yakalamaz. |
| Görüntü + liste birlikte | `electron/openrouter.ts:664-681` | Tek `scan` nesnesinden hem liste hem `imagePart` üretilir; arada yeni tarama yok. |
| Koşulda resim yok | `electron/agent.ts:1191` (`sendImage:false`), `electron/agent.ts` koşul okuyucuları (`image:'none'`) | Koşul kararı görüntüyle eşleştirilmez. |

## Tehlikeler ve sonuçları

1. **UIA kayması (asıl risk, ölçüldü):** UIA kutuları görüntüden eski olabilir. Kaydırma/animasyon/hızlı
   pencere değişimi sırasında, numaralı görüntüdeki UIA numarası **yanlış yeri** gösterir; model bu
   numarayı seçerse tıklama yanlış noktaya gidebilir. Kayma üst sınırı **6 sn**'dir (tipik değer
   ölçülmedi; UIA yürüyüşü çoğu ekranda çok daha kısadır).
2. **İki ayrı kare (tasarım):** Koşul node'u bir kez UIA, gerekirse bir kez OCR okur; bunlar **iki ayrı
   taramadır** (iki ayrı an). Koşulda görüntü gönderilmediği için "görüntü ↔ kutu" uyuşmazlığı yoktur,
   ama karar iki farklı andan gelen kanıta dayanır.
3. **Taramadan tıklamaya kadar geçen süre (doğal):** Seçim bir kareden yapılır, tıklama sonradan gider;
   bu yüzden giriş yolunda pencere/hedef yeniden doğrulanır (`assertInputTarget`, okunan değer kontrolü).
   Bu bir "kare uyuşmazlığı" değil, zaman farkıdır.
4. **Ölçek/kırpma:** Numaralar **küçültmeden önce** çizilir (`maxImageW` sonra uygulanır), yani
   görüntüdeki numara ile kutu aynı hizada kalır; liste koordinatları da aynı karedeki piksellerden
   yüzde olarak hesaplanır.

## Önerilen düzeltme seçenekleri (karar senin)

- **A. Yalnız aynı kareden gelen kanıtı numaralandır:** görüntüye **OCR/ONNX** öğelerinin numaralarını çiz;
  UIA öğelerini listede tut ama görüntüde numaralamayıp promptta bunu açıkça söyle. Ucuz, kaymayı görünmez
  kılar; UIA numaralarının görsel karşılığı kaybolur.
- **B. Önce yakala, sonra UIA oku:** kaymanın yönü değişir (UIA bu kez görüntüden **yeni** olur) ve
  kutu yine görüntüdeki yeri tam göstermez; tek başına sorunu çözmez.
- **C. UIA'yı kareyle doğrula:** yakalamadan sonra, UIA kutusunun aynı karedeki OCR kanıtıyla örtüşmesini
  şart koş (örtüşmeyen UIA öğesini numaralamadan listele ya da düşür). En doğrusu, en pahalısı; motor
  davranışını değiştirir.
- **D. Hiç değiştirme, yalnız belgele:** bugünkü davranış promptta zaten "etiketler özgün kimlikleri
  gösterebilir, seçimi liste koordinatlarıyla yap" diyerek törpüleniyor (`electron/openrouter.ts:671`).

Bu rapor **hiçbir çalışan davranışı değiştirmez**; yalnız harness (`scripts/test-scan-frame.ps1`) ve bu
belge eklenmiştir. Seçenek A/B/C'den biri seçilirse ayrı bir sürümde uygulanır.
