# Koşul ve node bazlı yöntem/prompt paneli — devam defteri

Kullanıcı: işi 20 dakikadan kısa parçalarla ilerlet; kullanıcı devam yazınca sonraki parçaya geç. Ara ZIP teslim etme; tamamlanınca tek paket.
Başlangıç: a06a970523628da027ca8f8f7829cb92aeb465cc (Tur 1 + Tur 2 kilit/kayıt düzeltmeleri).
Dal: fix/condition-methods-prompts. Kaynak sürümü ara parçalarda 1.9.93 kaldı.

## Parça 1 — Koşul yürütme
- Bir koşul turu: UIA, ardından birleşik Windows + ONNX OCR. Aynı bridge okuyucuları ve chooseScreenTarget liste seçimi Tıkla tarafından da kullanılır; Tıkla'nın tekrar/ikinci bakış/eylem kurtarma döngüsü çağrılmaz.
- UIA artık yalnız Text ile sınırlı değil. Tırnaklı kesin metin ve boş tarifli kayıtlı metin yerel eşleşir. Normal tarifin tüm sayıları/olumsuzlukları modele gider.
- conditionUia / conditionOcr ayrı prompt anahtarları ve temkinli varsayılanlar eklendi; list click promptu Koşul'a sızmaz. Prompt normalizasyonu yeni anahtarları korur.
- Pencere seçiminde readOnly:true. Eksik, başlığı değişmiş veya belirsiz seçimde bir kez tüm ekrana geçilir. Diğer worker/API hataları No sayılmaz.
- Eski conditionSource alanı şemada korunur; yürütme artık bu ayarla tek okuyucuya kısıtlanmaz. UI'da tek-kaynak seçici kaldırıldı ve pencere tercihinin anlamı yazıldı.
- Tarif yokken seçilmiş yazısız öğenin canlı UIA kimliği/kayıtlı simgesi kullanılabilir; normal durum tarifinin kanıtı olarak eski locator kullanılmaz.
- Görsel model şimdilik yok. Bekleme davranışı runner'da korundu: timeoutMs=0 tek tur, süre varsa turlar arası 700ms. Model fallback zinciri mevcut metin modeli zinciridir.

## Doğrulama
- Koşul testleri: 23 durum (önceki kısıtları bekleyen testler yeni davranış sözleşmesine uyarlandı).
- Tam Vitest: 776 geçti, 6 mevcut test atlandı, 0 hata; 104 dosya.
- Typecheck ve build:electron başarılı. git diff --check başarılı.
- Bu sonuçlar Linux/mock okuyucularla doğrulandı; canlı Windows UIA/OCR, uygulama odağı, fiziksel ekran ve Windows EXE testi yapılmadı.

## Parça 2 — Node sekmeli yöntem/prompt paneli
- Yöntemler bölümünde aktif tüm node türleri ayrı sekmelerde: Tıkla, Koşul, Yazı Yaz, Yap, Tuş Gönder, Zamanlayıcı, Her Öğe İçin, Paket, Başlangıç, Bitir.
- Tıkla/Yazı Yaz ortak sıra, aç/kapat ve promptları açıkça paylaşılır. LLM'siz UIA/simge/OCR eşleştirmeleri, eylem gönderme ve yeniden arama davranışı gösterilir. Kayıtlı konum, çalışır tıklama yöntemi gibi gösterilmez.
- Koşul UIA/OCR kutuları ayrı runtime promptlarına bağlı; görsel Koşul kapalı kalır. Kullanıcı görsel incelemeden emin olmadığını söylediğinden bu görevde görsel karara yeni bir seçenek eklenmedi.
- Yap'ın hard-coded sistem promptu YAP_PROMPT sabitine taşındı; llmPrompts.yap anahtarı main.ts üzerinden runYap'a gider. Eski İnisiyatif promptları yeni Yap'ın yöntemleri gibi gösterilmez.
- Görsel hedefleme kutularının ek talimat olduğu açıkça belirtilir. Gerçekte her isteğe eklenen TARS/JSON hedef sözleşmesi ve VISUAL_TARGET_RULES ayrıca açılır bölümde okunabilir. Liste ve koşul modellerine eklenen sabit OCR/kanıt kuralları da aynı kaynaktan gösterilir.
- Türkçe özel promptları anahtar sözcük taramasıyla silen normalizePrompts filtresi kaldırıldı. Tanınmayan anahtarlar ve boş/varsayılan değerler hâlâ elenir; kullanıcının promptu dili nedeniyle kaybolmaz.
- Node sekmeleri klavyede sağ/sol, Home/End ile kullanılabilir. Sekme değişince taslaklar korunur. Kaydet bütün taslakları tek ayar çağrısıyla yazar; tek prompt sıfırlama diğer taslakları bozmaz.

## Son doğrulama ve sınırlar
- Tam Vitest: 781 geçti, 6 mevcut test atlandı, 0 hata; 105 dosya.
- Typecheck ve build:electron başarılı; git diff --check başarılı.
- Yeni panel testleri taslakların sekmeler arasında korunmasını, ayrı kayıt anahtarlarını, tek prompt sıfırlamayı, LLM'siz node'larda sahte editör olmamasını ve Yap'a gerçek prompt iletimini doğrular.
- İki mevcut UI testi yeni bölüm adı ve tek OCR satırı için güncellendi; bütün testler geçti.
- Playwright görsel QA denenmiş ancak ortamda Chromium ve Electron binary bulunmadığı için canlı ekran incelemesi yapılamadı. Geçici QA sayfası silindi. Testler React render/etkileşim ve mock okuyucular üzerinden koştu.
- Windows EXE, fiziksel masaüstü ve gerçek UIA/OCR testi yapılmadı. Renderer/main JavaScript derlemesi başarılı; EXE diye sunulmaz.
- target.preview test aracı eski resolver yolunu korur; normal Koşul runner'ı exists yolunu kullanır. Bu görevde test aracının Koşul önizlemesi değiştirilmedi.
- Kurtarma ajanı bir node değildir; mevcut Ajan sekmesindeki kendi talimat/model ayarlarını kullanmaya devam eder.
- Önceki audit listesindeki §2.3–2.4 vb. başka buglar bu görevde tamamlandı sayılmadı. Önceki Tur 1–2 kayıt/kilit düzeltmeleri korundu.

## Teslim
Tek ZIP: Koşul/panel için a06a970 üzerine artımlı patch; temiz 1.9.93/5f1f81d için ilk iki turu da içeren birleşik patch; son kaynaklar, devam defteri ve test kanıtları. İki patch birlikte uygulanmaz. Kaynak sürümü 1.9.93; bu bir kaynak patch teslimidir.

## Son gözden geçirme düzeltmeleri — 12 Ekim 2026
1. Pencere dışına fallback yapıldığında istenen pencere/uygulama bağlamı modelin gerçek kullanıcı mesajında korunur. Başka uygulamadaki durum veya geçmiş log açıkça pozitif kanıt sayılmaz. Bağlamı kuramayan model id:null döndürür. Pencere dışındaki tırnaklı metin de bu değerlendirmeye girer; model yoksa teknik yapılandırma hatası görünür, kör yerel eşleşme yapılmaz.
2. Tırnaklı kesin metin ve boş tarifli kayıtlı metin yerel yolda gözlenen öğenin TAM normalize metniyle eşleşir. Uzun bir log/talimat satırının yalnız içindeki ifade pozitif sayılmaz. Bir satırın sadece parçasını ya da durum anlamını değerlendirmek isteyen kullanıcı normal tarif yazmalıdır. Büyük/küçük harf ve normalizasyon korunur.
3. Yazısız öğenin UIA/simge aramasında gerçek okuyucu/worker hataları artık yutulmaz. Normal bulunamama null/eksik pencere olarak kalır; teknik hata No sayılmaz.
4. Süre verilmiş Koşul için deadline tüm gözlem turunu kapsar. HTTP isteği AbortController ile iptal edilir; iptal zincirde yeni model/fallback çağrısına dönüşmez. Kuyruktaki Windows okuması gönderilmez, gönderilmiş okumanın kendi worker süreci durdurulur. Kendi başlattığı worker daha READY olmadan iptal edilmişse o süreç de bırakılmaz. Geç gelen sonuç dal değiştiremez. Turlar arası uyku kalan süreden uzun olmaz. Süre 0 hâlâ tek gözlem turudur, sıfır milisaniyelik iptal değildir.

Sınır: başlamış yerel ONNX inference işlemi native olarak iptal edilemiyor. Koşul deadline'da döner; onun geç sonucu kullanılmaz ve sonraki aşama/model başlatılmaz. Native işlem bittiğinde geçici dosya temizlenir. Canlı Windows/PowerShell ve ONNX performans testi bu ortamda yapılmadı.

Yeni regresyonlar: yanlış log eşleşmesi, fallback bağlamı, yazısız UIA/simge hatası, HTTP abort ve retries, asılı okuyucuda deadline/late Yes, kalan uyku süresi, worker kuyruk sırası, aktif istek ve başlangıç iptali.
Eski Node test paketindeki iki OCR-only/icon-reject beklentisi, kullanıcının daha önce onayladığı UIA+OCR/simge davranışına güncellendi; sahte bridge'in findImage eksikliği giderildi.
Son sonuç: 792 Vitest geçti, 6 mevcut test atlandı; 98 Node testi geçti, 21 mevcut test atlandı. Typecheck, build:electron ve git diff --check başarılı.
Son ZIP, bu dört düzeltmeyi Koşul ve yöntem/prompt paneliyle birlikte içerir. Önceki panel paketi uygulanmışsa yalnız son bug düzeltmeleri için ek patch de bulunur.
