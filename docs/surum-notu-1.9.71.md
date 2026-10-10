# Sürüm notu — 1.9.71

Taban: GitHub `main`, 1.9.70, `ec08ffda59b9d592c30cb79843bcb29dca93ba40`.

## Değişiklikler

- Kurtarma ajanının ayrı OpenRouter API anahtarı var. Alan parola olarak gizlenir ve `settings.recovery.apiKey` içinde saklanır. Genel API anahtarı değişmez ve kurtarma için yedek anahtar olarak kullanılmaz. Eski ayarlarda yeni alan boş başlar; kurtarma kullanılıyorsa anahtarı bu sekmede kaydetmek gerekir.
- Genel sekmedeki model zinciri bileşeni kurtarma sekmesinde de kullanılır. Model arama/listesi korunur; ana model ve dört yedek eklenebilir, silinebilir, yukarı/aşağı sıralanabilir.
- Kurtarma raporu olan node'lar mor çerçeve ve not simgesiyle görünür. Paketler ve döngüler alt node'larının raporlarını toplar. Not simgesine basınca tarih, hata, olası neden, gözlem, yapılan işlemler ve gerçek devam sonucu okunur. Birden çok rapor arasında gezinilebilir.
- Raporlar mevcut günlük klasöründeki ayrı JSON kayıtlarında kalır. Son 100 rapor okunur. Kayıtlı tuval kimliği yeni raporlara eklenir; eski raporlar node kimliğiyle okunmaya devam eder. Tuval JSON şeması ve bağlantılar değiştirilmez.
- Normal eylem hatasında mevcut yürütme yığını kurtarma sonucunu bekler. Başarılı kurtarma aynı öğede devam eder; çözülemeyen hata akışı sonlandırır. Kurtarma kapalıysa eski hata davranışı sürer. Bu yürütücü davranışı korunup gerçek main/runner entegrasyonuyla doğrulandı.
- Kurtarmanın başlangıcı, ilerlemesi ve sonucu HUD ve ana tuval alanında görünür. Kapalı olduğu için, hızlı koşu veya hata ayıklama nedeniyle devreye girmediyse gerekçesi gösterilir. Durdur düğmesi kurtarmayı da durdurur.
- Ekran doğrulaması bağımsızdır. “Yalnızca günlük” belirsiz ekran tepkisini hata saymaz; gerçek eylem hataları kurtarmayı tetikler. Kurtarma ajanının araç izinleri genişletilmedi: İnisiyatif/Koşul/Paket/Döngü çağırma izni yoktur. Akış yapısı/klasör/başlangıç sorunları otomatik JSON onarımına çevrilmez.

## Doğrulama

Typecheck, renderer/main derlemesi, Vitest ve beş Node test paketi çalıştırıldı. Paket içindeki DOĞRULAMA.txt nihai sonuçları içerir. Anahtar ayrılığı, yedek sıralama, değişmeyen tuval JSON'u, iç içe rapor toplama, çalışma sırasında not okuma ve kurtarmadan önce nihai hata verilmemesi kontrol edildi.

Bu ortam Linux'tur. Windows PowerShell 5.1 masaüstü harness'leri ve gerçek Windows EXE koşusu doğrulanamadı. CLAUDE.md otomatik yayın zincirinin tam Windows geçidi tamamlanmadığı için GitHub main/etiket yayını ve EXE teslimi yapılmadı; teslim 1.9.70 üzerine uygulanacak kaynak patch'idir.
