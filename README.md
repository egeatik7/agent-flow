# Nubbo Agent Studio

Windows XP görünümünde, **node tabanlı** bir masaüstü ve web otomasyon ajanı. Her node bir aşamadır: “Resim yükle’ye
bas”, “`{{öğe}}` yaz”, “İndir’i bekle” gibi. Ajan her adımda ekranı okur (Windows OCR + UI Automation, aynı ekran görüntüsünden Çince/İngilizce ek okuma). Tarayıcıda ise
sayfanın içine bakar. Emin olamadığı yerde OpenRouter’daki modele sorar.

## Temel fikir: her tur taze bak, hafıza sadece ipucu

- Her adım, hedefini **her tur yeniden** arar. Sayfa değişirse ajan da ona uyar.
- Bir adım başarılı olunca bulduğu hedefin biçimi (pencere, öğe türü, ekrandaki bölge, yazısı) node’un **hafızasına**
  yazılır. Son 5 tur tutulur.
- Hafıza hiçbir zaman tek başına tıklamaz. İki işi var:
  - Ekranda birkaç benzer aday varsa (örn. iki “İndir”), geçen turlara en çok benzeyeni seçer.
  - Bu tur bulunan hedef geçen turlarla çok çelişirse (başka pencere, başka öğe türü, ekranın bambaşka yeri) tıklamadan
    önce bir kez daha bakılır; API anahtarı varsa model iki seçeneği görüp karar verir.
- Tırnak içinde yazdığın yazı (`“Oluştur”`) her zaman birebir aranır.
- Araç çubuğundaki **Hafızayı Sil**, bütün node’ların hafızasını ve İnisiyatif’in kayıtlı yolunu birden temizler. Akışın kendisi durur.

## Tuvaller

Araç çubuğunun altında her tuval bir sekmedir ve ayrı bir akıştır. Ajan yalnızca açık olanı çalıştırır. **+** yeni tuval açar, **×** kapatır; son sekme kapanmaz. Sekmenin adına çift tıklayınca adı değişir. **Dışa Aktar** yalnız açık tuvali, tuvalin adıyla indirir. **İçe Aktar** yalnız o tuvalin yerini alır.

Tuvalde **Ctrl+A** bütün node’ları seçer. **Ctrl+C** kopyalar, **Ctrl+X** keser (Başlangıç yerinde kalır), **Ctrl+V** yapıştırır. Ok, iki ucu da kopyadaysa durur; seçimin dışına çıkan ok kopar. Aynı kopya başka bir tuvale veya açık bir paketin içine de yapışır.

## Hedef nasıl bulunur?

Sırayla, ilk bulunan yerde durur:

1. **Sayfanın kendisi.** Programın açtığı tarayıcı öndeyse, düğmeler, bağlantılar ve alanlar gerçek adlarıyla okunur.
2. **Yakalanan öğe.** Node Ekran Tarayıcı ya da İmleçle Yakala ile oluşturulduysa önce uygulamanın kendi öğesi, sonra öğenin
   kayıtlı resminin ekrandaki aynısı aranır (modelsiz, hızlı).
3. **Ekran.** Node’da tırnak içi yazı varsa önce Windows OCR, bulamazsa ONNX. İkisi de value ramp ve 90° turunu kullanır. Tırnak yoksa ya da ikisi de bulamazsa kelime listesi ve UI-TARS devreye girer.

Hedef bulunamazsa ajan 3 saniye bekleyip tüm ekranı yeniden okur. Yine yoksa durup modele plan sorar (bekle, şu yazıyı ara, dur) ve bir kez daha bakar.

## Her Öğe İçin (döngü kutusu)

Tekrar eden adımlar bir **kutunun** içine konur. Kutu tuvalde yarı saydam bir çerçevedir:

- Node’u çerçevenin içine sürükleyip bırakınca kutuya girer, dışına bırakınca çıkar. Birkaç node’u seçip **Ctrl+G** ile
  (ya da sağ tık → “Seçilenleri kutuya al”) yeni bir kutuya alabilirsin. Kutular iç içe olabilir.
- Akış kutuya çerçevenin solundaki girişten girer. Her öğe için içindeki adımlar baştan sona bir kez çalışır. İlk adım,
  kutunun içinde kimsenin bağlanmadığı node’dur.
- Bütün öğeler bitince akış çerçevenin sağındaki **bitti** çıkışından devam eder.
- Liste ya elle yazılır (her satır bir öğe) ya da **Klasörden doldur…** ile bir klasördeki dosyalardan gelir (doğal
  sıralama: `resim2` → `resim10`). Liste boşsa kutu N kez çalışır.
- Değişkenler: `{{öğe}}` (tam yol), `{{öğe.ad}}` (kedi.png), `{{öğe.isim}}` (kedi), `{{sıra}}`, `{{toplam}}`.
  Yükleme adımına `{{öğe}}` yaz. Her tur sıradaki dosyanın yoludur: ilk tur birinci satır, ikinci tur ikinci satır.
- Her çalıştırmada liste baştan sona gider. Öğeler tamam veya hatalı diye işaretlenmez. Listedeki işaret, tur hangi dosyadaysa oraya kayar. Kutu **bitti** deyince işaret 1. öğeye döner; dış kutu sıradaki klasöre geçince iç liste baştan işlenir. Durdurulursa veya kutu hata diye kesilirse işaret o dosyada kalır. **Ajanı Çalıştır** işarete bakmaz, birinci satırdan başlar. **Seçiliden Çalıştır**, kutu içindeki bir node seçiliyken listeyi işaretli satırdan sona kadar götürür.

Bir adım hata verirse (hedef yok, bekleme zaman aşımına uğradı, İnisiyatif olmadı dedi) o tur orada kalır, günlük kırmızı
satırı yazar ve sıradaki öğeye geçilir. Sonraki çalıştırma yine birinci öğeden başlar.

Eski akışlardaki “Döngü kartı + geri dönen ok” yapısı açılırken otomatik olarak kutuya çevrilir. Eski “hata olursa”
bağlantısı açılırken düşer.

## Chrome

Kendi açtığın Chrome, kısayolu şöyleyse sayfanın yazısını verir:

`"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222`

Chrome’u bu kısayoldan tamamen kapatıp yeniden aç. Tıkla ve Yazı Yaz, öndeki sayfanın kendi düğme ve yazı listesine bakar. Port kapalıysa, yazı sayfada yoksa ya da önünde bir dosya penceresi varsa ekran okumasına düşer. Ekranı Tara’da seçtiğin kutunun üstüne denk gelen sayfa yazısı kayda geçer.

## İnisiyatif

Birkaç aşamalı bir işi tek cümleyle tarif etmek için: “Blender’da küp ekle ve kırmızı materyal ver”. İki çalışma şekli var:

- **Ekrana bakarak (varsayılan, UI-TARS gibi):** her adımda ana ekranın görüntüsü alınır. Model (varsayılan
  `bytedance/ui-tars-1.5-7b`, Ayarlar > İnisiyatif modeli) kısa bir düşünce yazar ve tek bir eylem verir: tıkla, çift tık, sağ tık,
  sürükle, tuş kombinasyonu (Shift+A, Ctrl+S, Win), yaz, kaydır, bekle, bitti ya da yardım iste. Tıklama noktası
  doğrudan ekran görüntüsünden gelir; yazısız ikonlar, 3D görünüm ve menüler dahil. Modele son birkaç ekran görüntüsü ve
  önceki adımları birlikte gider. Başka bir görsel model de yazabilirsin (Gemini, Claude); o zaman aynı eylemler JSON olarak istenir.
- **Yazı listesiyle:** ekrandaki yazıların numaralı listesinden seçer. Formlarda ve web sayfalarında hızlıdır.

Güvenceler:

- Model “bitti” deyince son ekran görsel modelle (Ayarlar > Görsel LLM) ayrıca kontrol edilir; hedef olmamışsa model eksik kalanı yapar.
- Ekran 3 eylemdir değişmiyorsa modele “başka yol dene” denir; 6 eylemde durur. Eylem sınırı node’dan ayarlanır. Ctrl+Shift+Q her an durdurur.
- Başarılı turun adımları kaydedilir (`{{öğe}}` gibi değişen yazılar yer tutucuya çevrilir). Sonraki turda önce bu yol
  **modelsiz** oynatılır; her adımdan önce ekranın kayıttakine benzediğine bakılır. Ekran farklılaştığı anda model o noktadan devam eder.
- Hedefe ulaşınca **tamam**, ulaşamazsa **olmadı** çıkışından devam eder.

## Emin olma

- Sıradaki node **Koşul** ise eylem bir kez yapılır ve kontrol edilmeden geçilir; o node ekrana kendisi bakar.
- Ekranda: eylemden önce ve sonra bir kare alınır. Sayfa değiştiyse ve sıradaki yazı geldiyse devam edilir. Tepki net
  değilse akış hemen bozulmaz: sıradaki adımın hedefi ekranda mı diye bakılır, yoksa beklenir, gerekirse model plan kurar.
  Aynı komut yeniden basılmaz.
- **Yazı Yaz** sonrası alanın içi okunur. Başka bir şey yazıyorsa alan temizlenip bir kez daha yazılır; yine tutmazsa
  adım hata verir. Kutu içindeyse o tur orada kalır ve sıradaki öğeye geçilir.
- Son ekran kareleri `%APPDATA%/xp-agent-studio/shots` altında tutulur, eskisi silinir.
- Model konuşmaları ajan günlüğüne düşer: giden `API →`, dönen `API ←`.

## Uzun çalıştırmalarda güvenceler

- **Sağ alt rapor.** Çalışırken ekranın sağ altında, diğer pencerelerin üstünde, o anki adım yazar. Tıklamalar içinden geçer. Node bir döngünün içindeyse kutunun altında, görev çubuğuna binmeden, kaçıncı öğe olduğu ve öğenin adı durur. Cevap veren model kendi kod adıyla konuşur (`deepseek-v4: …`). Bu pencere ekran görüntüsüne girmez, öğe listesine düşmez ve tıklamalar içinden geçer; Nubbo kendi raporunu okuyamaz.
- **Durdurma her an çalışır.** Model istekleri 90 sn’de kesilir; Ctrl+Shift+Q bekleyen isteği de hemen iptal eder. Geçici hatalarda
  (429, 5xx, bağlantı kopması) istek 3 sn sonra bir kez daha denenir.
- **Adım sınırı tur başınadır.** “Maks. adım” kutunun her turu için ayrı sayılır; aşan tur (örn. hiç bitmeyen Koşul → Zamanlayıcı
  döngüsü) orada kalır ve sıradaki öğeye geçilir.
- **Tepki doğrulanamazsa adım hata sayılmaz.** Sıradaki adım kendi hedefini arar ve bekler. Hafızaya yalnızca
  tepkisi doğrulanan hedefler yazılır. Koşul node’u tırnak beklemez: kutusundaki yazıyı doğrudan Windows OCR, sonra ONNX ile arar.
- **Yazı Yaz güvenlidir.** Ctrl+A / Delete yalnızca odak bir yazı alanındayken gönderilir. Klavyeyle yazılamayan karakterler
  (Çince vb.) pano üzerinden yapıştırılır. Alan biçimlendirme yaptıysa (1.5 → 1,5) sadece uyarılır.
- **Odak kayarsa** (Windows bildirimi, Teams, bu pencere) tuşlar göndermeden önce çalışılan pencere yeniden öne getirilir.
- **Bilgisayar uyumaz**, ekran kilitlenirse ajan kilit açılana kadar bekler.
- **Kayıtlı İnisiyatif yolu** her tıklamadan önce tıklanacak yerin görüntüsünü kayıttakiyle karşılaştırır; tutmazsa modele devreder.
- **OCR seçimi:** Araç çubuğunun sağındaki seçim Ekran Tarayıcı’da hangi okuyucunun listeyi dolduracağını belirler. Node hedefinde Windows OCR ve ONNX yalnızca tırnak içindeki yazıda çalışır. Tırnak yoksa, ya da ikisi de bulamazsa, LLM panelinde açık olan model aşamasına geçilir. İki okuyucu da value ramp uygulanmış kareye bakar; yan yazı için o kare 90° çevrilir. UI-TARS rampasız, düz kareyi görür.
- **Büyük pencereler** (tarayıcılar) öğe ağacı 6 sn’de okunamazsa atlanır, ekran taraması takılmaz.
- **Günlük dosyası:** her sürüm kendi klasörünü açılışta oluşturur: `%APPDATA%/xp-agent-studio/logs/<sürüm>/` (o sürümden son 30). 1.7.38 ilk kez açılınca `logs/1.7.38` yoksa oluşur. Bir tur hata verirse o anki ekran da bu klasöre kaydedilir. Ajan Günlüğü’ndeki **Günlük klasörü** düğmesi bu sürümün klasörünü açar.

## Node türleri

| Node | Ne yapar | Çıkışlar |
| --- | --- | --- |
| Başlangıç | Akışın giriş noktası | sonra |
| Tıkla | Ekranda/sayfada yazan yeri bulup tıklar (tek/çift/sağ tık) | sonra |
| Yazı Yaz | Bir alana (veya o an seçili alana) yazar, alanı okuyup doğrular, isteğe bağlı Enter | sonra |
| Tuş Gönder | Kısayol/tuş (`{ENTER}`, `^a`, `%{F4}` …) | sonra |
| Zamanlayıcı | N saniye bekler | sonra |
| Koşul | Ekranda bir yazı ya da seçilen öğe (simge dahil) var mı? İstersen görünene kadar bekler | var / yok |
| Her Öğe İçin | Kutu: içindekileri listedeki her öğe için, her çalıştırmada baştan çalıştırır | bitti |
| İnisiyatif | Tarif edilen hedefi model birkaç eylemde yapar | tamam / olmadı |
| Bitir | Akışı sonlandırır | — |

“olmadı” çıkışı ve bekleme süresi verilmiş Koşul’un “yok” çıkışı bir yere bağlı değilse adım hata verir. Kutunun içindeyse o tur orada kalır, sıradaki öğeye geçilir. Eski bir akışta Tarayıcıyı Aç, Dosyayı Bekle veya Dosyayı Taşı duruyorsa o adım atlanır.

## Örnek: klasördeki her resimden 3D model

```
Başlangıç → [Her Öğe İçin: C:\Resimler klasörü]
               Tıkla “Resim yükle” → Yazı Yaz {{öğe}} → Tıkla “Oluştur”
               → Koşul “İndir” (10 dk bekle) → Tıkla “İndir”
            bitti → Bitir
```

## Kullanım

- **İleriye ekle:** node’un sağındaki yeşil **+** → tür seç. Arada bağlantı varsa yeni node araya girer ve aynı kutuya katılır.
- **Bağla:** renkli çıkış noktasını sürükleyip başka bir node’un (ya da kutu başlığının) üstüne bırak.
- **Tuval:** tekerlek yakınlaştırır/uzaklaştırır, orta tuşla sürüklemek kaydırır. Köşedeki yüzde 100%’e döner.
- **Seç:** boş yerde sürüklemek kutu çizerek seçer. `Shift` ile tıklamak seçime ekler ya da çıkarır; `Shift` basılıyken çizilen kutu da seçime eklenir. Seçililer birlikte sürüklenir. `Ctrl+G` kutuya alır, `Del` siler, `Ctrl+D` kopyalar.
- **Paketle:** seçim varken Node Ekle’nin sağında durur. Seçilenler tek Paket node’una toplanır. Bir döngünün parçası seçilirse kutu, bütün üyeleriyle birlikte içeri girer. **İçine gir** o akışı açar; tuvalin sağ üstündeki **Paketten çık** dışarı döner. **Paketi çıkar** paketi dağıtır ve node’ları tuvale geri koyar. Node’un başlığının altındaki “Pakette ayarları göster” işaretliyse, o node’un ayarları paket seçilince sağda açılıp kapanır; Her Öğe İçin bölümleri en üsttedir. Paket çalışınca içi Başlangıç’tan bitişe kadar gider, sonra dışarıdaki sonraki node çalışır. Paketin içinden çalıştırınca da içi bitince dışarıdaki sonraki adımdan devam eder; döngü kutusunun içindeyse kalan öğeler işlenir ve en dıştaki Bitir’e kadar çıkılır.
  Kutuyu silmek içindekileri silmez.
- **Sağ tık:** boş yerde (ya da kutunun içinde) node ekleme menüsü; node üzerinde çalıştır, kutuya al, kutudan çıkar, kopyala, sil.
- **Ekran Tarayıcı:** ekranın görüntüsü alınır, bulunan her yazı kutuyla işaretlenir; birine tıklayınca seçili node’a atanır.
  Seçilen öğe üç yolla hatırlanır: uygulamanın kendi öğesi, öğenin küçük resmi ve (okunabiliyorsa) yazısı. Çalışırken sırayla
  öğe, resmin ekrandaki aynısı, yazı ve en son görsel model (resimle birlikte) denenir; yazısız simgeler de böyle tıklanır.
- **İmleçle Yakala (3 sn):** imleci hedefe götür, o öğe (resmiyle birlikte) node’a bağlanır.
- **Beklemek:** Koşul’a “görünene kadar bekle” süresi ver, ya da “yok” çıkışını Zamanlayıcı’ya, Zamanlayıcı’yı tekrar Koşul’a bağla.
  Koşul’a Ekrandan Seç / İmleçle Yakala ile bir simge de seçilebilir; yazısı olmasa da resmi ekranda aranır.
- Çalışırken uygulama kendini küçültür. **Ctrl+Shift+Q** ile durdurursun.
- **Dışa/İçe Aktar:** akışı JSON olarak kaydet/aç. Akış ve ayarlar ayrıca otomatik kaydedilir.

## İlk kurulum

1. Ayarlar → OpenRouter API Key → **Kaydet**, sonra **API Test**
2. Model adı (listeden seçmek için “Model listesini getir”) → **Kaydet**
3. Görsel model (ekran görüntüsü modu ve İnisiyatif’in bitti kontrolü bunu kullanır) → **Kaydet**
4. İnisiyatif modeli (varsayılan `bytedance/ui-tars-1.5-7b`) → **Kaydet**
5. Hedef pencere → **Kaydet** (boş bırakılırsa tüm ekran okunur)
6. Node’ları diz, **▶ Ajanı Çalıştır**

API anahtarı olmadan da çalışır: yazı eşleştirmesi ve kutular modelsiz çalışır. İnisiyatif ve
görsel mod anahtar ister.

## Exe

Repoda hazır portable paket: **`Nubbo.exe`** (Windows 10/11 x64). Çift tıkla, kurulum yok. Chrome sayfasının yazısını okumak için Chrome’u `--remote-debugging-port=9222` ile aç.

## Geliştirme

```bash
npm install
npm run dev          # Electron + Vite (hot reload)
npm run dev:web      # Sadece arayüz, tarayıcıda http://127.0.0.1:4521 (tıklamalar simüle)
npm run pack:win     # release/Nubbo.exe üretir
```

- `electron/runner.ts`: akışı yürütür (kutular, kurtarma, kaldığı yerden devam).
- `electron/agent.ts`: adımları yapar (hedef bulma, hafıza, tepki, takılma, İnisiyatif).
- `electron/browser.ts`: kullanıcının 9222 portuyla açtığı Chrome’un sayfa yazısı (`playwright-core`).
- `electron/memory.ts`: hedef hafızası ve çelişki kontrolü.
- `a11y/`: ekran okuma ve tıklama için PowerShell (`worker.ps1` sürekli açık kalan tek süreç; `screen.ps1` ekran
  görüntüsü + `Windows.Media.Ocr` + UI Automation). Gerçek ekran otomasyonu yalnızca Windows 10/11’de çalışır.

API anahtarı `electron-store` ile kullanıcı profiline (`%APPDATA%/xp-agent-studio`) yazılır.
