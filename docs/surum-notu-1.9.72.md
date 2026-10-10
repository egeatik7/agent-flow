# Sürüm notu — 1.9.72

Taban: 1.9.71, `a3e5d57`.

- Node üzerindeki not simgesiyle açılan rapor penceresine yan yana **Bu raporu temizle** ve **Tüm raporları temizle** düğmeleri eklendi.
- Tek rapor temizleme seçili raporu kaldırır. Tümünü temizleme bütün tuvallerin kurtarma raporlarını kaldırır. Her iki işlem de açık bir onay ister; Vazgeç hiçbir dosyayı silmez.
- Popup içinde **Rapor klasörünü aç** düğmesi ve seçili raporun metnini Windows panosuna aktaran kopyalama ikonu eklendi. Kopyalandı/hata geri bildirimi görünür; rapor metni fareyle de seçilebilir.
- Ayarlar > Kurtarma raporları bölümünde de tüm raporları temizleme bulunur.
- Temizleme ayrı kurtarma JSON dosyalarını diskten kaldırır; tuval JSON'ları, node'lar, bağlantılar, ekran görüntüleri ve diğer günlükler korunur. Son raporu temizlenen node/paketin mor işareti kalkar.
- Çalışan kurtarmanın geç gelen sonuç kaydı veya geç gelen başlangıç listesi temizlenen raporu geri getirmez. Temizlemeden sonra oluşan yeni kurtarmalar normal şekilde yeni rapor üretir.
- Sol alttaki kurtarma bildirim kutusu ve ona ait stil kaldırıldı. Node'dan açılan not ve çalışan ajan HUD geri bildirimi korunur.

Doğrulama: typecheck ve renderer/main derlemesi başarılı; 581 Vitest testi başarılı, 5 mevcut test atlandı. Sekiz Node regresyon dosyasının sonuçları paketin DOGRULAMA.txt dosyasındadır. Gerçek dosya silme, kapsam sınırı, onay/vazgeç, geç gelen kayıt ve arayüz listesi kontrol edildi.

Bu teslim kaynak patch'idir. Linux ortamında Windows PowerShell 5.1 masaüstü geçidi ve Windows EXE koşusu çalıştırılmadığından tam yayın zinciri tamamlanmadı; GitHub push/tag veya EXE teslimi yapılmadı.
