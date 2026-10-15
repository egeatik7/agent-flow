# Hedef/Yap başarısızlığından kurtarmaya devir

Taban: 1.9.145 / b555f5352ddb8fb116c18e5514565f1058d2b91d.

Hedef seçen modeller koşuyu bilinçli vazgeçmeyle bitiremez. Görsel `terminate/failure`, liste `give_up:true` veya sıradan `id:null`, mevcut yöntem için sonuç alınamadığı anlamındadır. Sonraki açık yöntemler kullanıcı sırasıyla denenir. Hepsi tükenirse hata aynı node, aynı döngü öğesi ve aynı yürütme yığınıyla runner'ın kurtarma sınırına çıkar. Hedef arama veya görsel imleç onayı içindeki tekrar, bu devri engelleyemez.

- Kurtarma `completed`: hedef kurtarma tarafından tamamlanmıştır; node tekrar gönderilmez, normal adım aralığı beklenip devam edilir.
- Kurtarma `retry`: gönderilmemiş node aynı öğede tekrar denenir, güncel ekran alınır. Önceki node'lar yeniden oynatılmaz.
- Kurtarma `stop`: yalnız kurtarma modelinin açık `recovery_stop` aracı; `DeliberateStopError` burada üretilir.
- Kurtarma `failed`: araç/süre/koşu bütçesi veya kurtarma çağrısı başarısızlığı; ayrı `RecoveryFailedError` ile durur. Bilinçli vazgeçme denmez.
- Kurtarma `disabled`, karar yok veya bağlı kurtarma yürütücüsü yok: kurtarma aşamasına ulaşıldığı, ajanın çalıştırılamadığı ve koşunun bu adımda durduğu açıklanır. Sessiz iç tekrar yoktur.

Yap'ın `task_give_up` araç adı uyumluluk için korunur. Artık görevin kurtarmaya devridir; `TaskNeedsRecoveryError` üretir. Önceden girdi gönderilmiş olma bilgisi kaybolmaz.

Girdi gönderimi belirsizse aynı komut körlemesine yinelenmez. Kurtarma `retry` dese bile bu engel korunur; kurtarmanın güncel durumdan tamamlaması veya başarısız olması beklenir. Kullanıcı Durdur'a bastığında yeni eylem başlatılmaz.

Bu değişiklik Alt+Tab seçicisine özel değildir. Otomatik ESC, pencere adına özel kural, modifier bırakma veya kısayolu tekrar gönderme eklemez. Kurtarma mevcut yetkileri ve güncel ekranıyla karar verir. Kayıtlı JSON/ayar şeması ve APK arayüzü değişmez; kurtarma otomatik açılmaz.

Koşulun geçerli true/false kararları, normal Bitiş, yapısal ön kontrol ve debug/probe duruşları korunur. Koşulun teknik hata tekrarları, Yap'ın model bağlantı tekrarları ve klasör okuma tekrarları bu patch'in kapsamında yeniden tasarlanmamıştır. Bu paket tüm olası çalışma zamanı duruşlarının kaldırıldığını iddia etmez; hedef/Yap vazgeçmesinin kurtarmayı atlaması sorununu düzeltir.
