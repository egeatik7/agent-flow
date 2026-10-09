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

Araç çubuğunun altında her tuval bir sekmedir ve ayrı bir akıştır. **Ajanı Çalıştır** açık tuvali çalıştırır; sekme çubuğunun en solundaki **▶ / ■** bütün açık tuvallerin soldan sağa sırasını oynatır/durdurur. Sıradaki tuval, önceki tuval hatasız biçimde kendi **Bitti** node'una ulaşınca başlar.

Sağ panelde Node, LLM, Ayarlar ve Ajan’ın yanında **Tuvaller** sekmesi vardır. Bu sekmenin **Tuval Deposu** ve **Otomasyonlar** ekranları aynı tuval kayıtlarını kullanır. **Tuvali Kaydet** listeye kaydeder; kayıt yanındaki **+** yeni sekmede açar, kırmızı **×** onayla siler. Sekmeyi kapatmak kayıtlı tuvali silmez. Otomasyonlar depodaki tuvallere bağlı sıralı listelerdir. **Düzenle** ile depodan tuval ekle/çıkar, sırasını değiştir ve **Kaydet**; **Aç** kayıtlı sırayı üst sekmelere yükler, **Export** taşınabilir JSON üretir. Tuvali depoda kaydetmek veya yeniden adlandırmak, onu kullanan bütün otomasyonları günceller. **İçe Aktar** tek tuvali yeni sekmede açıp kaydeder; otomasyon JSON'u ise sağdaki gruplara ekler. [Kullanım ayrıntıları](docs/tuvaller-ve-otomasyonlar.md).

Tuvalde **Ctrl+A** bütün node’ları seçer. **Ctrl+C** kopyalar, **Ctrl+X** keser (Başlangıç yerinde kalır), **Ctrl+V** yapıştırır. Ok, iki ucu da kopyadaysa durur; seçimin dışına çıkan ok kopar. Aynı kopya başka bir tuvale veya açık bir paketin içine de yapışır.

## Hedef nasıl bulunur?

Sırayla, ilk bulunan yerde durur:

1. **Sayfanın kendisi.** Programın açtığı tarayıcı öndeyse, düğmeler, bağlantılar ve alanlar gerçek adlarıyla okunur.
2. **Yakalanan öğe.** Node Ekran Tarayıcı ya da İmleçle Yakala ile oluşturulduysa önce uygulamanın kendi öğesi, sonra öğenin
   kayıtlı resminin ekrandaki aynısı aranır (modelsiz, hızlı).
3. **Ekran.** Node’da tırnak içi yazı varsa önce Windows OCR, bulamazsa ONNX. İkisi de value ramp ve 90° turunu kullanır. Tırnak yoksa ya da ikisi de bulamazsa UI-TARS (görsel model) devreye girer; **kelime listesi** aşaması varsayılan olarak kapalıdır ve LLM panelinden açılır.

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
- Ekranda: eylemden önce ve sonra bir kare alınır. Sıradaki hedefin yeni görünmesi sonuç sinyalidir; zaten duran
  bir etiket veya ilgisiz ekran değişimi tek başına başarı sayılmaz. Tepki belirsizse sonraki adım kendi hedefini
  kullanır; önceki adımın hafızasına doğrulanmış hedef yazılmaz. Aynı komut yeniden basılmaz.
- Alan seçen **Tıkla → Yazı Yaz** adımlarında tıklama noktası Yaz node'una aktarılır. Yazma önce öndeki penceredeki
  ilgili alanı bulur; salt okunur öğeler aday değildir. UIA bir Pane bildirirse gerçek Windows edit odağı da okunur.
- **Yazı Yaz** sonrası yazılan alanın değeri okunur; Enter kapalıysa tam ekran karşılaştırması yapılmaz. Başka bir
  şey yazıyorsa alan temizlenip bir kez daha yazılır; yine tutmazsa adım hata verir. Model alan seçerse Windows
  tarafında aynı öğe saklanır; liste sırası değişince başka alanın üzerine yazılmaz. Alan kapanırsa veya pencere
  değişirse yazı gönderilmez. Enter, yazma ve değer kontrolünden sonra tek kez gönderilir.
- Son ekran kareleri `%APPDATA%/xp-agent-studio/shots` altında tutulur, eskisi silinir.
- Model konuşmaları ajan günlüğüne düşer: giden `API →`, dönen `API ←`.

## Uzun çalıştırmalarda güvenceler

- **Sağ alt rapor.** Çalışırken ekranın sağ altında, diğer pencerelerin üstünde, o anki adım yazar. Tıklamalar içinden geçer. Node bir döngünün içindeyse kutunun altında, görev çubuğuna binmeden, kaçıncı öğe olduğu ve öğenin adı durur. Cevap veren model kendi kod adıyla konuşur (`deepseek-v4: …`). Bu pencere ekran görüntüsüne girmez, öğe listesine düşmez ve tıklamalar içinden geçer; Nubbo kendi raporunu okuyamaz.
- **Durdurma her an çalışır.** Model istekleri 90 sn’de kesilir; Ctrl+Shift+Q bekleyen isteği de hemen iptal eder. Geçici hatada
  (429, 5xx, bağlantı kopması) sıradaki model hemen denenir; bütün modeller susarsa 4 sn sonra ilk modelden baştan başlanır.
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
- **Günlük dosyası:** her sürüm kendi klasörünü açılışta oluşturur: `%APPDATA%/xp-agent-studio/logs/<sürüm>/` (o sürümden son 30 çalıştırma). Klasör adı sürüm numarasıdır. Bir tur hata verirse o anki ekran da bu klasöre kaydedilir. Ajan Günlüğü’ndeki **Günlük klasörü** düğmesi bu sürümün klasörünü açar.

## Ajan sekmesi (araç katmanı)

Sağ paneldeki **Ajan** sekmesi, akışı bir ajanın kullanabileceği araçlara açar. Araçlar ayrı bir
tıklayıcı değildir: hepsi **mevcut motoru** kullanır — aynı hedef bulma, aynı odak, aynı tuş
koruması (başka program öndeyse uygulama tuşu gönderilmez), aynı hafıza ve aynı durdurma.

| Araç | Ne yapar | Ekrana dokunur |
| --- | --- | --- |
| `flow.read` | Node’ları, paketleri, döngüleri, bağlantıları listeler | Hayır |
| `flow.context` | Bir node’un paket yolunu, içindeki kutuları ve o anki öğeyi söyler | Hayır |
| `flow.suggest` | Bir düzenleme planını denetler ve neyi değiştireceğini yazar | Hayır |
| `branch.create` | Kendi branch’ini açar: akışın kopyası değil, düzenleme tarifi | Hayır |
| `branch.list` | Açık branch’leri, kaç düzenleme tuttuklarını ve neyi değiştirdiklerini listeler | Hayır |
| `branch.diff` | Bir branch’in temel tuvaline göre farkını gösterir | Hayır |
| `flow.edit` | Branch’e düzenleme ekler (yalnız kendi branch’ine) | Hayır |
| `flow.undo` | Branch’teki son düzenlemeyi geri alır | Hayır |
| `branch.drop` | Branch kaydını siler | Hayır |
| `target.preview` | O node için nereyi hedefleyeceğini, kaç aday bulduğunu söyler | Hayır |
| `step.run` | **Tek adım**: yalnız o node’u çalıştırır, zincir orada durur | Evet |
| `run.from` | Belirtilen node’dan koşuyu başlatır ve hemen döner (`runId` verir) | Evet |
| `run.state` | Koşunun hangi node’da/kutuda/öğede olduğunu, bittiyse son sonucu söyler | Hayır |
| `run.stop` | Durdur düğmesinin yaptığını yapar | Hayır |
| `screen.read` | Pencereleri ve ekrandaki yazıları okur; istenirse görüntü dosyasını verir | Hayır |

**Tek adım izoledir.** Akışın bir **kopyasında** koşar: döngü işareti, hafıza ve kayıtlı yol
değişmez; zincir o node’dan sonra motorun kendi durdurma yoluyla kesilir. Bir koşu sürerken tek
adım, tek adım sürerken koşu **başlatılamaz** — aynı anda iki şey fareyi süremez.

**İzin.** Bu sekmedeki düğmeler sorulmaz: basman onayındır. Dışarıdan gelen çağrılar için izin
ayarı geçerlidir: **Kapalı** (eyleyen araç çalışmaz), **Sor** (her eyleyen çağrı onay ister;
“Bu oturumda hep izin ver” uygulama kapanınca sıfırlanır), **Otomatik**. Okuma araçları hiç sorulmaz.

**Yerel uç nokta.** “Dışarı açık” işaretlenirse uygulama yalnız `127.0.0.1` üzerinde bir kapı açar;
adres ve jeton `%APPDATA%/xp-agent-studio/tool-endpoint.json` dosyasına yazılır (arayüzde
**Dosyanın konumunu aç**). Kapı varsayılan olarak **kapalıdır** ve her çağrı yukarıdaki izin
ayarından geçer.

```
node scripts/nubbo-cli.cjs tools                       # araç kataloğu (uygulama gerekmez)
node scripts/nubbo-cli.cjs flow --file akis.json --nodes
node scripts/nubbo-cli.cjs context --file akis.json --node <id>
node scripts/nubbo-cli.cjs suggest --file akis.json --ops-file plan.json
node scripts/nubbo-cli.cjs state                       # uygulama açık + uç nokta açık olmalı
node scripts/nubbo-cli.cjs preview --node <id>
node scripts/nubbo-cli.cjs step --node <id>
node scripts/nubbo-cli.cjs from --node <id>
node scripts/nubbo-cli.cjs screen --image
```

## Branch: ajanın önerisi (kopya değil, tarif)

Ajan akışını **doğrudan değiştiremez**. `branch.create` ile **kendi branch’ini** açar: bu, tuvalin
kopyası değil, **düzenleme tarifidir** (`{ad, temelTuval, temelParmakIzi, opListesi}`). Tam grafik
yalnız gerektiğinde (bakmak, test etmek, merge etmek) **temel + tarif** olarak bellekte üretilir —
yirmi branch birkaç kilobayt tutar, yirmi akış kopyası tutmaz. Aynı anda en fazla **3** branch açık
olabilir; branch silinince akışa hiçbir şey olmaz.

- **Düzenleme:** `flow.edit` yalnız ajanın kendi branch’ine yazar; her çağrı bir **grup** olur ve
  `flow.undo` son grubu geri alır. Kullanıcının tuvaline ve kayıtlı akışa **hiç** yazılmaz.
- **Denetim:** `flow.suggest` gibi aynı kurallar işler: hedef kanıtı alanları (`locator`, simge,
  hafıza, çapa, yol, iz) yazılamaz, `Başlangıç`/`Paket`/`Kutu` eklenemez, olmayan çıkış adı ve dolu
  çıkışa ikinci bağlantı reddedilir (motor bir çıkışta **ilk oku** izler), `Başlangıç`’a ok çekilemez.
- **Test:** `step.run --branch <id>` ve `run.from --branch <id>` tarifi **türetilmiş grafik** üzerinde
  çalıştırır. Branch koşusu **kayıtlı akışa yazılmaz** ve tuvali ışıklandırmaz; döngü işaretleri
  kullanıcının tuvalinde değişmez.
- **Temel değişirse:** tarif **güncel** tuvaline uygulanır ve `baseChanged` bildirilir; artık uymayan
  grup **ismiyle** söylenir, kalanı yine uygulanır (sessizce yutulmaz).
- **Merge iki adımlıdır ve senin elindedir:** `branch.merge` önce yalnız **deneme** yapar (ne yazılacağını, temel değişmişse uyarıyı ve uymayan grupları söyler, hiçbir şey yazmaz). `apply: true` ile **uygulama** yalnız **Nubbo penceresinden** yapılır ve tuvali **pencere** yazar (defterin sahibi o; bu yüzden merge ona devredilir ve onayı beklenir — pencere yanıt vermezse **hiçbir şey yazılmaz**). Uygulanınca branch **tarifi silinir**, çünkü aynı düzenlemeler artık akışın kendisindedir; silinmezse ikinci kez uygulanırdı.
- **Yanlış merge geri alınabilir:** uygulamadan önceki tuval ve silinen tarif bellekte tutulur; panelde çıkan **“Son merge’ü geri al”** düğmesi tuvali merge öncesi hâline döndürür ve tarifi geri açar. **Bir kez** ve **aynı oturumda** çalışır (uygulama kapanınca unutulur); ajan bu geri almayı çağıramaz.

`flow.suggest` tek başına da kullanılabilir: bir planı denetler ve **hiçbir şey yazmaz**.

## Node türleri

| Node | Ne yapar | Çıkışlar |
| --- | --- | --- |
| Başlangıç | Akışın giriş noktası | sonra |
| Tıkla | Ekranda/sayfada yazan yeri bulup tıklar (tek/çift/sağ tık) | sonra |
| Yazı Yaz | Bir alana (veya o an seçili alana) yazar, alanı okuyup doğrular, isteğe bağlı Enter | sonra |
| Tuş Gönder | Kısayol (`win+r`, `ctrl+s`, `alt+f4`; eski `^s`, `%{F4}`, `#r` de olur) | sonra |
| Zamanlayıcı | N saniye bekler | sonra |
| Koşul | Ekranda bir yazı ya da seçilen öğe (simge dahil) var mı? İstersen görünene kadar bekler | var / yok |
| Her Öğe İçin | Kutu: içindekileri listedeki her öğe için, her çalıştırmada baştan çalıştırır | bitti |
| İnisiyatif | Tarif edilen hedefi model birkaç eylemde yapar | tamam / olmadı |
| Paket | İçine bir alt akış alır; çalışınca içi baştan sona gider, sonra dışarıdaki sonraki node çalışır | sonra |
| Bitir | Akışı sonlandırır | — |

“olmadı” çıkışı ve bekleme süresi verilmiş Koşul’un “yok” çıkışı bir yere bağlı değilse adım hata verir. Kutunun içindeyse o tur orada kalır, sıradaki öğeye geçilir. Eski bir akışta Tarayıcıyı Aç, Dosyayı Bekle veya Dosyayı Taşı kalmışsa o adım **hata verir**; sessizce atlanmaz. Kutu dışındaysa akış o noktada durur, kutunun içindeyse o tur hatalı sayılır ve sıradaki öğeye geçilir. Node’u silip akışa devam et.

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

Portable paket `npm run pack:win` ile üretilir: **`release/Nubbo.exe`** (Windows 10/11 x64). Çift tıkla, kurulum yok. Exe repoda tutulmaz (`.gitignore` dışlar), bu yüzden yeni bir klonda hazır gelmez. Chrome sayfasının yazısını okumak için Chrome’u `--remote-debugging-port=9222` ile aç.

## Geliştirme

```bash
npm install
npm run dev          # Electron + Vite (hot reload)
npm run dev:web      # Sadece arayüz, tarayıcıda http://127.0.0.1:4521 (tıklamalar simüle)
npm run pack:win     # release/Nubbo.exe üretir
```

Odak/yazma regresyon kontrolleri:

```powershell
npm run test:input
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-worker.ps1
```

İlk komut TypeScript ajanını, ikinci komut gerçek worker fonksiyonlarını taklit edilen alanlarla sınar.
İkincisi PowerShell 7'de `pwsh -NoProfile -File scripts/test-worker.ps1` ile de çalışır.
Bu testler gerçek Windows UIA, Blender veya Hunyuan oturumlarının yerine geçmez. Windows kontrolünde
Çalıştır alanına bir EXE yolu yazmayı ve FolderBatcher'da Kaynak/Hedef etiketlerine ayrı ayrı tıklayıp
ilgili kutulara farklı yollar yazmayı dene; diğer alanın değerinin korunduğunu kontrol et.

Tuş / Kısayol kontrolleri:

```powershell
npm run test:keys
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-key-input.ps1
```

İlk test hazır tuş düğmelerini ve Win düğmesinin alanı bozmadığını kontrol eder. İkinci test gerçek
worker ayrıştırıcısını ve XpInput metotlarını kullanır; işletim sistemi tuş çağrılarını kayda alır,
masaüstüne tuş basmaz. Hatalı girişlerin hiçbir tuş göndermediğini ve hata sırasında tuşların
bırakılmasının denendiğini sınar. PowerShell 7'de `pwsh -NoProfile -File scripts/test-key-input.ps1`
ile de çalışır. Gerçek Windows oturumunda Win+R, Win+E, Win+D ve Win+Tab ayrıca denenmelidir.

Yeni yazım: `win+r`, `ctrl+s`, `win+shift+s`, `enter`. Eski `^s`, `%{F4}`, `+a`, `A`, `#r`
gibi değerler yeniden yazılmaz; `#r` Windows+R'dir, `{WIN}` / `{LWIN}` / `{RWIN}` Windows tuşuna basar.
`win+` tek başına Windows tuşuna basar. Win düğmesi boş veya tamamlanmış alanda `win+` başlatır;
`ctrl+` gibi bir önekte `ctrl+win+` oluşturur ve Windows'u ikinci kez eklemez.
`ctrl++s` veya `win+{TAB}` gibi hatalı/karışık yeni yazımlar hata verir, metin olarak yazılmaz.
Yazı Yaz node'u bu kısayol ayrıştırıcısından geçmez.

- `electron/runner.ts`: akışı yürütür (kutular, kurtarma, kaldığı yerden devam).
- `electron/agent.ts`: adımları yapar (hedef bulma, hafıza, tepki, takılma, İnisiyatif).
- `electron/browser.ts`: kullanıcının 9222 portuyla açtığı Chrome’un sayfa yazısı (`playwright-core`).
- `electron/memory.ts`: hedef hafızası ve çelişki kontrolü.
- `a11y/`: ekran okuma ve tıklama için PowerShell (`worker.ps1` sürekli açık kalan tek süreç; `screen.ps1` ekran
  görüntüsü + `Windows.Media.Ocr` + UI Automation). Gerçek ekran otomasyonu yalnızca Windows 10/11’de çalışır.

API anahtarı `electron-store` ile kullanıcı profiline (`%APPDATA%/xp-agent-studio`) yazılır.
