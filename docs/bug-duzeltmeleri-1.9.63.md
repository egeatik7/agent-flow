# Nubbo 1.9.63 — temkinli hata düzeltme raporu

Tarih: 10 Ekim 2026. Önceki sürüm: 1.9.62 (`45f1c1a`).
Kullanıcının isteği: programı bozma riski olan düzeltmeleri yapmamak ve sonuçları ayrı raporlamak.

## Sonuç: 5 düzeltildi, 2 açık bırakıldı

| Öncelik | Hata | Durum | Yapılan değişiklik / bırakılma nedeni |
| --- | --- | --- | --- |
| Kritik | Paketleme koşulun mantığını değiştirebiliyor | **Açık; değiştirilmedi** | Paketin iç koşulu yanlış dala gitmese bile paket dış devamı koşulsuz çalışıyor. Güvenilir düzeltme, iç yürütmenin hangi çıkıştan sonlandığını paket çağıranına taşımalı; paket içinden devam, dış döngü, End ve hata çıkışlarının davranışları birlikte doğrulanmalı. Bu yamada bu yürütme kuralları değiştirilmedi. |
| Yüksek | Çalışırken tuval düzenlenebiliyor | **Düzeltildi** | NodeCanvas'ın sürükleme, üyelik, bağlantı, silme, ekleme, kopyalama ve paket çıkarma işlemleri canlı kilit kontrolü yapıyor. Çalıştırmadan önce başlamış sürükleme ve bağlantı girişimleri iptal ediliyor. Gezinti/seçim ve motorun durum güncellemeleri devam ediyor. |
| Yüksek | İç içe döngüde seçilenden devam yanlış başlayabiliyor | **Açık; değiştirilmedi** | En dış döngüden açılan yürütmede seçilen iç node bilgisi aşağı aktarılmıyor. Düzeltme bu başlangıcı yalnız ilk ilgili turda taşımalı; sonraki iç/dış turların normal başlangıcını, kapsamı ve değişkenlerini korumalı. Bu yamada döngü başlangıç algoritması değiştirilmedi. |
| Yüksek | Paket içinde aynı dosyadan devam bilgisi kayboluyor | **Düzeltildi** | `resumeLoopId` ve `resumeItem`, hem paket yolundan girişte hem normal paket çağrısında aktarılıyor. Listeye yeni dosya eklenmiş olsa bile kayıtlı dosyadan devam ediliyor. Mevcut kimlik bulunamıyorsa durma davranışı korunuyor. |
| Yüksek | Açık tuval kopyaları birbirinin kaydını eziyor | **Düzeltildi** | Kaydetmeden önce sekmenin açılış/kayıt baz çizgisi güncel depoyla karşılaştırılıyor. Çakışmada yeni kayıt değiştirilmeden hata gösteriliyor; yerel sekme korunuyor. Kapatırken aynı çakışma kapanmayı durduruyor ve günlüğe yazılıyor. Otomasyonların kullandığı güncel kayıt korunuyor. |
| Yüksek | Klasör güncellemeleri birbirini iptal ediyor | **Düzeltildi** | Zamanlayıcı ve güncelleme kimliği tuval/node başına tutuluyor. İki farklı klasör bağımsız yenileniyor; aynı node'un eski yanıtı yeni isteği ezemiyor. Tuval değiştirilmişse sonuç başlatıldığı sekmeye uygulanıyor; bileşen kapatıldığında bekleyen işler geçersizleşiyor. |
| Yüksek | Chrome arka plan sekmeleri hedeflere karışıyor | **Düzeltildi** | DOM koordinatları yalnız görünür ve odaklı sayfadan toplanıyor. Toplama sırasında sekme değişirse sonuç atılıyor. Kontrol başarısızsa o sayfadan hedef üretilmiyor; normal diğer ekran okuma yolları devam ediyor. |

## Açık hatalarda geçici kullanım

- Koşullu paket çıkışı güvenli sayılmamalı. Bu davranışa bağlı koşulları paketlemeyin; mevcut sorunlu paketi çıkarıp özgün bağlantıları kontrol edin.
- İç içe döngüde iç node'dan devam, daha önceki adımı tekrarlayabilir. Böyle bir seçimden devam etmeyin; tekrar edilmesi kabul edilebilir bir başlangıç seçin.
- Kayıt çakışmasında güncel tuvali Tuvaller'den yeni sekmede açabilirsiniz. Eski sekmedeki düzenleme otomatik birleştirilmez. Yerel düzenlemeyi korumak için Dışa Aktar kullanılabilir.

## Doğrulama

- `npm test`: **553 başarılı, 5 atlanan** test (76 başarılı test dosyası, 1 atlanan).
- 12 yeni regresyon testi: bağımsız klasör güncellemeleri; aynı node'da ters sırada yanıtlar; sekme değişimi; çalışan tuvalde sürükleme/silme; başlayan sürüklemenin iptali; paket içi kimliğin iki giriş yolunda korunması; eski kaydın çakışmada değişmeden kalması; Chrome görünürlük/odak ve toplama sırasında sekme değişimi.
- `node --test scripts/test-stability-bridge-browser.cjs`: **10 başarılı** test.
- `npm run typecheck`: başarılı.
- `npm run build:electron`: renderer ve ana süreç derlemesi başarılı.
- `git diff --check`: başarılı.
- Önceki hata taramasındaki iki açık hata tekrar üretme testi, yamalı kaynakta aynı hataları hâlâ doğruluyor. Bunlar başarısız regresyonların saklanması değildir; bilerek değiştirilmemiş açık kusurlardır.

Sınır: testler masaüstü girişini ve Chrome bağlantısını kontrollü nesnelerle sınar. Bu ortamda canlı Windows masaüstü, kullanıcı Chrome profilleri, ONNX çalışma zamanı veya uzun süreli gerçek otomasyon çalıştırılmadı. Sıfır risk veya tüm hataların giderildiği iddia edilmiyor. Liste dışındaki iki orta öncelikli tarama bulgusu bu yamanın kapsamına alınmadı.

## Teslimat

Bu sürüm kaynak kod ve patch olarak teslim edilir; Windows EXE değildir. XP görünümü ve kurtarma ajanı önceki kaynak sürümünden korunur. Kullanıcının mevcut tuval dosyaları ve ayarları topluca dönüştürülmez veya silinmez. Değişiklikler dış GitHub deposuna gönderilmedi.
