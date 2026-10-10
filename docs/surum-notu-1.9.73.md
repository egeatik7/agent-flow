# Sürüm notu — 1.9.73

Taban: 1.9.72 / `499fc3b`.

- Kurtarma ajanına **act_move**, **act_click_current** ve **act_click_point** araçları eklendi. Sol/sağ/çift tıklama desteklenir. Bu araçlar normal ajan executor'ünün aynı Windows fare taşıma/tıklama altyapısını kullanır; İnisiyatif node'u çağırmaz.
- Görüntü koordinatları 0–1 aralığında alınır ve en son screen_read görüntüsünün gerçek masaüstü alanına dönüştürülür. Görüntü küçültmesi, pencere kırpması ve negatif monitör başlangıcı dikkate alınır. Gerçek cursor konumu ve görüntüye göre rx/ry değerleri modele verilir. Sonradan fare konumundan tıklama gerçek imleci yeniden okur.
- Varsayılan talimat ve sabit sistem talimatı: metin tıklaması yanlış yere basmışsa görsel hedefe hizala, güncel ekran/cursor konumunu incele, gerekirse yeniden hizala ve sonra tıkla. Kısayol için çift tık kullan. Mevcut özel kurtarma talimatları silinmez.
- **step_run tamam/sent:true artık kurtarmanın hedefini otomatik tamamlanmış saymaz.** Gönderilmiş node körlemesine yeniden çalıştırılmaz; ajan güncel ekranı okuyabilir ve koordinat araçlarıyla hatalı tıklamayı düzeltebilir. recovery_complete için son eylemden sonraki güncel ekran gerekir. Karar model gözlemine dayanır; ikinci bir doğrulama modeli çağrılmaz.
- Raporların eylem mesajlarında gönderilen fare koordinatı ve tıklama modu bulunur.
- Tuval JSON şeması, node kimlikleri, bağlantılar, paket/döngü yığını ve normal node tıklama yolu değiştirilmedi. İnisiyatif/Koşul/Paket/Döngü çağırma yetkisi eklenmedi. Masaüstü araç izni kapalıysa yeni araçlar da çalışmaz; Durdur korunur.

Doğrulama: typecheck, renderer/main derlemesi, 585 Vitest testi (5 mevcut test atlandı), gerçek normal agent + kurtarma executor entegrasyonunda taşıma/çift tıklama/gerçek cursor, farklı alan/ölçek/negatif koordinatlar, geçerli görüntü ve Durdur kontrolü. Beş Node paketinin ve sekiz toplu regresyon dosyasının sonuçları teslimdeki DOGRULAMA.txt dosyasındadır.

Bu Linux ortamında Windows PowerShell 5.1 masaüstü harness'leri ve gerçek Blender masaüstü koşusu çalıştırılamadı. Tam yayın geçidi tamamlanmadığından GitHub push/tag ve EXE teslimi yapılmadı. Teslim kaynak patch'idir; gerçek modelin her durumda doğru görsel nokta seçeceği garantisi değildir.
