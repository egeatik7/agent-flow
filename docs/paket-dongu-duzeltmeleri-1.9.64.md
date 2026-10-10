# Nubbo 1.9.64 — paket çıkışı ve iç içe döngüden devam

Bu rapor, 1.9.63 raporunda açık bırakılmış iki yürütme hatasının düzeltmesini açıklar. Önceki beş düzeltme bu sürümde de bulunur.

## Öngörülen sorunlar ve çözüm

| Olası sorun | Alınan önlem |
| --- | --- |
| B'den devam edilince sonraki dosyalarda A da atlanır | Seçilen node'a giden döngü yolu yalnız ilk ilgili turda taşınır. Yeni iç/dış turlar normal başlangıçlarını kullanır. |
| İç döngü doğrudan başlatılınca dış dosya/sıra bağlamı kurulmaz | Döngüler dıştan içe açılmaya devam eder; yalnız iç başlangıç bilgisi aşağı aktarılır. |
| Geri bağlantı aynı devam bilgisini tekrar kullanır | Devam yolu ilgili iç döngü çağrılmadan önce tüketilir; o zincirde ikinci kez uygulanmaz. |
| Kayıtlı dosya kimliği sonraki dış dosyada yeniden kullanılır | Dosya kimliği koşu boyunca yalnız bir kez uygulanır; sonraki döngü çağrıları kendi normal işaretlerini kullanır. |
| Paket yanlış koşul dalı veya iç alternatif adımda bitse de dışarı geçer | Mevcut `packageExit` kaydının node ve çıkış portu fiilen seçilmiş olmalı. Aksi durumda paketin dış sonraki adımı çalışmaz. |
| Aynı koşul tekrar ziyaret edilince eski “var” sonucu kalır | Her ziyaret kayıtlı çıkışın sonucunu günceller; daha sonraki “yok”, önceki “var” iznini kaldırır. |
| Paketlenmiş hata/zaman aşımı çıkışı bağlantısız hata sanılır | Paketleme sırasında kaldırılmış dış bağlantı, kayıtlı sınırla eşleşirse çağıran paketin bağlantısı olarak kabul edilir. Mevcut başarısızlık işleyicisi çalışır. |
| Paket içindeki Bitiş yanlışlıkla dış sonraki adımı serbest bırakır | Kayıtlı çıkışlı pakette Bitiş sonucu dış devam izni vermez. Çıkışsız eski paketlerin eski Bitiş davranışı korunur. |
| İç paketten elle devam ile normal başlangıç farklı dallara gider | Aynı çıkış denetimi paket yolundan elle giriş ve normal paket çağrısında uygulanır. Her üst paket ayrı değerlendirilir. |
| Paketten elle devam sonrası dış döngünün kalan dosyaları atlanır | İç döngüden çıkarken üst döngünün mevcut turunun devamı ve sonraki turları tamamlanır; tüm üst katmanlarda aynı işlem yapılır. |
| Paketin çıkış node'u silinmişse başka çıkış tahmin edilir | Eşleşme olmadığında dış devam verilmez; node kimliği veya JSON yeniden yazılmaz. |
| Eski JSON'a yeni şema/alan zorlanır | JSON formatı ve kayıt işlemi değiştirilmedi. Yeni devam bilgileri yalnız motorun çalışma seçeneklerinde tutulur. |

## JSON uyumluluğu ve sınırlar

- Dosyalar topluca dönüştürülmez, düğümler yeniden kimliklendirilmez, bağlantılar yeniden kurulmaz.
- `packageExit` zaten önceki kaynakta bulunan ve paketleme sırasında kaydedilen alandır; bu sürüm onu çalıştırma sırasında da kullanır.
- Çıkış kaydı **olmayan** eski veya elle oluşturulmuş paketler eskisi gibi çalışır. Motor bu paketlerde bir koşul dalını dış çıkış kabul ederek tahmin yürütmez. Böyle bir pakette hangi dalın dışarı devam etmesi gerektiği JSON'dan belirlenemiyorsa, bu güncelleme bunu kendiliğinden onaramaz.
- Çıkış kaydı olan paketlerde yanlış dalın dışarı devam etmesi artık engellenir; eski hatalı davranışın sürmesi beklenmemelidir.
- Mevcut döngü işareti/hafıza güncellemeleri yürütme sırasında önceki gibi yapılır. “Format değişmedi” ifadesi, koşu sırasında hiçbir çalışma durumunun güncellenmediği anlamına gelmez.
- Stop, adım limitleri, hata yakalama ve kurtarma ajanı eylem yetkileri genişletilmedi.

## Doğrulama

Öncelik, yukarıdaki durumları düşünerek yürütme kurallarını netleştirmekti. Kontrol amacıyla 17 ek senaryo da uygulandı:

- İki özgün hata artık beklenen sonuçları veriyor.
- Olumlu/olumsuz koşul portları, iç alternatif dal, zaman aşımı ve inisiyatif başarısızlık işleyicisi.
- Pakette Bitiş, çıkış kaydı olmayan eski paket, silinmiş çıkış kimliği.
- Üç katmanlı döngüde seçilen B'den başlama, kalan turlar/dosyalar.
- Tek kullanımlık dosya kimliği, koşula geri bağlantı, farklı sonuç veren paket turları.
- Seçilen iç node'dan paket yolu ile giriş, iç içe paketlerden çıkma, iç/dış döngü kalan turları.

`npm test`: **570 başarılı, 5 atlanan** test. Tip kontrolü ve renderer/ana süreç derlemesi başarılı. `git diff --check` başarılı.

Canlı Windows masaüstü ve kullanıcının tüm kişisel JSON dosyaları bu ortamda çalıştırılmadı. Tüm olası akışların hatasız olduğu veya sıfır risk garanti edilmiyor.

## Paket

1.9.64 teslimi tam kaynak ve güncelleme patch'leri içerir; Windows EXE değildir. `update.patch`, 1.9.63 (`5029f5a`) kaynağı içindir. `from-1.9.62.patch`, 1.9.62 (`45f1c1a`) kaynağından itibaren beş önceki düzeltmeyi ve bu düzeltmeleri birlikte içerir. Aynı kaynağa birden fazla patch uygulanmamalı; baz sürüm uyuşmazsa zorlamak yerine tam kaynak kullanılmalı.
