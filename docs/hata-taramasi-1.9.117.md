# Nubbo hata taraması — 30 ajan / 15 grup (sürüm 1.9.117 anı)

Yöntem: her grup için 1 **tarama** ajanı (kanıtlı bulgu) + 1 bağımsız **çürütme** ajanı. Onaylanan **54** bulgu, reddedilen **5** iddia, 15 grup. Ajanlar salt-okuma çalıştı; hiçbir dosya değiştirilmedi.

> Not: özet satırları ajan çıktısından alındı; her bulgunun tam gerekçesi iş akışı dökümündedir.

## yuksek (8)

- **a11y/worker.ps1:1397** — Üretimde kullanılan direct tuş dalı, tuşları göndermeden önce hedef pencerenin önde olduğunu doğrulamıyor; başarısız aktivasyon boş catch ile yutuluyor.
- **electron/agent.ts:545** — \
- **electron/library-lock.ts:18** — lockFile() kütüphane klasörünü koşulsuz mkdirSync ile açıyor; kayıtlı kütüphane yolu korumalı bir kökte olup sonradan silinirse açılışta bu mkdir Denetimli klasör erişimi altında süresiz bekleyebiliyor (iddiadaki satır 19 realpathSync; mkdir 18).
- **electron/llm-flow.ts:28** — DEFAULT_FIND_OFF boş olsa da ayarların kendi varsayılanı findOff:['list'] olduğu için main.ts:135'teki DEFAULT_FIND_OFF dalı ölü koddur ve \
- **electron/main.ts:290** — Portable %TEMP% süpürmesi canlılık (PID/kilit) denetimi yapmıyor; yalnız exe varlığı + klasör adı deseni + mtime (10 dk) + kendi execPath klasörü muafiyeti ile seçiyor ve rmSync(recursive, force) ile siliyor.
- **electron/temp-sweep.ts:49** — %TEMP% portable çıkarma klasörü seçiminde canlılık (PID/süreç) denetimi yok; tek ölçüt exeVar + rastgele ad + kendi klasör olmama + mtime yaşı olduğundan yeni açılan ikinci bir örnek, saatlerdir çalışan başka bir örneğin program klasörünü recursive+force silebilir.
- **electron/tool-edit.ts:466** — applyPlan, kutu üyesinden çıkan TÜM kenar hedeflerini (kutu dışındakiler dahil) geçişli olarak kutu üyeliğine ekliyor.
- **electron/yap.ts:41** — Yap'ın kendi süre sınırı modele verilen shouldStop yüklemine katıldığı için model çağrısı StoppedError ile kesiliyor; bu hata yap.ts'te yakalanmadığından akış \

## orta (22)

- **a11y/common.ps1:401** — Get-TopWindows döngüsünde GetNextSibling çağrısı try/catch dışında; numaralandırma sırasında kapanan pencere ElementNotAvailable fırlatırsa çağrının tamamı düşer.
- **a11y/common.ps1:543** — Canlı locate yolundaki Find-ByLocator, tüm alt ağaçta zaman sınırı olmayan FindAll çağırıyor; aynı dosyadaki XpText.FindAllBounded kullanılmıyor.
- **a11y/screen.ps1:171** — Her ekran yakalamada alfa kanalı, piksel başına yorumlanan PowerShell döngüsüyle düzeltiliyor (1080p için ~2,07 milyon yineleme); New-Bitmap24'te ikinci bir piksel döngüsü var.
- **electron/agent.ts:585** — tars aşamasının catch'i FatalApiError'ı yeniden fırlatmıyor; 401/402 kalıcı API hatası 'hedef bulunamadı'ya dönüşüyor.
- **electron/agent.ts:705** — Görsel modelin büyütme kırpmasında x/y 0'a kırpılıyor; negatif sanal masaüstü koordinatları yanlış bölgeyi kırpıyor.
- **electron/graph-types.ts:582** — Sayaç modundaki kutu için öğe listesi count kadar baştan üretiliyor ve count hiçbir yerde üst sınıra bağlanmıyor.
- **electron/key-guard.ts:49** — Kapatma/silme tuşlarını yasaklayan assertModelKeysAllowed üretim kodunda hiçbir yerden çağrılmıyor; koruma canlı model seçiminde yürürlükte değil.
- **electron/main.ts:852** — globalShortcut.register dönüş değeri yok sayılıyor: kayıt başarısız olsa bile pencere küçültülüyor ve günlük 'durdurmak için Ctrl+Shift+Q' diyor.
- **electron/matcher.ts:85** — Tırnaklı hedef ayrıştırma yalnız “ \\\
- **electron/profile.ts:27** — Farklı profil adları aynı userData klasörüne düşebiliyor: geçersiz adların hepsi tek klasöre, temizleme sonrası aynılaşan adlar ('Test_one' ↔ 'test one') aynı klasöre gidiyor.
- **electron/runner.ts:125** — renderNode `templated` bayrağını alanlardan yeniden hesaplayıp :128'de mevcut değeri eziyor; kurtarma step.run'unda alanlar önceden render edilmiş geldiği için bayrak false'a düşüyor ve {{öğe}} hedefli node'da son turun hafızası kullanılıyor.
- **electron/send-log.ts:166** — Her model isteği için tam ekran görüntüsü + aday listesi içeren bir tanılama klasörü yazılıyor; bu klasörleri temizleyen veya sınırlayan hiçbir kod yok, uzun koşuda disk sınırsız büyür.
- **electron/target-match.ts:14** — CLICKABLE_CONTROLS içindeki 'Link' hiçbir üreticinin kullanmadığı ölü tür; gerçek tür 'Hyperlink' listede yok.
- **electron/target-match.ts:30** — normName Türkçe yerel ayarıyla küçültüyor; ASCII 'I' dotless 'ı' olduğu için 'Import' ile 'import' eşleşmiyor.
- **electron/tools.ts:666** — branch.merge, temel tuval değişmiş olsa bile kayıtlı (bayat) branch.path'i kullanıyor; viewBranch aynı durumda yolu yeniden türetiyor.
- **electron/tools.ts:1214** — Hatadan devamda sayısal (tur) kutunun öğesi '3' biçiminde gönderiliyor; motor '#3' anahtarını aradığı için devam koşusu hata ile bitiyor.
- **electron/tools.ts:1446** — act.click `mode` alanını doğrulamadan clickMode olarak motora geçiriyor; geçersiz değer sessizce tek sol tıka iniyor ve 'yapıldı' diye raporlanıyor.
- **electron/viewer-state.ts:32** — Tabletin yürünen-kenar izi masaüstününkünden farklı kesiliyor: satır 30'daki agent:step dalı izi hiç kesmiyor, satır 32 ham e.from===p.to karşılaştırıyor; döngü/paket çerçevesine yeniden girişte önceki turun kenarları yürünmüş kalıyor.
- **electron/windows-tools.ts:35** — PowerShell çıktısı gelen her Buffer parçası ayrı ayrı utf8'e çevriliyor; parça sınırına düşen çok baytlı karakterler bozuluyor (StringDecoder/setEncoding yok).
- **electron/yap.ts:74** — task_complete kapısı yalnız başarılı screen_read ile açılıyor; hata mesajının izin verdiği 'doğrudan işlem sonucu' yolu kodda hiçbir yerde kabul edilmiyor.
- **electron/zip-library-storage.ts:79** — Bölüm içindeki çakışan ZIP adı kontrolü dosya başına try bloğunun dışında throw ediyor; tek bir ad çakışması readSnapshot'ın tamamını düşürüyor, kütüphane boş görünüyor ve sonraki tüm kütüphane işlemleri aynı hatayla düşüyor.
- **electron/zip-workspace.ts:41** — adoptZipLibrary yalnızca savedId'si kaybolan sekmeyi ayırıyor; uygulama içinde yeniden adlandırılan (main.ts:1322) tuvalin açık sekmesi bayat baseline ile kalıyor, sekme temiz görünüyor ve sonraki Kaydet main.ts:1332 kapısında 'dışarıda değişti' diye reddediliyor.

## dusuk (17)

- **a11y/screen.ps1:341** — Get-OcrPhrases çözülen SoftwareBitmap'i (tam kare) hiç Dispose etmiyor; finally yalnız akışı ve geçici dosyayı temizliyor.
- **a11y/worker.ps1:543** — Get-FieldValue ValuePattern sunan öğeyi okur; maske/parola kontrolü yalnız native yolda var, UIA'nın IsPassword bilgisi hiç kullanılmıyor.
- **a11y/worker.ps1:1275** — typeText korumalı dalındaki -not $P.at koşulu köprü çağrılarında hiçbir zaman yanlış olmaz; at alanı hiç gönderilmez.
- **a11y/worker.ps1:1481** — drag (ayrıca scroll ve clickCurrentAt) op'larında click/type/keys/hotkey yollarındaki ownPid 'kendi penceresine dokunma' koruması yok; köprü bu op'lara ownPid göndermiyor.
- **electron/canvas-session.ts:20** — Kurtarma taslakları sekmenin geçici id'siyle eşleştiriliyor; canvasId'ye göre birleştirme olmadığı için aynı kütüphane tuvalli için birden çok taslak birikebiliyor ve listede hangisinin güncel olduğu anlaşılmıyor.
- **electron/confirm.ts:84** — Yükleme sinyali denetiminde `norm(expected)` boş olabildiği için `includes('')` her zaman doğru; noktalama-only iğne, ilgisiz bir 'işleniyor' yazısıyla adımı 'loading' yapıyor.
- **electron/enclosing.ts:72** — outsideVars, dıştaki döngünün listesi boşken döngünün klasör bilgisine bakmadan count'tan ({öğe}='1') değer üretiyor; aynı durumda iki kardeş yol (reveal.ts:15-22 ve tool-context.ts:98-104) değer uydurmayı açıkça reddediyor.
- **electron/hover.ts:11** — Hover kaydının hwnd alanı hiçbir kod yolunda karşılaştırılmıyor; kaydı okuyan üretim kodu yok ve pencere denetimini uygulayan tek işçi işlemi clickCurrentAt üretimden çağrılmıyor.
- **electron/main.ts:199** — Koşu günlüğü ve hata karesi rotasyonu yalnız içinde bulunulan sürümün klasöründe çalışıyor; eski sürümlerin log klasörleri hiçbir zaman temizlenmiyor.
- **electron/main.ts:301** — Süpürme günlüğü seçilen klasör sayısını ve boyutunu 'silindi' diye yazıyor; boyut rmSync'ten ÖNCE toplanıyor ve rmSync hatası catch ile yutuluyor.
- **electron/main.ts:674** — LOGGED_STEP_KINDS listesi eksik: Başlangıç (start) ve Paket (package) de kendi açılış satırını yazıyor ama listede yok; üstteki yorum kodun gerçeğini yanlış anlatıyor.
- **electron/main.ts:1122** — İzin diyaloğunun 120 sn zaman aşımı Promise.race ile kuruluyor; zamanlayıcı temizlenmiyor, diyalog kapatılmıyor, süre dolduktan sonraki 'İzin ver' tıklaması sessizce atılıyor.
- **electron/openrouter.ts:233** — Yerel model listesi (ve testKey/listModels) yanıt gövdesini korumasız JSON.parse ediyor; 200 ile JSON olmayan gövdede hemen alt satırdaki anlaşılır hata yolu atlanıp ham SyntaxError yüzeye çıkıyor.
- **electron/recovery.ts:199** — Kurtarma ajanına giden araç cevabı JSON.stringify sonrası 30.000 karakterde sessizce kesiliyor; büyük tuvalde flow_read cevabı modele yarım (geçersiz) JSON olarak gidiyor ve kesildiği hiçbir yerde söylenmiyor.
- **electron/runner.ts:510** — Kayıtlı öğe yeni listede yoksa fırlatılırken ex.step(loop.id,'error') gönderilmiyor; aynı kurulum hataları :485 ve :492'de bu olayı gönderiyor. Araç katmanı bu hatayı adım olayıyla görmüyor.
- **electron/runner.ts:656** — Paketin kayıtlı çıkışına ulaşılmadığı ('blocked') ve paket bir kutunun üyesi olmadığı durumda günlük 'sonrası bağlı bir adım yok' diyerek gerçek nedeni (çıkışa ulaşılmadı, sonraki adım bilerek çalıştırılmadı) saklıyor.
- **electron/tool-http.ts:70** — Gövde boyut sınırı aşımı 'Gövde JSON değil.' diye raporlanıyor; ayrıca istek soketi yanıt yazılmadan önce yok ediliyor.

