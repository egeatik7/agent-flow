# Tuvaller ve taşınabilir kütüphane

Sağ panelin **Tuvaller** sekmesindeki **Tuvaller / Otomasyonlar** aynı klasör ağacını kullanır. Maskot, kaydırılan listeden ayrı alt bölmede durur.

## Klasörleri düzenleme

- Boş alana veya klasöre **sağ tık → Yeni Klasör…**. Klasörden çağırırsan alt klasör oluşur.
- Tuvali, otomasyonu veya klasörü başka klasöre sürükle. Boş liste alanına bırakmak ana klasöre taşır. Ctrl ile çoklu, Shift ile aralık seçilir. Boş alandan sürüklemek kutuyla seçim yapar. Klasör ve çocukları birlikte seçilirse hiyerarşi korunur.
- Klasöre çift tıklamak veya **+ / −** açıp kapatır. Tuvale çift tıklamak yeni çalışma sekmesi açar.
- **Sağ tık → Arşivle**, klasörü içeriğiyle **Arşiv** görünümüne alır. Bağlantılar korunur. **Arşivden Geri Al** geri döndürür; arşivli klasörün tek çocuğunu geri almak ana klasörde görünmesini sağlar.
- **Boş Klasörü Sil** dolu klasörü silmez. Diğer işlemler de sağ tık menüsündedir. Sekmeyi kapatmak kütüphane kaydını silmez.

## Konum seçme ve paylaşma

1. **Sağ tık → Farklı Klasöre Kaydet…** ile klasör seç. Kütüphane oraya kopyalanır; program bundan sonra oradan okur ve yazar. Açık sekmeler korunur, eski klasör bırakılır.
2. Seçilen klasördeki **Nubbo.library** dosyasını paylaş. İstersen **Backups** ile bütün klasörü gönder.
3. Alan kişi dosyayı bir klasöre koyup **Başka Kütüphane Aç…** ile o klasörü seçer. Açık değişiklikler önce gözden geçirilir.

Kütüphane, SQLite veritabanıdır; klasörleri, arşiv durumunu, tuval içeriklerini ve otomasyon sıralarını ayrı tablolarda taşır. API anahtarları, ayarlar, çalışma sekmeleri ve kurtarma taslakları yerel profilde kalır. Tuvallerde yazılı dosya yolları ve komutlar aynen taşınır; başka bilgisayarda ilgili kaynaklar da bulunmalıdır.

Mevcut kütüphane içeren klasörün üzerine kopyalanmaz; **Başka Kütüphane Aç** kullan. Klasör sonradan taşınmışsa açılış hatası ekranındaki **Kütüphane Aç…** ile yeni konum seçilebilir. Eksik veya bozuk dosya boş kayıtla değiştirilmez.

## Kaydetme ve yedekler

Node değişiklikleri çalışma taslağına kaydedilir. Asıl kütüphane içeriğini güncellemek için **Ctrl+S**, **Dosya → Tuvali Kaydet** veya **sağ tık → Açık Tuvali Kaydet** kullan. Bağlı otomasyonlar güncel kaydı kullanır. **Farklı Kaydet** yeni kimlik oluşturur; eski otomasyon bağlantıları korunur.

Kütüphane değişiklikleri atomik yazılır; önceki sürüm **Backups** altına alınır. Otomatik kayıtlarda son 30 yedek korunur. **Kütüphaneyi Yedekle** elle yedek oluşturur. **Yedekten Geri Yükle…** mevcut kütüphaneyi de yedekleyerek seçilen yedeği açar.

Başka bir program aynı dosyayı değiştirirse eski kopya üzerine yazılmaz. Kütüphaneyi yeniden açarak güncel kaydı yükle; kaydedilmemiş içeriği önce ayrı dosyaya dışa aktarabilirsin.

## Otomasyonlar

1. **Otomasyonlar → sağ tık → Yeni Otomasyon**. Klasörden çağırırsan otomasyon o klasörde kaydedilir. Adı sağ tıktan değiştirilir.
2. Kayıtlı otomasyona çift tıklamak listesini adının hemen altında açar veya kapatır; taslak silinmez.
3. **Tuval Ekle…** ile klasör ağacından seçip **Ekle**. Ctrl ile birden çok tuval seçilebilir; zaten eklenmiş kayıtlar tekrar gösterilmez.
4. Satırları sürükleyerek veya **sağ tık → Yukarı Taşı / Aşağı Taşı** ile sırala. **Listeden Çıkar** kütüphanedeki tuvali silmez.
5. **Kaydet**, adı ve listeyi kaydeder. Node içerikleri için tuvali ayrıca kaydet veya **Tümünü Kaydet** kullan. Kapanışta taslak için kaydet, vazgeç veya iptal seçilebilir.
6. **Sağ tık → Otomasyonu Aç** kayıtlı sırayı üst sekmelere yükler. Üst sekme sırası ile kayıtlı otomasyon sırası ayrı çalışma durumlarıdır.

Otomasyon, tuval kopyaları yerine kütüphane kimliklerine bağlı liste tutar. Tuvali taşımak veya arşivlemek bağlantıyı değiştirmez. Silmek onay ister ve otomasyonlardan ilgili bağlantıyı kaldırır; açık çalışma kopyaları kalır. Dışarıdan değiştirilmiş kayıt eski taslakla ezilmez; sağ tıktan **Yeniden Yükle** kullanılabilir.

**Dışa Aktar…** tek otomasyonu ve kullandığı tuvalleri v2 JSON yapar. **Dosya → İçe Aktar** eski v1/v2 otomasyonları ve tek tuval JSON’larını kabul eder. Bütün klasör yapısı için **Nubbo.library** paylaşılır.

## Eski kayıtlar ve çalışma

Eski `nubbo-library.json` kimlikleri korunarak aktarılır; özgün dosya `Backups/Legacy-…json` olarak saklanır. Bozuk kaynak boş veritabanıyla değiştirilmez. İlk açılışta mevcut kütüphane varsayılan olarak **%APPDATA%\xp-agent-studio\Library** altına aktarılır; farklı profiller kendi profil dizinini kullanır. Mevcut kimlikler korunur. Profil ayarları ve çalışma durumu yerel kalır. Yeni kütüphaneyi eski EXE ile düzenleme; eski sürüm klasör ve arşiv alanlarını tanımaz.

Üstteki **▶ / ■** açık sekmeleri soldan sağa çalıştırır. Önceki tuval **Bitti** node’una hatasız ulaşmadan sonraki başlamaz. Durdurma veya hata kalan sırayı başlatmaz.

Üst sekmeler renklerle ayrılır, sürüklenerek yeniden sıralanır. İsim düzenleme sınırı 24 karakterdir; eski uzun adlar yalnız görünümde kısaltılır.
