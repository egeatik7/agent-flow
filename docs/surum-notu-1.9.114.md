# 1.9.114 — OCR kelimesini kısa ikinci model isteği seçer

Blender 5.2 istenirken OCR aynı satırda `04_Hunyuanm Blender 5.2` okuyabiliyor ve ilk model Hunyuan kelimesini seçebiliyordu. Satırdaki kelimeler ve tam node talimatı artık kısa, ayrı bir metin isteğine gönderilir. İkinci modelin seçtiği kelimenin gerçek kutusuna tıklanır.

- `bestWordMatch`, `wordScore`, talimat token puanlaması ve uzun kelimeye otomatik öncelik tamamen kaldırıldı. Eski deterministik seçim testleri kaldırıldı.
- İkinci istek yalnız Tıkla'nın model tarafından seçilen, birden fazla gerçek kelime kutusu taşıyan OCR satırında çalışır. Tek kelime, UIA/DOM kontrolü, Koşul ve Yazı Yaz için bu ek çağrı yapılmaz.
- İkinci istek screenshot, sohbet geçmişi, tüm ekran listesi veya ilk modelin cevabını taşımaz. Tam talimat korunur; olumsuzlama ve uygulama bağlamı kısa seçimden çıkarılmaz.
- Yanıt `{"id":number|null}` biçimindedir. ID kısa istekteki gerçek kelimelerden biri olmalıdır. Koordinatı model belirlemez. Program modelin kelime seçimini değiştirmez.
- Null, geçersiz yanıt veya bağlantı hatasında ilk kelimeye geri dönülmez. Mevcut sonraki hedefleme aşaması çalışır. Durdurma ve API anahtarı/bakiye hataları korunur.
- Ayarlar → Genel → OCR kelime seçimi: ayrı API veya `local:model` zinciri. Boş bırakılırsa Metin Modeli zinciri kullanılır. Eski ayarlar ve akış JSON'ları yeni alanlar gerektirmez.
- LLM → Tıkla → OCR kelime seçimi: kısa prompt düzenlenebilir ve sıfırlanabilir.
- Bu aşamada düşünmenin kapatılması istenir; yanıt kısa tutulur. Sağlayıcı desteği ve ağ gecikmesi nedeniyle süre garantisi yoktur. Zincir tek tur çalışır; normal taşıma katmanının JSON uyumluluk denemesi korunur.
- İkinci karar günlüğe ve hedef izine kendi aşamasıyla yazılır. Çevrimdışı yeniden oynatma aracı kayıtlı ikinci cevabı kullanır; canlı modele başvurmaz.

Doğrulama: tip kontrolü, renderer/Electron derlemesi; 847 Vitest geçti, 5 atlandı; 10 yeni seçim testi bu toplamın içinde; hedefleme 20 ve girdi 7 test geçti. Yeni testler dış ekran/sunucu uçlarını taklit eder: gerçek Qwen/GLM/API doğruluğu, maliyet ve gecikme veya canlı Windows/Blender koşusu ölçülmedi.

Kapsam: adres alanındaki listede olmayan `#35` cevabının kök nedenini çözmez. Bu değişiklik geçerli ilk kelime seçimi sonrası ikinci kelime kararını ekler. 1.9.113 tanılama kodu korunur.
