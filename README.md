# XP Agent Studio

Windows XP görünümünde, **node tabanlı** bir masaüstü ve web otomasyon ajanı. Her node bir aşamadır: “Resim yükle’ye
bas”, “`{{öğe}}` yaz”, “İndir’i bekle” gibi. Ajan her adımda ekranı okur (Windows OCR + UI Automation). Tarayıcıda ise
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
- Araç çubuğunda **Yeni Akış**’ın sağındaki **Hafızayı Sil**, bütün node’ların hafızasını ve İnisiyatif’in kayıtlı yolunu birden temizler. Akışın kendisi durur.

## Hedef nasıl bulunur?

Sırayla, ilk bulunan yerde durur:

1. **Sayfanın kendisi.** Programın açtığı tarayıcı öndeyse, düğmeler, bağlantılar ve alanlar gerçek adlarıyla okunur.
2. **Yakalanan öğe.** Node Ekran Tarayıcı ya da İmleçle Yakala ile oluşturulduysa önce uygulamanın kendi öğesi, sonra öğenin
   kayıtlı resminin ekrandaki aynısı aranır (modelsiz, hızlı).
3. **Ekran.** Accessibility tree (UIA) ve OCR yazıları. Tırnak içi yazı birebir aranır; değilse API anahtarı varsa model
   numaralı listeden seçer, yoksa Türkçe eklere dayanıklı yazı eşleştirmesi yapılır (`Opera’ya` → Opera).
4. **Ekran görüntüsü.** “Ekran görüntüsüne bakarak yap” açıksa (ya da yukarıdakiler bulamayıp model bir plan kurduysa)
   görsel model ikon ve yazısız düğmeleri de bulur.

Hedef bulunamazsa ajan 3 saniye bekleyip tüm ekranı yeniden okur. Yine yoksa durup modele plan sorar (bekle, şu yazıyı
ara, dur) ve bir kez daha bakar.

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
- Her çalıştırmada liste baştan sona gider. Öğeler tamam veya hatalı diye işaretlenmez. Listedeki işaret, tur hangi dosyadaysa oraya kayar. **Ajanı Çalıştır** işarete bakmaz, birinci satırdan başlar. **Seçiliden Çalıştır**, kutu içindeki bir node seçiliyken listeyi işaretli satırdan sona kadar götürür.

Bir adım hata verirse (hedef yok, bekleme zaman aşımına uğradı, İnisiyatif olmadı dedi) o tur orada kalır, günlük kırmızı
satırı yazar ve sıradaki öğeye geçilir. Sonraki çalıştırma yine birinci öğeden başlar.

Eski akışlardaki “Döngü kartı + geri dönen ok” yapısı açılırken otomatik olarak kutuya çevrilir. Eski “hata olursa”
bağlantısı açılırken düşer.

## Tarayıcı modu

**Tarayıcıyı Aç** node’u Edge’i (yoksa Chrome’u) programın kendi profiliyle açar ve adrese gider. Siteye bir kez elle
giriş yaparsan sonra hep açık kalır.

- Bu tarayıcı öndeyken Tıkla, Yazı Yaz ve Koşul önce sayfanın içine bakar. Bulamazsa (örn. sistem
  penceresi açıldıysa) ekrana döner.
- Sayfa bir dosya seçme penceresi açarsa pencere görünmez; sıradaki **Yazı Yaz** adımındaki yol (`{{öğe}}`) doğrudan verilir.
- İndirmeler **İndirilenler** klasörüne düşer, “Farklı kaydet” penceresi çıkmaz. Ad vermek için **Dosyayı Bekle** +
  **Dosyayı Taşı** kullan.
- Kendi açtığın normal Chrome’a bağlanılamaz; o durumda ajan ekran modunda çalışır.

## İnisiyatif

Birkaç aşamalı bir işi tek cümleyle tarif etmek için: “Blender’da küp ekle ve kırmızı materyal ver”. İki çalışma şekli var:

- **Ekrana bakarak (varsayılan, UI-TARS gibi):** her adımda ana ekranın görüntüsü alınır. Model (varsayılan
  `bytedance/ui-tars-1.5-7b`, Ayarlar > İnisiyatif modeli) kısa bir düşünce yazar ve tek bir eylem verir: tıkla, çift tık, sağ tık,
  sürükle, tuş kombinasyonu (Shift+A, Ctrl+S, Win), yaz, kaydır, bekle, bitti ya da yardım iste. Tıklama noktası
  doğrudan ekran görüntüsünden gelir; yazısız ikonlar, 3D görünüm ve menüler dahil. Modele son birkaç ekran görüntüsü ve
  önceki adımları birlikte gider. Başka bir görsel model de yazabilirsin (Gemini, Claude); o zaman aynı eylemler JSON olarak istenir.
- **Yazı listesiyle:** ekrandaki (tarayıcıdaysa sayfadaki) yazıların numaralı listesinden seçer. Formlarda ve web sayfalarında hızlıdır.

Güvenceler:

- Model “bitti” deyince son ekran görsel modelle (Ayarlar > Görsel LLM) ayrıca kontrol edilir; hedef olmamışsa model eksik kalanı yapar.
- Ekran 3 eylemdir değişmiyorsa modele “başka yol dene” denir; 6 eylemde durur. Eylem sınırı node’dan ayarlanır. Ctrl+Shift+Q her an durdurur.
- Başarılı turun adımları kaydedilir (`{{öğe}}` gibi değişen yazılar yer tutucuya çevrilir). Sonraki turda önce bu yol
  **modelsiz** oynatılır; her adımdan önce ekranın kayıttakine benzediğine bakılır. Ekran farklılaştığı anda model o noktadan devam eder.
- Hedefe ulaşınca **tamam**, ulaşamazsa **olmadı** çıkışından devam eder.

## Emin olma

- Sıradaki node **Koşul** ya da **Dosyayı Bekle** ise eylem bir kez yapılır ve kontrol edilmeden geçilir; o node ekrana kendisi bakar.
- Tarayıcıda: sayfanın yüklenmesi beklenir, sıradaki adımın yazısı sayfada mı diye bakılır.
- Ekranda: eylemden önce ve sonra bir kare alınır. Sayfa değiştiyse ve sıradaki yazı geldiyse devam edilir. Tepki net
  değilse akış hemen bozulmaz: sıradaki adımın hedefi ekranda mı diye bakılır, yoksa beklenir, gerekirse model plan kurar.
  Aynı komut yeniden basılmaz.
- **Yazı Yaz** sonrası alanın içi okunur. Başka bir şey yazıyorsa alan temizlenip bir kez daha yazılır; yine tutmazsa
  adım hata verir. Kutu içindeyse o tur orada kalır ve sıradaki öğeye geçilir.
- Son 10 ekran karesi `%APPDATA%/xp-agent-studio/shots` altında tutulur, eskisi silinir.
- Model konuşmaları ajan günlüğüne düşer: giden `API →`, dönen `API ←`.

## Uzun çalıştırmalarda güvenceler

- **Durdurma her an çalışır.** Model istekleri 90 sn’de kesilir; Ctrl+Shift+Q bekleyen isteği de hemen iptal eder. Geçici hatalarda
  (429, 5xx, bağlantı kopması) istek 3 sn sonra bir kez daha denenir.
- **Adım sınırı tur başınadır.** “Maks. adım” kutunun her turu için ayrı sayılır; aşan tur (örn. hiç bitmeyen Koşul → Zamanlayıcı
  döngüsü) orada kalır ve sıradaki öğeye geçilir.
- **Tepki doğrulanamazsa adım hata sayılmaz.** Sıradaki adım kendi hedefini arar ve bekler. Hafızaya yalnızca
  tepkisi doğrulanan hedefler yazılır.
- **Yazı Yaz güvenlidir.** Ctrl+A / Delete yalnızca odak bir yazı alanındayken gönderilir. Klavyeyle yazılamayan karakterler
  (Çince vb.) pano üzerinden yapıştırılır. Alan biçimlendirme yaptıysa (1.5 → 1,5) sadece uyarılır.
- **Odak kayarsa** (Windows bildirimi, Teams, bu pencere) tuşlar göndermeden önce çalışılan pencere yeniden öne getirilir.
- **Bilgisayar uyumaz**, ekran kilitlenirse ajan kilit açılana kadar bekler.
- **Kayıtlı İnisiyatif yolu** her tıklamadan önce tıklanacak yerin görüntüsünü kayıttakiyle karşılaştırır; tutmazsa modele devreder.
- **Tarayıcı modu** sayfa yeniden çizilse de öğeyi yazısı ve türüyle yeniden bulur. 60 sn içinde yol verilmeyen dosya penceresi iptal edilir.
- **Çince/Japonca/Korece:** Windows’a o dilin OCR paketi yüklüyse ek olarak o dille de okunur; yüklü değilse günlükte nasıl ekleneceği yazar.
- **Büyük pencereler** (tarayıcılar) öğe ağacı 6 sn’de okunamazsa atlanır, ekran taraması takılmaz.
- **Günlük dosyası:** her çalıştırma `%APPDATA%/xp-agent-studio/logs` altına yazılır (son 30). Bir tur hata verirse o anki ekran
  da kaydedilir. Ajan Günlüğü’ndeki **Günlük klasörü** düğmesi açar.

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
| Tarayıcıyı Aç | Edge/Chrome’u açar, adrese gider; sonraki adımlar sayfanın içini görür | sonra |
| Dosyayı Bekle | Klasöre yeni dosya inip tamamlanana kadar bekler → `{{dosya}}` | geldi / zaman aşımı |
| Dosyayı Taşı | Dosyayı yeni adıyla taşır (`D:\Modeller\{{öğe.isim}}.glb`) | sonra |
| Bitir | Akışı sonlandırır | — |

“Zaman aşımı” ve “olmadı” çıkışları, bir de bekleme süresi verilmiş Koşul’un “yok” çıkışı bir yere bağlı değilse adım hata verir. Kutunun içindeyse o tur orada kalır, sıradaki öğeye geçilir.

## Örnek: klasördeki her resimden 3D model

```
Başlangıç → Tarayıcıyı Aç https://site
          → [Her Öğe İçin: C:\Resimler klasörü]
               Tıkla “Resim yükle” → Yazı Yaz {{öğe}} → Tıkla “Oluştur”
               → Koşul “İndir” (10 dk bekle) → Tıkla “İndir”
               → Dosyayı Bekle *.glb → Dosyayı Taşı D:\Modeller\{{öğe.isim}}.glb
            bitti → Bitir
```

## Kullanım

- **İleriye ekle:** node’un sağındaki yeşil **+** → tür seç. Arada bağlantı varsa yeni node araya girer ve aynı kutuya katılır.
- **Bağla:** renkli çıkış noktasını sürükleyip başka bir node’un (ya da kutu başlığının) üstüne bırak.
- **Tuval:** tekerlek yakınlaştırır/uzaklaştırır, orta tuşla sürüklemek kaydırır. Köşedeki yüzde 100%’e döner.
- **Seç:** boş yerde sürüklemek kutu çizerek seçer. `Shift` ile tıklamak seçime ekler ya da çıkarır; `Shift` basılıyken çizilen kutu da seçime eklenir. Seçililer birlikte sürüklenir. `Ctrl+G` kutuya alır, `Del` siler, `Ctrl+D` kopyalar.
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

API anahtarı olmadan da çalışır: yazı eşleştirmesi, tarayıcı modu, kutular ve dosya node’ları modelsiz çalışır. İnisiyatif ve
görsel mod anahtar ister.

## Exe

Repoda hazır portable paket: **`XP-Agent-Studio.exe`** (Windows 10/11 x64). Çift tıkla, kurulum yok. Tarayıcı modu için
Edge (Windows’ta hazır gelir) ya da Chrome yeterli; ayrıca tarayıcı indirilmez.

## Geliştirme

```bash
npm install
npm run dev          # Electron + Vite (hot reload)
npm run dev:web      # Sadece arayüz, tarayıcıda http://127.0.0.1:4521 (tıklamalar simüle)
npm run pack:win     # release/XP-Agent-Studio.exe üretir
```

- `electron/runner.ts`: akışı yürütür (kutular, kurtarma, kaldığı yerden devam).
- `electron/agent.ts`: adımları yapar (hedef bulma, hafıza, doğrulama, İnisiyatif, dosyalar).
- `electron/browser.ts`: tarayıcı modu (`playwright-core`, sistemdeki Edge/Chrome ile).
- `electron/memory.ts`: hedef hafızası ve çelişki kontrolü.
- `a11y/`: ekran okuma ve tıklama için PowerShell (`worker.ps1` sürekli açık kalan tek süreç; `screen.ps1` ekran
  görüntüsü + `Windows.Media.Ocr` + UI Automation). Gerçek ekran otomasyonu yalnızca Windows 10/11’de çalışır.

API anahtarı `electron-store` ile kullanıcı profiline (`%APPDATA%/xp-agent-studio`) yazılır. Tarayıcı profili aynı
klasörde `browser-profile` altındadır.
