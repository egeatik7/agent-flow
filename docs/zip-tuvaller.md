# JSON tuvaller ve ZIP kütüphanesi

Kütüphane varsayılan olarak Windows Belgeler klasöründeki `Nubbo/Kütüphane` altındadır. Sağ tık menüsündeki **Kütüphane klasörünü değiştir…** ile başka bir gerçek klasör seçilir.

- **Yeni Grup**: seçilen bölümde fiziksel ZIP oluşturur. Alt klasör ağacı yoktur.
- **Tuvaller**: ana klasörün ZIP’leri. **Arşiv**: gerçek `Arşiv` alt klasörünün ZIP’leri.
- **ZIP Aç…**: dışarıdaki ZIP içindeki JSON’ları doğrular ve grubu kütüphaneye ekler. Kaynak ZIP değiştirilmez. ZIP’i Explorer ile doğrudan kütüphane klasörüne de koyabilirsin; sonra **Kütüphaneyi yeniden yükle**.
- Her JSON üst seviyede `nodes`, `edges`, `format`, `version`, `canvasId`, `name` içerir. Tuvalin kimliği `canvasId` alanıdır.
- JSON adları `0001_Ad.json`, `0002_Ad.json` şeklindedir. Bu isimler sırayı taşır; ek katalog, SQLite veya manifest yoktur. Dışarıda numaraları değiştirerek sırayı değiştirebilirsin. Sonraki açık kayıt sıralı isimleri yeniden üretir.
- ZIP içindeki JSON’lar doğrudan ZIP kökünde bulunur; iç içe JSON klasörleri desteklenmez.

## Açma, sıralama ve çalıştırma

Gruba tıklamak içeriğini gösterir; tuvale çift tıklamak yeni çalışma sekmesi açar. JSON’a sağ tık → **Yukarı taşı / Aşağı taşı** kayıtlı ZIP sırasını değiştirir.

Gruba sağ tık → **Otomasyon olarak aç**, o gruptaki tuvallerin üstten alta sırasını sekmelere soldan sağa yükler. Mevcut sekmelerdeki değişiklikler önce Kaydet / Kaydetme / İptal ile sorulur. Üstteki ▶ açık sırayı çalıştırır. Bir tuval Bitti node’una hatasız ulaşmadan sonraki başlamaz. Sekmeleri sürükleyerek değiştirmek yalnız açık çalışma sırasını değiştirir.

## Kaydetme ve kimlik

Otomatik kayıt ZIP’i değiştirmez; çalışma sekmelerini yerel profilde saklar. **Kaydet**, açık tuvalin bağlı olduğu ZIP içindeki JSON’u günceller. Yeni tuvalde Kaydet kendi ZIP grubunu oluşturur; bir grubun sağ tık menüsündeki **Tuvali bu ZIP’e kaydet** veya **Yeni Tuval** o gruba ekler.

**Farklı Kaydet** yeni kimlik ve yeni ZIP oluşturur. Başka gruba mevcut tuvali kaydetmek de ayrı kimlikli kopyadır. **Tuvali çoğalt** aynı ZIP’e ayrı kimlikli JSON ekler.

Aynı kimliğin kütüphanede ikinci kez bulunması çakışmadır. Yeni sürüm veya elle kopyalanan ZIP mevcut tuvali sessizce ezmez. **ZIP’i kopya olarak içe aktar…** ayrı kimliklerle kopya oluşturur. Dışarıda değiştirilmiş kayıt için yeniden yükle, güncel tuvali aç veya Farklı Kaydet.

## Seçme, silme, arşivleme

Ctrl ile ayrı öğeler, Shift ile görünen satır aralığı, boş alandan sürükleyerek kutu seçilir. **Sil**, Delete veya sağ tık → **Seçilenleri sil** bir onayla seçilen JSON’ları ve ZIP’leri siler. Grup ve çocukları birlikte seçilmişse grup yalnız bir kez silinir. Aynı ZIP’te seçilen JSON’lar tek atomik yazımla kaldırılır. Birden çok ZIP’in işlemleri sırayla uygulanır; sonraki dosyada hata olursa tamamlanmış önceki silmeler geri alınmaz. Yeniden yükle ile gerçek durum görüntülenir.

Silinen kayıt açık sekmenin içeriğini kaldırmaz; sekme kaydedilmemiş taslak olarak kalır. **Arşive taşı / Tuvallere geri al** ZIP’i iki bölüm arasında taşır; kimlikler korunur.

## Paylaşma ve kurtarma

Grup sağ tık → **ZIP’i dışa aktar…** veya Windows’ta gerçek ZIP’i kopyalamak yeterlidir. Ayarlar, API anahtarları ve açık taslaklar ZIP’e eklenmez; tuvalde yazılı dosya yolları içerikte kalır.

Başlangıçta açık tuval yoktur. Bir çökmeden kalan değişiklikler **Kurtarma taslakları** altında Aç / Sil ile erişilebilir. Eski `Nubbo.library` / katalog yapısı için göç yoktur; yeni yapı eski kütüphaneyi okumaz.
