# Israrcı yöntem döngüsü — 1.9.142 / c19df8d

> Tarihsel 1.9.142 raporudur. Hedef seçici/Yap vazgeçmesi ve kurtarma kapalıyken bekleme davranışı artık geçerli değildir. Güncel sözleşme: [Kurtarma devri](kurtarma-devri-145.md).

Bu paket, önceki `nubbo-model-cevap-bekleme-142.patch` yaklaşımının yerine geçer. Önceki paketle üst üste bağımsız tekrar döngüleri bırakılmamalıdır.

## Çalışma davranışı

Bir yöntem teknik hata verdiğinde aynı yöntemde sonsuza kadar kalınmaz: mevcut model alternatifleri sonlu bir tur denenir ve kontrol yöntem sahibine döner. Sıradaki açık yöntem çalışır. Açık yöntemlerin tamamı sonuçsuz kalırsa 3 saniye beklenir ve aynı düğüm/aynı döngü öğesinde yeni ekran gözlemiyle ilk açık yöntemden başlanır. Yöntemlerin kullanıcı sırası ve açık/kapalı ayarları korunur.

Koşulun UIA ve OCR okuyucuları ayrı yöntemlerdir. Birindeki hata diğerinin denenmesini engellemez. Geçerli olumlu karar true döner; okuyucular teknik hatasız geçerli olumsuz kararlar verdiyse false döner. Bir okuyucu hata verip diğeri olumsuzsa bilinmeyen durum false sayılmaz; yeni UIA → OCR turu başlar. Koşulun kendi başına her zaman tekrar etmesi değil, tamamlanamayan yöntem turunun yeniden denenmesi amaçlanır.

Teknik hata ile modelin bilinçli vazgeçme kararı ayrıdır:

- Timeout, bağlantı/API/okuyucu hatası, boş/kesik/bozuk cevap veya geçersiz numara: yöntem başarısızdır; başka yöntem ve gerekirse yeni tur denenir.
- Liste modelinin `id:null` cevabı tek başına bilinçli vazgeçme değildir. Açık vazgeçme için `give_up:true`, `id:null` ve boş olmayan bir gerekçe gerekir. Alanın tipi de doğrulanır.
- Görsel modelin geçerli `terminate/failure` cevabı açık hedef-yok kararıdır. Diğer açık yöntemler yine denenir; biri hedefi bulursa o kullanılır. Teknik hatalı bir yöntem de varsa hedef-yok kararı kesinleştirilmez, tur yenilenir.
- Teknik hatasız tamamlanan bütün yöntemler hedefi bulamadıysa ve model açıkça vazgeçtiyse `DeliberateStopError` oluşur. Bu, hata yanıtından üretilmez.
- Kurtarma modelinin geçerli `stop` kararı bilinçli vazgeçme olarak korunur. Kurtarma çağrısının hata vermesi veya karar verememesi böyle sayılmaz.
- Yap'ta güncel ekran okunduktan sonra gerekçeli `task_give_up` aracıyla bilinçli vazgeçilebilir. Araç/model arızası bu karara dönüştürülmez.

## Kapatılan teknik çıkışlar

| Eski çıkış | Yeni davranış |
| --- | --- |
| Model sorgusunda tek tur bitince koşulun hata ile sonlanması | Sonlu model turu → sıradaki okuyucu/yöntem → gerekirse yeni tam tur |
| Ortak model zincirinin düğümü 15 dakika/256 tur içinde hapsetmesi | Normal çağrı tek sonlu model turudur; ısrar yöntem/düğüm sahibindedir |
| Hedef aramanın ikinci ekran denemesinden sonra bırakılması | Açık yöntemler yeni ekranla tekrar baştan denenir |
| Görsel onayın timeout/uncertain/düzeltme sınırında döngüyü kesmesi | Kalan yöntemler; tükenirse yeni tam tur. Başarısız onay tıklama yetkisi vermez |
| Geçersiz OCR numarasının null/hedef-yok sonucuna düşmesi | Teknik ret; diğer yöntemler denenir. Ham cevap ve numara eşleme kanıtı saklanır |
| Bir node hatasının aynı öğeyi atlatması veya serviceFailure/tekrarlı-hata yoluyla döngüyü bitirmesi | Normal koşuda aynı node ve mevcut yürütme yığını korunur; tamamlanan önceki düğümler yeniden oynatılmaz |
| Kurtarma isteğinin hata vermesi | Aynı adımda bekleme/yeniden deneme. Geçerli bilinçli stop ayrı kalır |
| Yap teknik hatasının eski fail bağlantısına çevrilmesi | Hata düğümün ısrar mekanizmasına döner; başarısızlık bağlantısı tahminen seçilmez |
| Yap model beklerken görev süresinin tüketilmesi | Model bekleme süresi görev yürütme bütçesinden ayrılır |
| Yap'ın model tekrarında eski ekranı sonsuza kadar kullanması | Model alternatifleri tükenince yalnız screen.read ile güncel gözlem alınır, araç eylemleri tekrarlanmaz |
| Döngü klasörü okunamazken koşunun kesilmesi | Listeleme başlamadan önce salt okuma tekrar edilir; mevcut konum korunur |
| Tuş native gönderiminden sonra hatanın gönderilmemiş sayılması | Worker gönderim kancasıyla girdi durumu izlenir |

Model `id:null` dediğinde cevap metniyle yeniden eşleştirme yapılıp tıklanmaz. Çelişki nedeniyle yapılan ikinci model bakışı da seçim yapmadıysa eski aday tıklanmaz; sonraki yöntem denenir.

## Girdi tekrarı ve sınırlar

Israr, tıklama/yazma/Enter'ı körlemesine tekrar etmek değildir. Yazma aşamaları (`focus`, `text`, `enter`) devam için taşınır. Sadece odak alınmışsa metin aşamasına, metin gönderilmiş ve Enter kalmışsa Enter aşamasına devam edilebilir. Native girdi kısmen gönderilmiş olabilirse aynı komut otomatik yeniden basılmaz: düğüm ve öğe korunur, kurtarma devredeyse güncel durumdan tamamlaması beklenir. Kurtarma kapalıysa bu belirsiz girdi kendiliğinden çözümlenmiş sayılmaz; düğüm beklemeye devam eder. Bu durum ve tur numarası günlükte açıkça görünür.

Popup kapatma onayı alınmadan popup gönderilmiş sayılmaz. Kapatma girdisi gönderilmiş olabilecekse bütün node baştan oynatılmaz.

Kullanıcının Stop'u her zaman çalışır. Geçerli koşul true/false bağlantıları, Bitiş node'u, graph bütünlük kontrolleri ve kullanıcının açık adım/araç bütçeleri korunur. Açık `debug:true` koşusu ve tek-adım `probeOnce` tanılama işlemi, hata anını incelemek için durmayı sürdürür. Bu paket normal otomasyon koşusundaki teknik hata yollarını değiştirir; süreç çökmesi/işletim sistemi OOM gibi yakalanamayan olayların ortadan kalktığı iddia edilmez.

## Uygulama

Taban: GitHub HEAD `c19df8d` / 1.9.142. Yerel telefon paneli, imleç test EXE'si ve diğer düzeltmeler korunmalıdır. Önceki model-bekleme paketi uygulandıysa Cursor bu paketin nihai davranışını onun yerine birleştirmeli; ortak model sorgusunda sonsuz döngü bırakmamalıdır. Önceki paket eklediyse `tests/model-persistence.test.ts`, `tests/model-wait-helper.ts` ve `docs/model-wait-retry.md` bu nihai yöntem tasarımına göre güncellenmeli veya yalnız önceki pakete ait oldukları doğrulanarak kaldırılmalıdır; eski sonsuz-model-tekrarı testleri yeni sözleşmeyle birlikte bırakılmamalıdır. Zorlamalı uygulama veya yerel değişiklikleri silme yoktur.

    git apply --check nubbo-israrci-yontem-dongusu-142.patch
    git apply nubbo-israrci-yontem-dongusu-142.patch
    npm run typecheck
    npx vitest run tests/method-cycle-agent.test.ts tests/method-cycle-persistence.test.ts tests/method-cycle-yap.test.ts tests/method-fallback.test.ts tests/condition-target.test.ts tests/visual-pointer-agent.test.ts tests/yap.test.ts tests/yap-deadline-vs-stop.test.ts tests/model-chain.test.ts tests/model-output-retry.test.ts tests/production-guards.test.ts tests/recovery.test.ts tests/run-selected-canvas.test.ts
    npm test
    npm run build

PC'de ayrıca: bir okuyucu/model isteğini timeout'a düşür; diğer açık yönteme geçildiğini gör. Bütün yöntemleri geçici olarak başarısız kıl; aynı node/aynı dosyada yeni tur başladığını gör. Bağlantıyı geri getirince aynı yerden ilerlediğini, önceki girdilerin tekrarlanmadığını ve beklerken Stop'un çalıştığını kontrol et. Son olarak geçerli bilinçli vazgeçmenin timeout'tan ayrı raporlandığını doğrula.

Canlı Windows/GUI-Owl testi bu ortamda yapılmadı. Windows EXE'si burada üretilmedi.

## Doğrulama sonuçları

- `npm run typecheck`: exit 0.
- Yukarıdaki ilgili Vitest komutu: exit 0; 13 dosyada 157 test geçti.
- `npm run build`: exit 0.
- Tam `npm test`: exit 1; 156 dosya / 1.196 test geçti. 1 dosya / 5 test atlandı. `native-write-gate.test.ts` Electron kurulumu eksik olduğu için yüklenemedi; `render-overflow-audit.test.ts` içindeki 2 test Chrome bulunmadığı için çalışmadı. Tam koşu başarılı diye raporlanmamalıdır.
- `git diff --check`, temiz c19df8d indeksine uygulama kontrolü ve ters uygulama kontrolü geçti.

Testler üretim `createAgent`, `runGraph`, `runYap`, `recoveryToolTurn` yollarını çalıştırır; masaüstü köprüsü/model HTTP uçları taklittir. 180 saniyelik timeout senaryosu sahte saatle yürütülmüştür; gerçek GUI-Owl denemesi değildir.
