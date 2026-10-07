# Sürüm notu — 1.9.26

Bu sürüm, `feat/test-profile` dalının `main`'e alınmış hâlidir (67 commit). Ana ürün hattı
1.9.24'ten bu yana ciddi biçimde genişledi; aşağıda **davranışı değiştiren** maddeler ayrıca
işaretlendi ve **bilinen açık** en sonda duruyor.

## Yeni
- **Ajan araç katmanı**: 24 araç (`flow.read`, `flow.edit`, `branch.*`, `run.from/run.wait/run.stop/run.report`,
  `step.run`, `act.*`, `screen.read`, `target.preview`, `flow.context` …), yerel uç nokta (yalnız
  `127.0.0.1`, jeton dosyası) ve `nubbo` CLI. Aynı motor çağrılır; ayrı bir tıklayıcı yoktur.
- **Branch akışı**: düzenlemeler tuvalin kopyası değil **tariftir**; kullanıcının akışına ve açık
  tuvaline yazılmaz. Merge iki adımlıdır: deneme herkese açık, **uygulama yalnız panelden**.
- **Paket içi düzenleme/okuma**: `packagePath` ile paketin iç grafı; `flow.read` artık hangi
  **branch’te** okuduğunu söyler.
- **Debug koşusu**: ilk hatalı adımda durur ve o anı dondurur — düğüm, paket yolu, kutu öğesi,
  son adımlar, günlük ve hata görüntüsü (`run.report`).
- **Sınırlı bölge denemesi** (`--until`) ve **hatadan aynı öğeden devam** (kimlikle; kayıtlı öğe
  yeni listede yoksa reddeder).
- Ajan sekmesinde **Ekran doğrulaması**: kapalı / yalnızca günlük (varsayılan) / açık.

## Bilinçli davranış değişiklikleri
1. **Ekran doğrulaması varsayılanı “yalnızca günlük”** (CLAUDE.md §17): eylemden sonra ekrana
   bakılır ve ne görüldüğü yazılır; adım **yargılanmaz** ve model **çağrılmaz**. `off` eylemi
   sözüne güvenerek yapar, `on` yakından bakma ve plan sorma adımlarını da çalıştırır.
2. **Pencere/odak davranışı**: tıklama hedefi yoksa ya da sıradaki adım yazma ise pencere
   etkinleştirilir; eylemden sonra odak geri alınmaz (pencere küçük kalır); küçük hedeflerde
   kırpılmış görüntüyle ikinci bir bakış yapılır.

## Düzeltmeler (öne çıkanlar)
- **Döngü kurulumunda veya tur içinde fırlatılan hata artık adım olayı üretir**: sayaç dürüst olur,
  debug koşusu **bağlamı koruyarak** durur, donmuş rapor açılır. (Öncesi: 115 hata, `0 hata`.)
- Aynı hata kümesi geçişler arası tekrar ederse döngü durur — **yalnız debug koşusunda** (normal
  kullanıcı akışlarının davranışı değişmez).
- `act.type`/`act.key` boşluk argümanı motora ulaşmaz; gönderilen metin **kırpılmaz**.
- İşlemsiz `flow.edit` planı reddedilir; `run.stop` koşu yokken **önceki** durma nedenini değiştirmez.
- Klasörlü kutuda **öğe uydurulmaz**; koşu listeyi doldurduysa gösterilir (hem `flow.context` hem `flow.read`).
- Merge zaman aşımında “**uygulanmış olabilir, durum bilinmiyor**” denir (çelişkili “hiçbir şey
  yazılmadı” kalktı).
- Merge beklemesi sırasında başka branch’e eklenen düzenleme artık **kaybolmaz** (kitap yeniden okunur).
- Kutuya eklenen node **döngü üyeliğine** de yazılır (yalnız `connectFrom` ile değil, ayrı `connect`
  komutlarıyla kurulan onarım da çalışır).
- Geçersiz profil adı (`ç`, `!!!`) sessizce **gerçek profil** klasörüne düşmez.
- Test/araç altyapısı: beş canlı batarya, üç kabul senaryosu; bataryalar artık **beklenen sonucu**
  tek tek doğrular, okunamayan depoyu “değişmedi” saymaz.

## Bilinen açık
- **Tamamlanan kutu yeniden girilebiliyor**: kimi akışlarda kutu bittikten sonra baştan girip
  öğelerini yeniden çalıştırabiliyor (canlı ölçüm: 2. ve 3. öğe 10 geçiş). **Normal tek geçişli
  akışları etkilemez.** Kök neden daraltıldı (`startIndex` sıfırlanıyor ama yeniden girişte bayat
  düğüm referansı okunuyor); **düzeltilmedi**.
- **Saatler süren koşular** ve **gerçek Hunyuan/Blender zinciri** bu sürümde doğrulanmadı.
- Masaüstündeki portable exe **imzasızdır**.
