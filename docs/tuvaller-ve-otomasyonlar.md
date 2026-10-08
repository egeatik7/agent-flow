# Tuvaller ve Otomasyonlar

## Sağdaki Tuvaller penceresi

**Tuvali Kaydet**, açık olan tuvali sağdaki **Kayıtlı Tuvaller** listesine kaydeder. Aynı kayda bağlı bir sekmede tekrar Kaydet, o kaydı günceller. Aynı adı taşıyan başka kayıtları değiştirmez.

- **+**: Kayıtlı tuvali yeni, bağımsız bir üst sekmede açar. Birden fazla kez açılabilir.
- **Kırmızı ×**: Onay penceresi açar. **Evet** kayıtlı tuvali siler, **Hayır** iptal eder. Açık sekmeler ve otomasyonların kendi kopyaları korunur.
- Üstteki sekmenin **×** düğmesi yalnız sekmeyi kapatır. Kaydedilmeyen değişiklikler varsa uyarı gösterir; sağdaki kayıt silinmez. Son açık sekme kapatılamaz.
- Üst sekmeye çift tıklayarak adını değiştirebilirsin. Seçili sekmedeki **‹ / ›** ile sekmeyi sola veya sağa taşıyabilirsin.

Eski sürümden ilk açılışta mevcut kayıtlı sekmeler sağdaki listeye de taşınır. İçerikleri korunur. Silinmiş kayıtlar yeniden başlatınca geri gelmez.

**Dosya → İçe Aktar**, tek tuval JSON'unu yeni sekmede açar ve sağdaki listeye kaydeder; mevcut sekmeyi ezmez. **Dosya → Dışa Aktar** geçerli tuvalin JSON dosyasını indirir. Uygulama, açık sekmelerin çalışma kopyalarını otomatik saklar; sağdaki kalıcı kayıtları güncellemek için **Tuvali Kaydet** kullan.

## Otomasyon grupları

**Yeni otomasyon adı** alanına bir ad yazıp **+ Kaydet** düğmesine bas. Açık sekmelerin **soldan sağa sırası ve tüm içerikleri**, o otomasyonun kendi kopyaları olarak saklanır. En soldaki tuval grubun en üstünde görünür.

Her grubun düğmeleri:

- **✎**: Grubun adını değiştir.
- **Aç**: Grubun kayıtlı tuval listesini üstte aç. Açık sekmelerin yerini değiştireceği için önce onay ister; önemli değişikliklerini önce kaydet.
- **Kaydet**: Grubu şu an açık sekmelerin sırası ve içerikleriyle güncelle. Önce onay ister. Bu bir içerik/sıra kaydıdır; başka bir sekmedeki değişiklik grubu kendiliğinden değiştirmez.
- **Export**: Grubu bütün tuvallerinin içerikleriyle tek JSON dosyasına aktar. Başka Nubbo kurulumunda **Dosya → İçe Aktar** ile sağdaki Otomasyonlar listesine eklenir. İçe aktarmak mevcut açık sekmeleri değiştirmez; ardından **Aç** kullan.
- **Kırmızı ×**: Onay verildiğinde grubu sil. Açık sekmeler ve ayrı kayıtlı tuvaller korunur.

Grubun içindeki her tuval için **+** yalnız o tuvali yeni sekmede açar; **↑ / ↓** kayıtlı sırasını değiştirir; kırmızı **×** onaydan sonra o tuvali yalnız bu gruptan siler. Grubu değiştirmek açık sekmelerin sırasını değiştirmez. Grubun yeni sırasıyla çalıştırmak için **Aç** düğmesine bas.

Kayıtlar Nubbo'nun mevcut kullanıcı profilinde saklanır; bütün bilgisayarın klasörleri kendiliğinden taranmaz. Taşımak/yedeklemek için tuval ve otomasyon JSON dosyalarını dışa aktar.

## Üstteki Oynat / Durdur

Sekme çubuğunun en solundaki **▶**, o an açık olan bütün tuvallerin sırasını sabitler ve **en soldakinin Başlangıç node'undan** çalıştırır. Bir tuval hatasız biçimde kendi **Bitti** node'una ulaşınca sıradaki tuvalin Başlangıç node'u çalışır. Son tuval de bittiğinde sıra tamamlanır. Her tuvalin döngüleri baştan başlar; tuvaller ayrı koşulardır ve döngü değişkenleri birbirine aktarılmaz.

- Seçili sekme hangisi olursa olsun sıra soldan başlar.
- Bütün tuvallere başlamadan önce kök düzeyde Başlangıç ve Bitti node'larının bulunması kontrol edilir. Eksik varsa hiçbir tuval çalıştırılmaz.
- Bağlanmamış bir Bitti node'unun bulunması yeterli değildir: koşu gerçekten Bitti'ye ulaşmalıdır. Bir paketin içindeki Bitti, dış tuvalin Bitti'si sayılmaz.
- Koşu hata verirse, bir döngü öğesi hata vermişse veya Bitti'ye ulaşmadan zincir tükenirse sonraki tuval başlatılmaz. Mevcut tek-tuval çalıştırma ve döngü hata politikası değişmez.
- **■**, o anki koşuyu ve sıranın geri kalanını durdurur. Kaydetme beklenirken basılırsa da bir sonraki koşu başlamaz.
- Çalışma sırasında kayıt silme, sekme değiştirme ve sıralama düğmeleri devre dışıdır. Oynat/Durdur, uzun sekme listesi yatay kaydırıldığında da görünür kalır.
- Her tuvalin ilerlemesi üstte `2/3 · Tuval adı` biçiminde ve günlükte gösterilir.
- Kayıt diske yazılamazsa bu işlem başarılı gösterilmez; tuval sırası sonraki koşuya geçmez.

Bu özellik node'ların tıklama, yazma veya OCR davranışlarını değiştirmez. Her adıma yeni ekran doğrulama/LLM çağrısı eklemez. Bitti bilgisi doğrudan mevcut koşu motorundan gelir.

## Doğrulama kapsamı

Otomatik testler kayıt bağımsızlığı, eski kayıtların taşınması, silme/yeniden açma, isim çakışmaları, sıra, export/import, Durdur, hata ve gerçek Bitti bilgisini kapsar. Arayüz bileşenlerinin üretildiği HTML de test edilir. Gerçek Windows masaüstü, Electron pencere etkileşimleri ve saatler süren gerçek otomasyon bu geliştirme ortamında denenmemiştir.
