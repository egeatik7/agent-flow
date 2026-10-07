# Tk yazma ve inisiyatif hedef seçimi düzeltmeleri

Temel: main `6576a61` (1.9.37). Kullanıcı 7 Ekim 2026'da ölçülen yazma ve yanlış profil tıklaması sorunlarının motor içinde düzeltilmesini açıkça istedi; değişiklik bu kapsamda worker/agent dosyalarına dokunur. Runner, node şemaları, kullanıcı akışları ve kaydedilmiş özel promptlar değiştirilmez. Main'e otomatik merge yapılmaz.

## Ölçülen sorunlar

`calistirma-2026-10-07T20-19-04.txt`: DeepSeek klasör yolu kelimesini doğru tarif etmiş, fakat açıklama ve tamamlanmamış JSON döndürmüş. Bunun hedef yok diye değerlendirilmesi görsel yola gereksiz geçiş yaratmış. Tıklama y=462 civarına yapılmış; Tk, y=369 konumunda sabit 1x1 caret ve koca pencere büyüklüğünde odak kutusu bildirmiş. Yazma caret hizası kontrolünde reddedilmiş. İnisiyatifin üçüncü profil için ilk koordinatı profil ekleme kartına gitmiş; kullanıcı bunu doğruladı.

## Yeni yazma yolu

Normal UIA/native Edit ve gerçek caret ile çalışan yollar korunur. Tk'nin 1x1 caret'i doğrudan yazma izni vermez. Yazma reddedildiğinde, yalnız açık değiştirme yazımında ve henüz silme/yazma gönderilmemişken:

1. Yeni OCR taraması alınır. Hedef pencere içindeki tıklanan satırın yakınında tek, yeterince uzun metin satırı gerekir. Birden fazla olası alan varsa kanıt üretilmez.
2. Hedef HWND/PID, yerleşim, odak, görünür noktanın aynı pencereye ait olması ve devre dışı/salt okunur kontrol retleri uygulanır.
3. Ctrl+A/C ile mevcut alan metni kopyalanır. Bu aşama Delete, yapıştırma, yazma ve Enter göndermez. Pano metni ve diğer formatlar geri yüklenir.
4. Kopyalanan tam değer OCR ile karşılaştırılır. Kısa ortak önek yetmez; uzunluk ve sınırlı OCR yazım toleransı kontrol edilir. Yolun son dosya/klasör bileşeni ayrıca karşılaştırılır.
5. Worker'ın rastgele tek kullanımlık kanıtı pencere/odak/nokta ile bağlıdır; 8 saniyede geçersizleşir. Silmeden önce değer yeniden okunur. Değişmiş değer/odak veya eski kanıt yazmayı reddeder.
6. Yazılan tam değer geri okunur; Enter ancak mevcut yazma politikasınca uygun olduğunda bir kez gönderilir.

Bu yol runtime kanıtıdır; node'a veya akış JSON'una token/metin kaydedilmez. Pano içeriği günlükte yazılmaz. Boş alan, başarısız kopyalama, belirsiz OCR veya çok farklı OCR sonucu bu yoldan izin alamaz; mevcut odak kurtarma/gerçek caret yolu gerekir. Özellikle boş ve yalnız dummy caret bildiren bütün özel alanların desteklendiği iddia edilmez. OCR toleransı ölçümsel bir eşleştirmedir, matematiksel alan kimliği garantisi değildir.

## Model yanıtı ve görev kapsamı

Token sınırında kesilmiş yanıt hata olarak model zincirine gider. Hedef JSON'u çözülemeyen yanıt, `id:null` ile bildirilmiş gerçek bir eşleşmeme kararı sayılmaz. Geçerli JSON/adayı sonraki modelden alma yolu çalışır. Açıklamadaki bir numaradan tıklama uydurulmaz.

Adı belirtilmiş uygulama genel `tarayıcı` etiketiyle ikame edilmemelidir; bu kural eski özel liste promptu olsa da gönderilen kelime kurallarında bulunur. İnisiyatifin kapsam sözleşmesi, özel promptları değiştirmeden yeni çağrının bağlamına eklenir: hedef gerçekleşince bitir; başka görev araştırma, gereksiz sekme değiştirme veya istenmeyen kurulum yapma; mevcut öğeyi Add/New/Create ile karıştırma.

## Görsel inisiyatifte önce fareyi taşı

Görsel inisiyatifte koordinatlı **tek tık** önerisi yalnız harekete çevrilir. Sonraki görüntüde model imleci ve hedefi görür; doğru hedefte `click_current` seçer veya imleci başka yere taşır. O tur geçmişine gerçekten yürütülen hareket yazılır; ilk öneri tıklanmış gösterilmez. Bekleyen tıklama, yazma/tuş/sürükleme gibi eylemlerle atlanamaz. Yalnız hareketten sonra `finished` önerilen tıklamanın yapılmış olduğunu kanıtlamaz ve tamam sayılmaz.

Eski tek tık/hareket/oradan tıklama içeren görsel kayıtlar körlemesine oynatılmaz; mevcut kareyle modele dönülür. Kayıtlı veriler silinmez. Normal Tıkla node'u ve bağımsız çift/sağ tıklama davranışı korunur. Liste motoru koordinatlı görsel inisiyatif değildir; tek-tık hareket politikası bu motora eklenmemiştir.

Bu, ikinci bir tamamlanma modeli veya her adıma koşul node'u değildir. Model yine doğru hedefi yorumlamak zorundadır; yanlış hedefi kesinlikle seçmeyeceği garanti edilmez. Her görsel tek tık en az bir ek model turu/görüntü gerektirir ve maxActions bütçesinden yer kullanır.

## Yerel kanıt ve gerçek Windows kabulü

Vitest, gerçek derlenmiş ajan testleri ve gerçek worker fonksiyonlarıyla Windows API sınırları taklit edilerek kontroller yürütülür. Bu Linux ortamında gerçek Windows girdi/clipboard/Tk davranışı ölçülmedi; Windows PowerShell 5.1 çalıştırılmadı. PR, mevcut Windows 2022/2025 CI'sini tetikler; sonuçlar tamamlanmadan yeşil ilan edilmez. CI'nin PowerShell 5.1/7 listesine visual-input, hover-worker ve cursor-frame kontrolleri eklenmiştir.

Merge ve EXE derlemesinden önce gerçek Windows kabulü:

- Görsel İsimlendirici'de mevcut dolu klasör yolu alanını Tıkla -> Yazı Yaz ile değiştir. Logda `Tk alanı ... kopyalanan değer eşleşti` ve tam değer geri okumasını ara. İşlem sırasında gerçek API anahtarını ekrana/loga koyma.
- Aynı denemeyi yanlış alana tıklayarak yap; farklı kopya değeri nedeniyle Delete/yazma gönderilmemeli.
- Kopya denemesi sırasında Durdur; ardından yazma/Enter gönderilmemeli. Pano metni ve dosya listesi formatını koruduğunu kontrol et.
- Boş alanı ayrıca dene: dummy caret ile kopya kanıtı uydurulmamalı. Standart Edit ve gerçek caret destekleri çalışmayı sürdürmeli.
- Chrome'da yalnız mevcut üçüncü profili açma görevi ver. İlk koordinat önerisinin hareket olarak kaydedildiğini, sonraki kare görülmeden tek tık gönderilmediğini ve profil ekleme akışına girilmediğini gözle. Kullanıcının masaüstü boşken test profili/dev-safe kapısıyla dene.
- Tamamlanmış profil görevinde ilgisiz sekmeler kurcalanmamalı. Buna aykırı model davranışı görülürse ekran/logla raporla; prompt düzeltmesi tek başına ölçülmüş model garantisi değildir.

Testler gerçek EXE kabulünün yerine geçmez. Bu PR EXE içermez; Windows'ta `npm ci`, testler ve `npm run pack:win` ile üretilebilir.
