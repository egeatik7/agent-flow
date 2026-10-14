# Sürüm notu — 1.9.142

**Taban:** `306d909` (1.9.141).

## Ne değişti

- Yaz düğümü odak, metin ve Enter’ı ayrı izler: kuyrukta durdurulan komut gönderilmemiş kalır, native worker’a yazıldığı anda belirsiz, yanıt gelince gönderilmiş sayılır.
- Odak gitmiş ve metin hiç yazılmamışsa kurtarma tıklamadan yazmayı sürdürür. Metin gitmişse yalnız Enter tamamlanır. Belirsiz metin körlemesine yeniden yazılmaz.
- Model zincirinde kalan süre 1000 ms altına inince HTTP zaman aşımı toplam süreyi aşmaz; süre bitmişse çağrı başlamaz, geç dönen yanıt kabul edilmez.
- Kütüphane kilidi her çağrıda kendi referansını alır. Örtüşen işlerden biri bitince kilit dosyası diğer hâlâ duruyorsa silinmez.
- Görüntüleyici sunucusu dinleme tamamlandıktan sonraki çalışma zamanı hatalarını yakalar. Port meşgul yakalaması ve WebSocket hata işleyicisi durur.
