# Sade Nubbo arayüzü ve test CLI'ı

Bu değişiklik 1.9.32 / 683a55b üzerine hazırlandı. Kullanıcı kararı: ürünün odağı mevcut node'ların güvenilir çalışmasıdır. Yeni onarım yöneticisi eklenmez.

## Kullanıcı arayüzü

Ajan tavsiyeleri paneli, öneri inceleme görünümü, öneri işaretleri, öneri merge/undo transportu ve arayüzdeki CLI araç/izin/endpoint kontrolleri kaldırılır. Ajan sekmesi ekran değerlendirme ayarıyla kalır. Node, LLM ve Ayarlar sekmeleri; akış/paket/döngü editörü; ekran tarayıcı ve normal çalıştırma korunur. Model/anahtar ayarları mevcut yerlerinde kalır.

Kayıtlı node/akış/ayar/branch verileri topluca temizlenmez veya dönüştürülmez. Kullanıcı artık öneri görünümünde çalıştırma veya dışa aktarma yapmaz; normal tuvalini kullanır. Eski branch düzenleme/veri kodu test senaryolarının uyumluluğu için içeride kalır. Test CLI'ındaki branch.show ve uygulamalı merge kullanıcı tuvaline ulaşamaz; açık ret alır. Bu özelliklerin testlerini ileride kullanıcı arayüzünden geçirmeye çalışma.

## CLI yalnız test oturumunda

İki başlatma koşulu birlikte gerekir:

```powershell
$env:NUBBO_PROFILE = 'test'
$env:NUBBO_TEST_TOOLS = '1'
```

Bunlar yalnız başlatılan test uygulamasına verilmelidir. Normal Nubbo'yu bu ortamla başlatma. Ayrı profil olmadan bayrak kapıyı açamaz; bayrak olmadan ayrı profil de araçları açamaz. Kaydedilmiş agentEndpoint ayarı normal kullanıcı oturumunda etkisizdir. Ayar dosyası silinmez. Mevcut tool token/izin/durdurma/odak korumaları korunur; agentPermission otomatik olarak auto yapılmaz.

Mevcut yardımcı `node scripts/dev-start-test.cjs test`, test EXE'sini başlatırken iki değişkeni de verir. Önce güncel EXE'yi Windows'ta paketle. Yardımcının mevcut kopyalama/başlatma adımlarını kullan; farklı motor veya yeni arka plan uygulaması kurma. CLI'ın var olan ekran okuma, hedef önizleme, tek adım, koşu/durum/log ve durdurma çağrıları test katmanında korunur.

Token dosyası test oturumunun userData klasöründeki `tool-endpoint.json` dosyasıdır. Test izinlerini o ayrı profilin mevcut ayarlarında yapılandır. Kişisel profilin akış veya ayarlarını test için değiştirme. Ayrı profil veriyi ayırır; testler yine aynı fiziksel masaüstüne tıklayabilir.

## Doğrulama kapsamı

Bu temizlikte tür denetimi, mevcut testler ve Electron build kontrol edilir. Gerçek Windows'ta arayüzün açılması ve test endpointinin başlatılması ayrıca denenmelidir. Kapsamlı tıklama/yazma/OCR/pencere/döngü sağlamlaştırma testleri sonraki iştir.
