# Move / click_current bağlantı düzeltmeleri

Taban: main e41f6db, 1.9.36. Bu dar değişiklik kullanıcı tarafından test edilip patch olarak hazırlanması istendiği için yapılmıştır. Otomatik onarım mimarisi veya yeni panel eklenmez.

- İnisiyatifin agentShot çağrısı cursorMarker ister. Köprü bu seçeneği worker'a geçirir. Invoke-Scan, işareti yalnız gönderilecek shotBmp kopyasına çizer. Ham OCR, ONNX, ekran imzası, scanner görüntüsü ve patch/template arama kareleri işaretlenmez.
- Koşu başında clearHover çağrılır. Normal tıklama, yazma, tuş, sürükleme ve kaydırma eski kaydı geçersiz kılar. Yeni move eski kaydı önce temizler, başarıyla döndüğünde yenisini yazar.
- Liste yolu move eylemini ayrıştırır, gerçek öğe kimliğinden konumu bulur ve yalnız moveMouse çağırır. Liste promptu TARS koordinat sözdizimini öğretmez; click_current bu listeli arabirime eklenmez.
- Mouse konumu okunurken Durdur'a basılmışsa current click gönderilmez. Pencere damgası yoksa tıklama reddedilir. Worker yürütme anında imleci yeniden okur; kaymışsa basmaz, geçerliyse gerçek güncel imleç noktasına basar. SetCursorPos başarısız olursa başarı raporlanmaz.

Regresyon kanıtı: gerçek ajan kodunu çağıran dört yeni vaka önce eski kodda başarısız, sonra düzeltmede başarılı oldu: koşu başı temizliği, liste move, move node -> ekran click_current ve cursor okunurken durdurma. Ek pencere-kimliği reddi de sınanır. Köprü ve OS çağrıları test karşılıklarıdır; canlı masaüstü kanıtı değildir.

PowerShell testleri gerçek Invoke-Scan ve Invoke-Op gövdelerini yükler. Bitmap çizimi, Windows API'leri ve fare enjeksiyonu taklittir. Tam görüntüde çarpının görünümü/konumu ile gerçek Windows fare davranışı ayrıca denenmelidir. Kayıtlı özel promptlar değiştirilmez; gerekirse kullanıcı varsayılana dönebilir.
