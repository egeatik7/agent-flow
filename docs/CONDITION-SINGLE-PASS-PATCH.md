# Koşul: tek değerlendirme, tüm ekran, model kararı

Taban: main ed13c3226d564145da97ac19793ae19feca1fe97 (1.9.100).

- Her çalıştırmada bir UIA okuması + model kararı; koşul doğrulanmazsa bir birleşik Windows/ONNX OCR okuması + model kararı. Boş liste de modele gider.
- Koşul kararı `satisfied:boolean` ile gelir. Kanıt ID'si yokluk koşullarında null olabilir; boş/kısmi okuma tek başına yokluk kanıtı sayılmaz. Belirsizlikte false gerekir. Hatalı yanıt ve okuyucu/API hatası teknik hatadır.
- Pencere kutusu yalnız model bağlamıdır. Okuyuculara windowTitle/strictWindow gönderilmez; eşleştirme/seçim/fallback yoktur.
- Koşul kanıtının metni 120 karakterde kesilmez. Diğer hedefleme yöntemleri ve 400 adaylık liste bütçesi korunur; liste kısmi ise modele açıkça bildirilir.
- Görünene kadar bekle alanı ve iç tekrar döngüsü kaldırıldı. Eski timeoutMs koşulda kullanılmaz. Tekrar: Koşul yok -> Zamanlayıcı -> Koşul.
- Koşul model zinciri bir kez yürütülür; yedek modeller aynı zincirde birer kez denenebilir, başa dönülmez. Tıkla/Yazı Yaz retry davranışı değişmedi.
- Eski locator/anchor taşıyan koşullar, tarif dolu olsa da, açık uyumluluk hatası verir. Kayıtlı veriler otomatik dönüştürülmez. Panel uyarı + Eski seçimi temizle sunar.
- Görsel model, tıklama/yazma/odak değiştirme ve kurtarma eylemi koşulda yoktur.

Yeni/uyarlanan kontroller: uzun UIA/OCR kanıtı sonundaki olumsuzluk, boş listelerin gerçek model isteği, ID'siz olumlu yokluk kararı, false+ID, yanlış model yanıtı, tek zincir hata sınırı, tüm ekran/pencere bağlamı, legacy uyumsuzluğu, eski sürenin yok sayılması, açık Zamanlayıcı döngüsü, teknik hata ve iptal.

Canlı Windows ve gerçek LLM doğruluk testi yapılmadı; EXE üretilmedi.
