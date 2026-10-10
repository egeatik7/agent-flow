# Kurtarma Ajanı

Ayarlar → **Kurtarma Ajanı**, hata veren bir eylemi akışın mevcut noktasında toparlayan ayrı model ayarlarıdır. OpenRouter'daki genel API anahtarını kullanır. Modelin **görsel giriş ve araç çağırma** desteklemesi gerekir.

1. Model kimliğini yaz; istersen yedek modeller ekle.
2. Akışın amacını, uygulamaları, klasörleri ve tekrar edilmemesi gereken işleri görev alanına yaz.
3. Ekran eylemlerine ve node çağırmaya vereceğin yetkileri seç. Hata veren eylem node'u dışında çağırabileceği node'ları ayrıca işaretle.
4. **Hata olduğunda kurtarma ajanını kullan** seçeneğini aç ve **Kurtarma Ayarlarını Kaydet** düğmesine bas.

Varsayılan kapalıdır. Normal akışta her adımdan sonra bu modele çağrı yapılmaz. Yalnız **Tıkla, Yazı Yaz, Tuş Gönder veya Zamanlayıcı bir hata fırlattığında** çalışır. Koşulun `yok` çıkışı ve İnisiyatif'in başarısızlığı bu yöneticiyi başlatmaz. Eylem sessizce yanlış sonuç verdiyse bu sistem onu tek başına otomatik fark etmez. Test profillerindeki fast/debug koşularında kurtarma çalışmaz.

## Ajanın gördüğü bilgiler

- Çalışan tuvalin JSON'u: paketlerin içi, node'lar ve bağlantılar dahil. Gömülü eşleştirme resimleri çıkarılır; dosya yeniden yazılmaz.
- Hata veren node, onun güncel öğeyle doldurulmuş talimatı, son hata ve sonraki adımlar.
- Paket/döngü bağlamı, mevcut dosya ve değişkenleri.
- Son günlük satırları ve önceki kurtarma raporlarının neden/gözlem/eylem özetleri.
- `screen_read` ile açık pencereler, ekran yazıları ve gerçek ekran görüntüsü.

## Kullanabildiği araçlar

Okuma araçları `screen_read`, `flow_read`, `flow_context`, `target_preview`dır. Eylemler yalnız **Tıkla, Yazı Yaz, Tuş Gönder ve Zamanlayıcı**dır. `step_run`, izinli bir eylem node'unu mevcut öğenin değişkenleriyle bir kere çalıştırır; o node'un bağlı sonraki adımları çalışmaz. İnisiyatif, Koşul, Paket ve Döngü node'ları çağrılamaz. Node/bağlantı düzenleme, branch/merge, başka koşu başlatma veya JSON onarma aracı verilmez. Test CLI/HTTP kapısı normal profilde açılmaz.

Normal yürütücü hata sınırında bekler; döngü veya paket yığını yeniden kurulmaz. Böylece baştan çalıştırma ve indeksle yanlış dosyadan devam etme sorunlarına bağımlı değildir. Ajan başarılı kardeş node'ları tekrar yürütmez; yalnız ayrıca izin verdiğin node'ları seçebilir.

- **Aynı node'u yeniden dene:** Ajan ortamı düzelttikten sonra `recovery_retry` çağırır. Motor aynı öğede asıl node'u bir kere daha çalıştırır.
- **Node zaten çalıştırıldı:** Ajan hata veren node'u `step_run` ile tamamladıysa tekrar çalıştırılmaz; motor bağlı sonraki adıma geçer.
- **Hedef başka yoldan gerçekleşti:** Ajan son hareketinden sonra güncel ekranı okuyup `recovery_complete` çağırabilir. Bu, modelin mevcut hedefin gerçekleştiğine ilişkin gözlemidir; ayrı bir doğrulama modeli çağrılmaz. Rapor bu dayanağı açıkça belirtir.
- **Toparlanamadı:** Ajan durumu raporlar; mevcut dosyada kalınır. Başarısız kurtarmadan sonra listedeki sonraki dosya sessizce çalıştırılmaz.

Varsayılan sınırlar: olay başına 16 araç çağrısı, 180 saniye, koşu başına 10 kurtarma. Ayarlardan değiştirilebilir. Durdur ve Ctrl+Shift+Q, model beklerken de çalışır; gecikmiş yanıt sonradan girdi gönderemez.

## Raporlar

Yeni sekmedeki **Kurtarma raporları** bölümünde Yenile'ye bas. Her olay için hata, olası neden, modelin gösterdiği kanıt, çağrılan araçlar ve gerçek devam denemesinin sonucu ayrı görünür. Olası neden, kesin kanıt olarak sunulmaz.

JSON raporları kullanıcı profilinin `logs/kurtarma` klasörüne atomik olarak yazılır; son 100 rapor korunur. Uygulamayı yeniden açmak veya sürüm yükseltmek onları silmez. **Rapor klasörünü aç** düğmesi dosyalara ulaşır. Raporlar API anahtarını içermez. Model, akışın görev bilgilerini ve ekranını OpenRouter üzerinden alır.

Bu sürümün birim/senaryo testleri sahte model ve ekran yürütücüsüyle yapılmıştır. Gerçek Windows, Chrome, Blender ve ücretli OpenRouter modelinin birlikte kullanıldığı canlı kurtarma ayrıca denenmelidir.
