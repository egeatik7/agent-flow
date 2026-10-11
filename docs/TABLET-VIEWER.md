# Nubbo Tablet İzleme · PC 1.9.89 / APK 1.0.0

Android 8 ve üzeri için yalnız izleme uygulaması. PC’deki aynı XP arayüzünün
tuval, paket, kütüphane, otomasyon, günlük ve kurtarma raporu görünümünü kullanır.

## Kurulum

1. PC’de bu değişiklikleri içeren Nubbo 1.9.89’u çalıştır.
2. PC ve Android tablette Tailscale’i aynı tailnet’e bağla. Aynı Wi-Fi gerekmez;
   okuldan da erişilebilir. PC açık, internete bağlı ve Nubbo çalışıyor olmalı.
3. PC’de üst menüden **Tablet İzleme → İzlemeyi Aç**. İlk kullanımda Tailscale’in
   verdiği HTTPS etkinleştirme bağlantısının yönetici hesabından onaylanması gerekebilir.
4. Tablete `Nubbo_Viewer.apk` yükle; **PC’deki QR Kodunu Okut**. Kamera izni
   isteğe bağlıdır: eşleştirme bağlantısını yapıştırarak da bağlanabilirsin.
5. **Çalışan tuval** canlı koşuyu açar. **Çalışan adıma git** doğru paketi açıp
   node’a götürür. Kütüphaneden başka tuvallere bakmak PC’nin görünümünü değiştirmez.

Tek parmak, node üstünden de tuvali kaydırır. İki parmak yakınlaştırır. Kısa dokunuş
node ayrıntısını açar veya pakete girer. Kutuyla seçme, düzenleme, çalıştırma,
durdurma, dosya işlemleri, OCR ve kod çalıştırma APK’de yoktur.

## Bağlantı ve güncellemeler

PC’deki HTTP/WebSocket servisi yalnız `127.0.0.1:31389` adresine bağlanır.
Tailscale Serve bunu `https://<pc>.<tailnet>.ts.net:8443/viewer` adresinde HTTPS/WSS
ile tailnet içinde sunar. İnternete açık Funnel veya modem port yönlendirmesi kullanılmaz.
8443’te başka bir servis varsa üzerine yazılmaz. Tailnet erişim kurallarının tabletin
PC’nin 8443 portuna erişmesine izin vermesi gerekir.

Rastgele eşleştirme anahtarı WebSocket aboneliğinde doğrulanır; URL parçasında
taşındığı için HTTP isteğine/referrer’a eklenmez. **Eşleştirmeyi Yenile** eski
bağlantıları geçersiz kılar. Sunucuda çalıştırma/yazma uç noktası bulunmaz;
abonelik sonrası komut gönderen istemci kapatılır.

İlk bağlantıda gerçek çalıştırma grafiği, güncel node durumları ve kayıtlar alınır;
sonraki mesajlar artan sıra numarasıyla gelir. Kopma veya eksik mesajda yeniden
bağlanıp tam güncel durumu alır. Çevrimdışıyken son alınan durum açıkça işaretlenir.
Arka plandan dönüşte bağlantı tazelenir. Aktif izleme sırasında ekran açık tutulur.

APK, PC’nin kendi derlemesindeki izleme sayfasını açar. PC’de arayüz/node değişirse
tablette sonraki bağlantı/yenilemede aynı sürüm görünür; APK yeniden kurulmaz.
Yalnız Android kabuğu veya bağlantı protokolü değişirse yeni APK gerekir.
APK’de native JavaScript köprüsü veya Windows araçları bulunmaz.

## Geliştirici

`npm ci`, `npm run typecheck`, `npm test`, `npm run build:electron`.
Windows taşınabilir EXE için `npm run pack:win`.

APK derlemesi JDK 17, Android platform/build-tools 35 ve ZXing core 3.5.3 ister:

```sh
python scripts/build-viewer-apk.py --sdk /path/android-sdk --zxing /path/zxing-core-3.5.3.jar --key /private/nubbo-viewer.p12 --password-file /private/password.txt --out /output/Nubbo_Viewer.apk
```

İmza anahtarını ve şifre dosyasını koru; sonraki APK güncellemeleri aynı anahtarla
imzalanmalı. Bunlar git’e veya dağıtım paketine konmaz. Android shell sürümü için
manifestte `versionCode` artırılır. APK kaynakları `android-viewer/` altındadır.
