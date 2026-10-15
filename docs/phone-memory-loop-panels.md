# Telefon: bellek paneli ve aktif döngüler

Temel commit: c19df8d (1.9.142).

- Bellek bölümü başlıklı, içeriği kadar yüksek bir paneldir. Flex küçülmesi ve dar iç kaydırma kaldırıldı; bilgi kartı sayfası kayar.
- Aktif döngüler dıştan içe ayrı satırlarda görünür: ad, 1 tabanlı sıra/toplam ve mevcut öğe.
- Döngü ilerlemesi runner'dan veri nesnesi olarak çıkar, paketlere devredilir ve main/viewer kanalına aktarılır. Günlük metni ayrıştırılmaz.
- Eski sunucuyla bağlanan yeni arayüz eski döngü metnini gösterir. Yeni koşu döngü listesini temizler; iç döngü çıkışında dış liste korunur.
- Akış JSON'ları, model ayarları ve otomasyon kararları değiştirilmedi.

## Cursor uygulaması

Çalışma ağacını kontrol et. `git apply --check nubbo-telefon-bellek-donguler-142.patch` ardından `git apply nubbo-telefon-bellek-donguler-142.patch` çalıştır. HEAD farklıysa dosyaları bütünüyle değiştirmeden mevcut düzeltmeleri koruyarak birleştir.

`npm run typecheck`, ilgili viewer/runner testleri, `npm test`, `npm run build` çalıştır. Telefonda 390x844 ve yatay görünümü kontrol et: bellek satırları kesilmemeli; dış ve iç döngü ayrı görünmeli; paket içindeki düğümlerde dış döngü kaybolmamalı.

Arayüz APK içine gömülü değil, PC sunucusundan WebView'a yükleniyor. Java değişikliği yok; bu yama için APK yeniden üretmek gerekmez. Güncellenmiş PC sürümünü paketleyip çalıştırdıktan sonra telefondaki izleyiciyi yeniden aç. Yeni sunucu kodunun devreye girmesi için PC uygulaması yeniden başlatılmalı.

## Bu ortamda doğrulama

- Typecheck ve renderer/main build: exit 0.
- İlgili 5 test dosyası: 29/29 geçti. Gerçek runGraph + ViewerState + istemci reducer ile paket içi iki döngü testi ve gerçek React bileşeninin statik render testi dahil.
- Tam koşu: 1176 geçti, 2 test başarısız, 5 atlandı; ayrıca native-write-gate test dosyası Electron kurulumu eksik olduğu için yüklenemedi. Başarısız iki render testi Chrome eksikliği nedeniyle çalışamadı. Tam koşu temiz değildir.
- Gerçek Android/Windows testi yapılmadı. Chrome kurulumu indirme arşivinin bozuk/boş gelmesiyle başarısız oldu; tarayıcı piksel doğrulaması yapılamadı.
