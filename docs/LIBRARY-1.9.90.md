# Nubbo 1.9.90 · Kütüphane ve sekme düzeltmeleri

- Kütüphane artık `Nubbo.library` adlı gerçek SQLite dosyasıdır. Klasörler,
  tuvaller, otomasyonlar ve otomasyon sırası ayrı tablolarda tutulur; bağlantılar
  yabancı anahtarlarla doğrulanır. Node grafikleri, eski akışlarla uyumluluk için
  tuval kaydının içerik alanında JSON olarak serileştirilir; ayrı JSON katalog
  dosyaları günlük kayıt formatı değildir.
- Eski `nubbo-library.json` otomatik aktarılır. Tuval/node/otomasyon kimlikleri ve
  klasör bağlantıları korunur; özgün JSON dosyası `Backups/Legacy-…json` olur.
  Bozuk kaynak veya veritabanı üzerine boş kütüphane yazılmaz.
- Kayıt, kilit ve başka yazarı algılama ile korunur. Yeni veritabanı geçici dosya,
  fsync ve atomik değiştirmeyle yayınlanır. Eski veritabanının yedeği tutulur.
  Başarısız disk kaydında önceki sürüm korunur. Son 30 normal yedek saklanır;
  eski JSON aktarım yedeği bu temizliğe dahil edilmez.
- Dosya yöneticisinde Shift aralık, Ctrl çoklu seçim ve boş alandan kutuyla seçim
  vardır. Çoklu seçim birlikte taşınır; klasörde bekleyen sürükleme klasörü açar.
  Boş alana bırakmak ana klasöre taşır. Alt öğeler, üstleriyle beraber seçildiğinde
  klasör yapısı bozulmadan taşınır. Tablet görünümünde düzenleme açılmaz.
- Yeni otomasyon taslağı doğrudan seçilen klasörde görünür; kayıt sonrası aynı
  yerde kalır. Kayıtlı taslak aynı disk işleminde güncellenir; yeniden açılışta
  eski yeni-otomasyon taslağı geri gelmez. Başka otomasyonun sağ tık menüsünden
  açık editörün yanlışlıkla kaydedilmesi engellenir.
- Üst sekmeler ayrı renkler alır, sürüklenerek sıralanır. Sağ-sol oklar kaldırıldı;
  yalnız kapatma çarpısı kaldı. Yeni sekme adını düzenleme sınırı 24 karakterdir.
  Eski uzun adların tam metni ve kimlikleri korunur; ekranda kısaltılır.

Kütüphaneyi paylaşmak için programı kapatıp kütüphane klasörünü gönder veya
**Farklı Klasöre Kaydet…** kullan. Alıcı **Başka Kütüphane Aç…** ile klasörü seçer.
JSON akış/otomasyon içe ve dışa aktarma sürer. Önceki Android APK bu PC sürümüne
bağlanabilir; güncel izleme arayüzünü PC'den alır.

Windows/Android fiziksel cihaz etkileşimi burada sınanmadı. Otomatik testler
gerçek React DOM seçim/sürükleme olaylarını, otomasyon kayıt yaşam döngüsünü,
SQLite aktarımı/geri yükleme, eşzamanlı yazar ve disk hatasında korumayı kapsar.
