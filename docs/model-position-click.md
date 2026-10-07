# Görsel İnisiyatif: önce konum, sonra modelin tıklaması

Kullanıcının isteği: model önce hedefin konumunu belirlesin; yeni görüntüde
tek/çift/sağ tıklamayı eskisi gibi kendisi seçsin. Script, modelin yerine tıklama
türü belirlemesin veya bütün tıklamaları tek `click_current` eylemine zorlamasın.

## Davranış

1. Model `move` gönderir. Tıklama gönderilmez; yeni ekran görüntüsü alınır.
2. Model pointer ve hedefi değerlendirir. Aynı hazırlanmış noktada kendi normal
   `click`, `double` veya `right` eylemini gönderir; bu eylemin türü korunur.
3. Hazırlanmamış bir hedefte tıklama önerirse yalnız hareket yapılır. Sonraki
   karede modelin tekrar karar vermesi gerekir. Başka noktaya geçmek de aynı
   hazırlık adımını gerektirir. Hareketten sonra otomatik tıklama yoktur.
4. `click_current` isteğe bağlı tek tık olarak desteklenir; zorunlu değildir.

Modelin klik koordinatı son hover noktasından mevcut 3 px toleransı içinde olmalı.
Native imleç kaydı, yaşı ve pencere kimliği korunur; farklı pencereye veya eski
noktaya basılmaz. Durdurma sırasında gelen geç model yanıtı tıklama üretmez.

Pointer hazırlığı uygulamanın görünümünü değiştirmek zorunda değildir. Bu yüzden
hareketler "ekran değişmedi" sayacına girmez. `maxActions` bütün model turlarını
sınırlar; yalnız hareketle sonsuz çalışma olmaz. Gerçek etkileşimlerin mevcut
takılma koruması devam eder.

Runtime prompt bu yöntemi kullanıcı kayıtlı eski prompt'u olsa da modele bildirir.
Varsayılan screenshot prompt'u da güncellenir; kayıtlı özel prompt verisi ezilmez.
Masaüstü kısayolunu seçmek ve açmak ayrımı açıklanır; her tıklamaya otomatik çift
tık eklenmez. İkinci LLM tamamlanma kontrolü eklenmez.

Bu değişiklik görsel İnisiyatif yolundadır. Tıkla node'larının tek/çift/sağ modları,
OCR/liste hedef seçimi, döngüler, node şeması ve 1.9.39 doğrudan yazma düzeltmesi
korunur. Fare eylemi içeren kayıtlı görsel yollar güncel konum incelemeden körlemesine
oynatılmaz; eski kayıtlar silinmez.

## Kanıt ve sınırlar

Derlenmiş gerçek motor testleri: konumdan sonra normal tek/çift/sağ tıklama,
hazırlanmamış ilk önerinin yalnız move olması, yeni noktada yeni kare gerektirme,
8 hareketin yanlış takılma üretmemesi, durdurma ve başka pencereye tıklamama.
7 yeni vaka eski 1.9.39 motorunda başarısız; düzeltmede başarılıdır.

OS/model sınırları kaydedici taklitlerdir. Gerçek Windows masaüstü, canlı Luna
ve Blender açma kabulü bu Linux ortamında yapılmadı. Modelin hedefi yanlış
yorumlamayacağı garanti edilmez; bu değişiklik onun seçtiği eylemi doğru yürütür.
