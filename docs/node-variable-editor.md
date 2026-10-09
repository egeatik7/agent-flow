# Node alanlarında değişken kutuları

Değişken düğmesi imlecin olduğu konuma ekler; seçilmiş metni değiştirir. Araya kendiliğinden boşluk koymaz. JSON'da ham `{{öğe}}`, `{{öğe.isim}}`, `{{öğe.ad}}`, `{{sıra}}`, `{{toplam}}` saklanır; kutuda karşılığı görünür. Uzun değer kutuda üç noktayla kısalır; kutunun ve alttaki düğmenin El kitabı tam değeri, döngüyü ve işaretli satırı gösterir. İşaret değişince açık kart güncellenir.

× yalnız o değişken örneğini siler. Backspace/Delete kutuyu tek parça kaldırır. Copy/cut ham template verir; paste düz metindir. Ctrl+Z/Ctrl+Y son 100 düzenlemeyi geri alır/yeniler. Bilinmeyen veya tamamlanmamış template kayıtta korunur. Bu alan ve değişken düğmelerindeki tuşlar tuvalin node kopyalama/silme kısayollarını çalıştırmaz; koşu sırasında düzenleme kilitlenir.

Tıkla ve İnisiyatif komutu, Yazı Yaz metni/hedefi, Tuş/Kısayol, Koşul tarifi ve döngünün klasörü desteklenir. Döngü satır listesi normal liste olarak kalır. Kısayol hazır düğmelerinin mevcut davranışı korunur.

## Bağlam

Önizleme en yakın dış döngünün işaretli satırına aittir; paket sınırını aşar. Döngü node'unun kendi klasöründe dış döngü okunur. Klasör listesi henüz alınmamışsa öğe/toplam uydurulmaz: “Çalışırken belli olacak”. Döngü dışında öğe yoktur; sıra motor varsayılanı olan 1'dir. Önizleme gelecekteki tüm turların aynı değeri olacağı anlamına gelmez.

## Kontrol node'u

`probe` / Kontrol kaldırıldı; `condition` / Koşul ve CLI tek-adım debug/test araçları kalır. Motorun tıklama, OCR, yazma, odak ve hata politikası yeniden yazılmaz.

Eski Kontrol kartları normalize sırasında çıkarılır; önceki bağlantı sonraki gerçek node'a gider, port/id korunur. Paketler de içten dönüştürülür; eski kartlar döngü üyeliğinden çıkarılır. Hedefsiz pasif zincirde eylem uydurulmaz.

Bir döngüde bağlantısız birden fazla kol varsa, kartı kaldırmak konuma göre seçilen ilk kolu değiştirebilir. Böyle bir dönüşüm açık hata verir ve kaynak veriyi değiştirmez. Eski sürümde giriş kolunu bağlayıp yeniden açmak gerekir; daha önce çalışmayan başka bir kol sessizce çalıştırılmaz.

## Görünüm ve kanıt

Node düzenleyicisindeki çoğu sabit açıklama kaldırıldı; gerçek hedef/hafıza bilgisi ve uyarılar kaldı. Paket ana rengi %70'e kadar, lacivert %94'te, siyah sağ kenardadır.

DOM testleri imleç/selection, silme, clipboard, undo, işaret değişimi ve El kitabı güncellemesini ölçer. Motor testi Kontrol kartları çıkarılmış iki öğeli döngünün gerçek adımları sırayla çalıştırıp Bitir'e ulaştığını ölçer. Gerçek Windows/Electron görüntü ve klavye denemesi değildir.
