# Çalıştırma öncesi yapı kontrolü

Bu ek yama, v1.9.142 / c19df8d üzerine uygulanan
`nubbo-israrci-yontem-dongusu-142.patch` sonrasına uygulanır.
Önceki yöntem ısrarı yamasının yerine geçmez.

## Davranış

- Normal ve seçiliden çalıştırmada ilk işlemden önce yapı denetlenir.
- Tuval sıralı oynatmada, sağda çalıştırılacak bütün tuvaller önceden denetlenir.
- Bulgu penceresi tuval, iç paket ve node adını gösterir.
- Silinmiş bağlantı hedefi, geçersiz çıkış, aynı çıkıştan çoklu bağlantı,
  bozuk döngü üyeliği ve ulaşılamayan kayıtlı paket çıkışı çalıştırmayı engeller.
- Sıralı oynatmada kök Bitir node'una ulaşılamaması da engelleyicidir.
- Boş kollar ve ulaşılamayan adımlar uyarıdır. Kullanıcı raporu görüp
  “Yine de çalıştır” diyebilir; otomatik olarak onaylanmaz.
- Döngünün son üyesindeki bağlantısız next, geçerli tur sonudur.
  Kayıtlı paket sınırındaki boş iç çıkış ve eski paketlerin örtük bitişi korunur.
- Seçiliden çalıştırmada bilerek atlanan önceki kök adımlar kopuk sayılmaz.
- Dosya kontrolü başarısız olsa bile yapı kontrolü atlanmaz.
- Ana süreç ve doğrudan runner çağrıları da yapısal hataları işlemden önce reddeder.
  Arayüz dışı çağrılarda uyarılar ana süreç günlüğüne yazılır.

## Debug ve kurtarma

Debug, teknik tanılama çağrısında açıkça verilen `debug: true` seçeneğidir.
Hatayı inceleyebilmek için durma davranışını korur; normal Çalıştır bunu açmaz.
Bu yama debug politikasını veya kurtarmanın mevcut durma sınırlarını değiştirmez.

Bu statik kontrol modelin hangi koşul kolunu seçeceğini ya da dinamik ekranın
sonucunu bilemez. Gelecekteki bütün çalışma hatalarının yok edildiği anlamına gelmez.

## Doğrulama

Yapı ve App testleri ilk giriş gönderilmeden reddetmeyi, sonraki tuvalin önceden
denetlenmesini, paket/loop sınırlarını, seçili başlangıcı ve dosya kontrolü arızasını
kapsar. Eksik paket çıkışı testi artık sessiz bitiş yerine başlangıçta hata bekler.
Eski iç döngü devam testindeki geçersiz ve runner tarafından zaten kullanılmayan
loop.next bağlantısı kaldırıldı; aynı devam ve öğe sırası beklentisi korunur.

Windows masaüstü veya yerel model üzerinde canlı koşu yapılmadı.
