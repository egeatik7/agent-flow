# Nubbo Agent Studio — Ürün amacı ve geliştirme ajanı için devir metni

Bu metin, Nubbo üzerinde çalışacak geliştirme ajanına ürünün neyi başarması gerektiğini ve hangi kararların bu amaca uygun olduğunu anlatır. Kaynak kodun yerine geçmez. Mevcut davranış ile hedeflenen davranışı ayır; burada tarif edilen güvenilirlik düzeyinin bugün bütünüyle sağlandığını varsayma.

## 1. Projenin amacı

**Nubbo, kodlama bilmeyen bir insanın bilgisayarda yaptığı işleri mevcut node’lara basit, anlaşılır komutlar vererek tarif etmesini ve bu akışların değişen ekranlara uyum sağlayarak saatlerce, çok sayıda döngü boyunca güvenilir çalışmasını amaçlayan bir Windows masaüstü ve web otomasyon programıdır.**

Akışta işin gerektirdiği kadar node bulunabilir. Kullanıcı her node’a “şuraya tıkla”, “bu alanı doldur”, “şu kısayolu gönder”, “bu işlemi tamamla” gibi anlaşılır bir talimat verebilmelidir. Basitlik, komutların kolay verilmesi ve anlaşılmasıdır; akışın kısa olması değildir.

Kullanıcının yaşamak istediği deneyim şudur:

> “Node’ları hızlıca dizdim. Şuraya tıkla, bunu yaz, şu kısayolu gönder, burada bekle dedim. Dosyaları döngüye koydum. Çalıştırdım ve iş başladı. Döndüğümde yüzlerce kez tekrar etmiş, sonuçlar hazırdı. Bunun için kod yazmam, API öğrenmem veya her adımın etrafına bir sürü kontrol yerleştirmem gerekmedi.”

**En yüksek öncelik robust çalışma, yani uzun süreli güvenilirliktir.** Kullanımın kolay olması ve akışın hızlı kurulması önemlidir; ancak bunlar yanlış hedefe işlem yapmayı, gerekli bir kontrolü kaldırmayı veya mevcut node davranışını bozmayı haklı çıkarmaz. İlk turda çalışıp üçüncü turda yanlış pencereye yazan bir akış hedefi karşılamaz. Kullanıcının güvenilir bir akış kurabilmek için küçük bir programlama dili öğrenmesi de beklenmez.

Geliştirme kararlarında öncelik sırası:

1. Doğru hedefte, doğru işi güvenilir biçimde yapmak; belirsizlikte riskli eylemden kaçınmak.
2. Mevcut node’ların işlevini, komutlarını, ayarlarını ve eski akışların davranışını korumak.
3. Kullanıcının mevcut node’lara basit komutlar verebilmesini sağlamak.
4. Bu güvenceleri koruyarak kurulum süresini, gecikmeyi ve model maliyetini iyileştirmek.

Node sayısını azaltmak bir geliştirme hedefi değildir. Daha uzun ama açık ve güvenilir bir akış, adımları birleştirilmiş fakat tahmine dayanan bir akıştan daha uygundur.

## 2. Kullanıcı ve kullanım biçimi

Kullanıcı koddan anlamak zorunda değildir. Windows uygulamalarını insan gibi kullanmayı bilir: düğmeye basar, menü açar, dosya seçer, kısayol gönderir, alan doldurur, klasör açar, bir işlemin bitmesini bekler.

Akışı da bu eylemler üzerinden kurabilmelidir. Örneğin:

- “Resim yükle” düğmesine tıkla.
- Dosya yolunu yaz.
- Enter gönder.
- “Oluştur” düğmesine tıkla.
- Üretim için bekle.
- Sonucu indir.
- Aynı işlemleri sıradaki resim için yap.

Kullanıcı isterse ekrandan hedef seçebilmelidir. Her hedef için koordinat hesaplaması, CSS selector yazması, Windows öğe ağacını çözmesi veya Blender Python API’sini öğrenmesi beklenmez. Teknik altyapı bu basit kullanımın arkasında çalışır.

## 3. Node’ların taşıması gereken anlam

Mevcut node türleri ve ne yaptıkları korunur. Tıkla, Yazı Yaz, Tuş Gönder ve Zamanlayıcı gibi node’lara basit komutlar verilir. Döngü bu işleri tekrarlar. Paket, tekrar kullanılacak anlaşılır bir alt akışı toplar. Komutların kolay yazılması için node’ların anlamını değiştirmek veya farklı işleri tek bir node’a yığmak gerekmez.

**İnisiyatif node’u**, kullanıcının bilerek modele bıraktığı sınırlı bir hedef için vardır: alışılmadık bir menüden ilgili seçeneği bulmak, bir sonucu değerlendirmek veya belirli bir alt görevi tamamlamak. Bilinen yirmi adımı tek bir büyük İnisiyatif node’una taşımak, kullanıcının istediği açıklığı ve denetlenebilirliği azaltır. Modelin hareket alanı kullanıcının verdiği görevle sınırlıdır; “iş bitsin” diye riskli kestirmeler seçmesine veya kapsamı kendiliğinden genişletmesine izin verilmemelidir.

Her tıklamadan sonra kullanıcının yürütücü kusurlarını telafi eden “ekranda bu var mı?”, “yoksa bitir”, “yeniden dene” zincirleri kurması gerekmesin. Koşul node’u, işin gerçekten dallanması gerektiğinde yararlıdır. Mevcut gerekli kontrolleri sadece node sayısını azaltmak veya akışı hızlandırmak için kaldırma. Kullanıcının kurduğu akıştaki node’ları ve bağlantıları talep edilmeden yeniden düzenleme.

**Akış 10 node da olabilir, 100 node da. Önemli olan kullanıcının her node’u basit bir komutla kurabilmesi ve her node’un kendi işini güvenilir biçimde yapmasıdır.** Bilinen adımları açıkça dizmek tercih edilir; sırf akış kısalsın diye modele daha fazla inisiyatif bırakılmaz.

## 4. Güvenilirlik nerede sağlanmalı?

Temel eylemlerin güvenilirliği yürütücünün sorumluluğudur. Kullanıcı “bu alana şu yolu yaz” dediğinde Nubbo ilgili alanı bulma, odağı alma, yazıyı gönderme ve mümkünse değeri okuma işini kendi içinde yönetmelidir.

Bu, her node’dan sonra pahalı bir ekran karşılaştırması veya LLM değerlendirmesi çalıştırmak anlamına gelmez. Kontrol eyleme uygun olmalıdır:

- Yazma için yazılan alanın değeri, ilgisiz bir ekran etiketinden daha anlamlıdır.
- Alan seçme tıklamasında bütün ekranın değişmesi beklenmez.
- Menü açma veya sayfa geçişinde ilgili yeni öğelerin görünmesi kullanılabilir.
- Uzun işlemde uygulamanın o işleme ait tamamlanma durumu aranabilir.

**Komut gönderildi, sonuç gözlendi, sonuç belirsiz ve işlem başarısız durumlarını ayır.** Belirsiz bir eylemi doğrulanmış başarı gibi raporlama. Önceki işlemin tamamlandığını varsayan bir sonraki eylem risk doğuruyorsa yeniden gözlemle, sınırlı süre bekle veya açık bir nedenle dur. Sonraki adıma ancak onun gerektirdiği mevcut durum yeterince anlaşıldığında geç; sadece akış ilerlesin diye tahmin yürütme.

Komutların basit olması, yürütücünün hiçbir şey kontrol etmemesi anlamına gelmez. Güvenilirliği sağlayan kontroller korunmalıdır. Gereksiz veya hatalı kontroller düzeltilirken güvence zayıflatılmamalı; kontrollerin kendi başına yanlış karar veya sonsuz bekleme üretmesine de izin verilmemelidir.

## 5. Bilgisayarı nasıl kullanmalı?

Ürün, kullanıcının gördüğü masaüstü ve web arayüzlerini kullanır. İçeride birden fazla algılama yolu bulunabilir:

1. Uygun tarayıcı bağlantısı varsa sayfa öğeleri ve DOM.
2. Windows UI Automation ile gerçek uygulama öğeleri.
3. Kaydedilmiş küçük resmin ekranda eşleştirilmesi.
4. Windows OCR ve ONNX OCR ile yazıların konumu.
5. Gerektiğinde yazı listesini yorumlayan model veya ekranı gören GUI modeli.
6. Yeterli bağlamla desteklenmiş kayıtlı konum.

Bu yolların mevcut sırası ve açık/kapalı durumu ayarlanabilir; herkese uygun tek bir sabit sıra dayatma. Hedef, önce güvenilir bilgiyi kullanmak, belirsizliği gerektiğinde daha yetenekli yöntemle çözmektir. Daha hızlı veya daha ucuz olması bir yöntemin yanlış hedef riskini kabul etmek için gerekçe değildir.

Kullanıcıya API öğrenme yükü getirmeden DOM veya UIA kullanmak ürün amacına uygundur. Uygulamayı kontrol etmek için uygulamaya özel görünmez bir otomasyon sistemi kurup bütün akışı oraya taşımak kullanıcının istediği yöntem değildir.

Blender gibi UIA’nın yetersiz kaldığı uygulamalarda OCR ve görsel model daha önemli olabilir. Görsel yöntem genel olarak pahalı olduğu için kontrollü kullanılmalı; fakat ilgili uygulamada gerçekten gerekliyse doğru yerde devreye girmelidir. UIA’nın her uygulamada bütün düğmeleri göstereceğini varsayma.

## 6. Hedef bulmada korunması gereken kurallar

- Seçim, mümkün olduğunca güncel ekran durumuna dayanmalı. Kaydedilmiş hafıza tekrar eden hedefleri ayırmak için ipucudur; eski konuma koşulsuz tıklama yetkisi değildir.
- Aynı “Kaydet”, “İndir” veya “Run” yazısı birden fazla yerde olabilir. Pencere, menü/panel, öğe türü, yakınındaki yazılar ve konum birlikte değerlendirilmelidir.
- OCR bir yazıyı bulmuş olabilir; yazının ortası her zaman gerçek düğmenin veya ilgili giriş kutusunun ortası değildir. Etiket, kutu ve düğme ayrımı önemlidir.
- Modelin seçtiği numara yalnızca o taramadaki aday listesinin numarasıdır. Yeni bir taramada aynı numaranın aynı öğe olduğunu varsayma.
- Ekran görüntüsü, OCR kutuları, tıklama koordinatları ve modelin cevabı aynı koordinat sistemine bağlı kalmalı. DPI, kırpma, döndürme ve birden çok monitör bu ilişkiyi bozmamalıdır.
- Pencere değişirse veya hedef kaybolursa önceki seçim yeniden değerlendirilmelidir. Başka uygulamadaki benzer bir alan otomatik olarak hedefin yerine geçmemelidir.
- Eski pencere içi nokta, yeni ekrandaki kanıtla desteklenmeden genel bir başarı yöntemi sayılmamalıdır. Hedef çözülemediyse “bir yere tıkla, belki olur” yaklaşımı kullanma.

## 7. OCR ve görsel algılama bağlamı

Nubbo’da Windows OCR, ONNX OCR, görüntüye uygulanan ton aralığı düzenlemesi ve yan yazıları okumak için 90 derece döndürülmüş tarama bulunur. Blender addon panellerindeki dar, küçük veya yan yazılar bu yolların geliştirilme nedenlerinden biridir.

Bu parçalar üzerinde çalışırken:

- Kullanıcıya gösterilen önizleme ile OCR için işlenen görüntünün rollerini ayır; önizlemenin yanlışlıkla gri veya boş kalmasını normal sayma.
- Döndürülmüş OCR kutularını özgün ekranın koordinatlarına doğru taşı.
- İki taramanın aynı yazısını iki ayrı hedef gibi sunma; yakın ama farklı menüleri de yanlışlıkla birleştirme.
- Yazı listesinin görmediği bir düğmeyi yazı modelinin görmüş gibi davranmasını bekleme. Görsel görev için gerçekten görüntü alabilen model gerekir.
- OCR’ın bulduğu bölgeyi kırpıp GUI modeline verme bir geliştirme seçeneğidir; tüm görevlerde mevcut ve çalışıyor kabul edilmemelidir. Kırpma kullanılırsa yeterli çevre bilgisi ve doğru koordinat dönüşümü korunmalıdır.
- 1080p kareyi büyütmek gerçek yeni ekran ayrıntısı üretmez. Ölçeklemenin OCR’a yararı varsa bunu ilgili ekran örnekleriyle ölç; görüntü boyutunu büyütmeyi otomatik güvenilirlik çözümü sayma.

## 8. Yazma, odak ve eylem tekrarı

Yanlış alana yazmak, yanlış yerde Ctrl+A/Delete göndermek veya Enter’ı iki kez basmak bütün akışı bozabilir. Bu yol özel dikkat gerektirir.

Hedeflenen giriş alanı ile gerçekten odakta olan öğeyi ilişkilendir. UIA’nın `Pane` bildirdiği durumlarda gerçek Windows edit odağı bulunabiliyorsa kullanılabilir. Salt okunur veya devre dışı öğeleri yazılabilir aday gibi sunma.

Tıklanan “Kaynak klasör” etiketi takip eden yazma adımına bağlam sağlamalıdır. Başka bir alanda klavye odağı kalmış olması kullanıcının yeni hedefini geçersiz kılmaz.

Metin okunabiliyorsa tam değer kontrol edilir. Bir dosya yolunun yarısı veya sadece rakamlarının benzemesi başarı değildir. Yerel sayı biçimlendirmesi gibi geçerli dönüşümler ayrıca ele alınabilir. Enter gerekiyorsa yalnızca bir katman bunun sorumluluğunu taşımalı ve bir kez göndermelidir.

Eylem sonucu belirsiz diye aynı komutu körlemesine tekrar gönderme. “Oluştur”, “İndir”, “Remesh başlat” veya bir dosyayı taşıma tekrarlandığında ikinci iş üretilebilir. Güvenli yeniden gözlem ile yeni bir yan etkili eylemi ayır.

## 9. Döngüler ürünün merkezindedir

Bir tur çalışan otomasyon yeterli değildir. Dosya listeleri, iç içe döngüler, paketler ve kaldığı yerden çalıştırma gerçek ürünün ana parçalarıdır.

Mevcut değişkenler arasında `{{öğe}}`, `{{öğe.ad}}`, `{{öğe.isim}}`, `{{sıra}}` ve `{{toplam}}` bulunur. Akışın aynı adımları farklı dosyalarda çalıştırabilmesi gerekir.

Özellikle şu durumları koru:

- Liste sırası belirli olmalı; doğal sıralama veya kullanıcının seçtiği sıra beklenmedik biçimde değişmemeli.
- İç döngü bittiğinde dış döngünün bağlamı geri gelmeli. Dış kutu başka klasöre geçtiğinde iç liste doğru klasörden alınmalı.
- İlk çalıştırma, seçiliden çalıştırma ve kaldığı yerden devamın anlamı açık olmalı.
- Son grubun 20’den az dosya içermesi çalışmayı bozmamalı.
- Bir öğenin hatası bütün kalan öğelerin tamamlandığı gibi raporlanmamalı. Başarı, hata ve atlanan öğe sayıları doğru olmalı.
- Aynı sürekli hata veya API kesintisi bütün listeyi tüketerek yüzlerce öğeyi başarısız geçirmemeli.
- Hata sonrası diğer öğeye geçilecekse mevcut uygulama durumu buna uygun olmalı; yarım kalan dosya penceresi veya açık diyalog sıradaki turu bozmamalı.
- Model çağrıları, ekran kareleri, öğe adayları ve hafıza saatler boyunca sınırsız büyümemeli.
- Durdurma uzun beklemelerde ve model çağrılarında da etkili olmalı. Gecikmiş bir model cevabı durdurulmuş akışta yeni tıklama üretmemeli.

Mevcut runner bazı öğe hatalarından sonra sonraki öğeye geçer, bazı tekrarlayan/API hatalarında durur. Gerçek semantiği koddan kontrol et; genel bir “hata olsa da devam ediyor” açıklaması yeterli değildir.

## 10. Bekleme ve model kullanımı

Kullanıcı bekleme adımını Nubbo’nun kendi node’larıyla kurabilmelidir. Sabit süreli Zamanlayıcı basit ve anlaşılırdır. Süresi çok değişen bir işte tamamlanmayı anlayan bekleme gerekiyorsa bu da Nubbo içinde, makul bir süre sınırı ve kontrollü gözlem sıklığıyla çözülmelidir.

Blender addon işleminde tamamlanma sinyali ilgili addon’a ve ekrana bağlıdır. Bütün Blender arayüzünün değişmesi veya tesadüfen görünen bir yazı yeterli değildir. Durum yazısı, ilerleme göstergesi, ilgili düğmenin tekrar kullanılabilir olması gibi işleme ait sinyaller değerlendirilebilir. Böyle bir mekanizmanın şu anda uygulanmış olduğunu varsayma.

Normal beklemeler kullanıcıdan tekrar tekrar karar istememeli. İşlemin zaten tamamlandığı bir alt akıştan sonra aynı sonucu bir daha bekleyen gereksiz adımlar ekleme.

Kullanıcı farklı kapasitelerde modeller kullanabilir: büyük bir model, küçük bir bulut modeli veya yerel Qwen gibi bir model. Akışın temel kontrolü, değişkenleri, alan kimliği ve güvenlik kararları her adımda çok güçlü bir modelin muhakemesine bağlı olmamalıdır.

LLM belirsiz seçim, görsel yorum, değerlendirme ve sınırlı inisiyatif için kullanılır. Basit ve kesin bir iş yerelde çözülebiliyorsa sırf ajan görünümü için modele gönderilmez. Model çıktıları tanımlı eylem şemasına uymalı; yanlış aday numarası, geçersiz koordinat veya eski ekrana verilen cevap denetlenmelidir.

Metin modeli, görsel model ve GUI eylem modeli farklı yeteneklere sahiptir. Yerel model desteği de uygun endpoint, yanıt biçimi ve gerekiyorsa multimodal kapasite gerektirir; kullanıcının yerel model kullanmak istemesi bunun mevcut repoda tamamlandığını kanıtlamaz.

## 11. Somut ana kullanım örneği

Kullanıcı bir görsel klasörü bırakıp geri geldiğinde hazır Blender projeleri bulmak istiyor. Bu, genel ürünün önemli bir kabul senaryosudur; program yalnızca bu senaryo için yapılmıyor.

İstenen iş:

1. Görselleri 20’lik gruplara ayır.
2. Kullanıcının tanımladığı üç Hunyuan hesabı/profilini ve senaryodaki hesap başına 20 hak sınırını dikkate al.
3. Her gruptaki görselleri sırayla yükle, üret ve GLB sonuçlarını indir.
4. O grubun üretme/indirme alt akışı bitince Blender’ı aç.
5. İsimleri koruyan Custom GLB addon’u ile grubun GLB’lerini içeri aktar; import zamanını hesaba kat.
6. Blender projesini anlamlı bir adla kaydet.
7. Uygun objeleri seç, Custom Remesh içindeki “Run Remesh for Multiple Objects” işlemini başlat.
8. Nubbo içinde tanımlanan bekleme yöntemiyle remesh için bekle.
9. Projeyi kaydet, Blender’dan çık ve ilgili GLB’leri OldGLBs arşivine kopyala.
10. Sonraki gruba geç. Daha geniş akışta kullanıcının hazır low-poly ve renklendirme kodları da Blender içinde çalıştırılabilir.

Kullanıcının açık açıklamasına göre görsel üretme/indirme alt akışı her GLB’yi indirerek tamamlanır. Bu sınır korunduğunda ardından tekrar bir “GLB’ler gelsin” bekleyicisi eklemek gereksizdir. Bu alt akış değiştirilirse tamamlanma sözleşmesini de yeniden değerlendir.

Bu kullanıcıya ait çalışma klasörleri:

```text
C:\Users\ASUS TUF\Desktop\Plug&Play\Image Folder
C:\Users\ASUS TUF\Desktop\Plug&Play\Image Folder\60 Images For Hunyuan
C:\Users\ASUS TUF\Desktop\Plug&Play\HunyuanGLBs
C:\Users\ASUS TUF\Desktop\Plug&Play\OldGLBs
C:\Users\ASUS TUF\Desktop\Plug&Play\Final Blends
C:\Users\ASUS TUF\Desktop\Plug&Play\NubboTools
```

Bunlar örnek akışın ayarlarıdır. Programın genel yürütücüsüne sabit kodlanmamalıdır. 20’lik grup boyutu ve hesap eşleştirmesi de bu işin ayarlarıdır.

## 12. Yardımcı araçlar hakkında açık tercih

Kullanıcı, klasörleri gruplamak gibi işleri kolaylaştıran **FolderBatcher benzeri, görünür insan arayüzü bulunan ve başka akışlarda da kullanılabilen yardımcı EXE’leri** uygun buluyor. Bunlar NubboTools içinde yer alabilir ve Nubbo tarafından normal düğme/alan etkileşimleriyle kullanılabilir.

Kullanıcı ayrı TaskWaiter/ScreenObserver benzeri araçlarla beklemeyi ve süreci gözlemlemeyi Nubbo’dan dışarı taşımayı istemiyor. Her yeni pipeline için özel, görünmez bir orkestrasyon yazılımı yazmak da istemiyor.

Bir yardımcı araç gerekiyorsa açık bir kullanıcı işi yapmalı, yeniden kullanılabilir olmalı ve insanın da açıp anlayacağı bir arayüz taşımalı. Nubbo’nun genel otomasyon yeteneğini geliştirmek önceliklidir.

## 13. Mevcut kodun kısa haritası

Repo: https://github.com/egeatik7/agent-flow

İncelenen kaynak sürümü: **1.9.2** (bu belge ilk kez 1.7.85 üzerine yazıldı; aşağıdaki sürüm notları o tarihten kalan yerlerdir). Ana teknoloji Electron, TypeScript, React/Vite; Windows tarafında PowerShell worker ve native çağrılar. Model tarafında OpenRouter, tarayıcı tarafında Playwright/CDP, ekran okumada Windows OCR ve ONNX bulunur.

| Dosya/bölüm | Rol |
| --- | --- |
| `electron/graph-types.ts` | Node, akış, hedef, hafıza ve ayar şemaları |
| `electron/runner.ts` | Akış, paket, döngü, değişken ve devam mantığı |
| `electron/agent.ts` | Hedef bulma, eylem, odak, inisiyatif ve sonuç değerlendirmesi |
| `electron/a11y-bridge.ts` | Electron ile Windows worker arasındaki köprü |
| `a11y/worker.ps1` | Windows öğeleri, yazma, odak ve giriş işlemleri |
| `a11y/common.ps1`, `a11y/screen.ps1` | UIA/native altyapı, ekran ve OCR işlemleri |
| `electron/matcher.ts`, `electron/memory.ts` | Hedef eşleştirme ve önceki turların bağlamı |
| `electron/browser.ts` | Tarayıcı öğelerine erişim |
| `electron/ocr-onnx.ts` | ONNX OCR |
| `electron/openrouter.ts`, `electron/llm-flow.ts` | Model istekleri, prompt’lar ve algılama aşamaları |
| `electron/confirm.ts` | Ekran tepkisinin sınıflandırılması |
| `electron/tools.ts`, `tool-context.ts`, `tool-state.ts`, `tool-probe.ts` | Ajan araç katmanı: akış ve hedef okuma, izole tek adım, koşu durumu ve durdurma |
| `electron/tool-edit.ts`, `tool-branch.ts` | Akış düzenleme: op doğrulama + fark, ve düzenlemeleri kopya yerine tarif olarak tutan branch kaydı |
| `electron/tool-http.ts`, `scripts/nubbo-cli.cjs` | Yerel uç nokta (yalnız 127.0.0.1, jeton dosyası) ve komut satırı istemcisi |
| `src/components`, `src/App.tsx` | Node tuvali, Ekran Tarayıcı, ayarlar ve kullanıcı arayüzü |

Ajan araç katmanı (1.9.2) sağ panelin **Ajan** sekmesinde durur ve aynı motoru çağırır: ayrı bir tıklayıcı yoktur. Araçlar okur (`flow.read`, `flow.context`, `target.preview`, `run.state`, `screen.read`), tek adım çalıştırır (`step.run`, akışın kopyasında; işaret/hafıza/kayıtlı yol değişmez) ve koşu başlatıp durdurur (`run.from`, `run.stop`). Aynı anda tek işlem masaüstüne dokunabilir: koşu sürerken tek adım, tek adım sürerken koşu reddedilir. Dış çağıranlar izin ayarından geçer (kapalı/sor/otomatik).

Akış düzenleme (1.9.6) **branch** üzerinden gelir: `flow.suggest` bir planı denetler ve hiçbir şey yazmaz; `branch.create` + `flow.edit` + `flow.undo` + `branch.diff`/`branch.list`/`branch.drop` ise ajanın **kendi branch’inde** çalışır. Branch, tuvalin kopyası değil **tariftir** (`electron/tool-branch.ts`: temel tuval + parmak izi + op grupları); tam grafik yalnız bakmak/test etmek/merge etmek için bellekte üretilir. Kullanıcının akışına ve açık tuvaline **yazılmaz**; hedef kanıtı alanları (`locator`, simge, hafıza, çapa, yol, iz) ve `Başlangıç`/`Paket`/`Kutu` ekleme yasaktır; dolu çıkışa ikinci bağlantı reddedilir (motor bir çıkışta ilk oku izler). Branch koşusu (`run.from --branch`) kayıtlı akışa yazılmaz ve tuvali ışıklandırmaz. **Merge** `branch.merge` ile iki adımlıdır: deneme herkese açık, `apply` yalnız panelden; uygulama pencereye devredilir (defterin sahibi pencere) ve pencere yanıt vermezse hiçbir şey yazılmaz; uygulanınca tarif silinir (yoksa aynı düzenlemeler ikinci kez uygulanır).

Temel kullanıcı node’ları Başlangıç, Tıkla, Yazı Yaz, Tuş Gönder, Zamanlayıcı, Koşul, Her Öğe İçin, İnisiyatif, Paket ve Bitir’dir. Tip tanımlarında eski node isimleri bulunması çalıştıkları anlamına gelmez: incelenen runner `browser`, `waitFile`, `moveFile` adımlarını sessizce atlamaz: bu türler tip tablosunda durur ama çalıştırıldıklarında “Bu node türü artık desteklenmiyor, akışı güncelleyin.” diye açık hata verir. Tanınmayan bir tür ise `normalizeGraph`'ta akışı değiştirmeden reddedilir. Yeni akış üretmeden önce gerçek yürütücüyü kontrol et.

Node’lar ve bağlantılar JSON olarak saklanır. Uygulamanın belgesi (tuvaller ve branch kayıtları) electron-store dosyasındadır: `%APPDATA%\electron-store-nodejs\Config\config.json` (günlükler ise `%APPDATA%\xp-agent-studio\logs\<sürüm>\`). **Defterin iki yazarı vardır ve her biri yalnız kendi yarısını yazar** (`electron/tool-branch.ts`: `windowSave` / `toolLayerSave`): pencere `tabs`+`activeId`'yi, araç katmanı `branches`'ı. Bu kural yazılıdır çünkü bir kez ihlal edildi ve ajanın açtığı branch, pencerenin kendi kaydı sırasında sessizce silindi. **Mevcut node türlerini, anlamlarını, komutlarını, parametrelerini, çıkışlarını ve kullanıcının kurduğu akışları talep edilmeden değiştirme.** Yeni node türleri, birleştirilmiş node’lar veya şema değişiklikleri bu belgenin verdiği bir görev değildir. Amaç mevcut yapıyı güvenilir çalıştırmaktır. Kullanıcı ileride açıkça bir şema değişikliği isterse eski akışların korunması ve migration ayrıca ele alınır.

Ürünün Windows XP / 2000–2001 görsel kimliği bilinçli tercihtir. Teknik düzeltme bahanesiyle arayüzü genel bir modern dashboard’a dönüştürme.

## 14. Bilinen sorunlar ve düzeltme durumu

Paylaşılan loglar özellikle Windows Çalıştır penceresi ve FolderBatcher alanlarında odak/yazma sorunları gösteriyordu. Bu loglar Hunyuan–Blender zincirinin saatlerce başarıyla çalıştığını kanıtlamıyordu.

Bu konuşmada 1.7.85 kaynağı üzerinde odak, alan seçimi ve yanlış başarı değerlendirmesi için yerel bir düzeltme hazırlandı. Bu düzeltme artık repoda: `c20039c` (main geçmişinde) ve `origin/fix/input-focus-and-confirmation` dalı GitHub'da. Repoyu yeni klonlayan ajan bu değişiklikleri hazır bulur; yukarıdaki “gönderilmedi” notu geçersizdir.

Düzeltme; seçilen alanın kimliğini koruma, adayları öndeki pencereyle sınırlama, native Edit odağını kullanma, etiket–alan ilişkisi, tek Enter, tam değer kontrolü ve gereksiz yazma taramalarını azaltma konularını ele alır. Yedi ajan regresyon testi, taklit UIA ile gerçek worker fonksiyonlarının kontrolleri ve build geçti. Gerçek Windows/Blender/Hunyuan oturumunda uçtan uca doğrulama yapılmadı.

Bu durum ürünün bütün hatalarının çözüldüğü anlamına gelmez. Önce mevcut checkout’u ve patch durumunu doğrula; ardından tekrar üretilebilen soruna odaklan.

## 15. Geliştirme ajanından beklenen çalışma

1. Önce gerçek kullanıcı akışını, node şemasını, runner’ı ve ilgili logları oku. Yalnızca isimlere veya README iddialarına güvenme.
2. Sorunu somutlaştır: hangi node, hangi tur, hangi pencere, hangi hedef, hangi yanlış eylem?
3. Hedef seçimi, algılama, odak, eylem gönderimi, bekleme ve döngü durumunu birbirinden ayırarak incele.
4. Sorunu genel altyapıda çözebiliyorsan kullanıcının akışına yeni doğrulama node’ları ekleyerek telafi etme. Gereken güvenlik kontrolünü kaldırarak da sorunu gizleme.
5. Değişikliği anlaşılır tut. Her arıza için yeni servis, EXE, bağımlılık veya paralel yürütücü ekleme.
6. Mevcut node’ları, akışları, ayarları, paketleri ve model seçeneklerini koru. Hata düzeltmelerini mevcut komutun amaçlanan işini doğru yapmasıyla sınırla. Talep edilmemiş node değişiklikleri, akışı kısaltma çalışmaları ve geniş refactor’lar yapma. Geliştirme ajanı ürünün kapsamını kendi kararıyla yeniden tasarlamamalıdır.
7. Hatanın geri dönmesini yakalayan anlamlı test veya yeniden üretme senaryosu kullan. Mock testi ile gerçek uygulama testinin kapsamını ayrı bildir.
8. Sonucu kullanıcı dilinde anlat: ne bozuluyordu, artık ne yapıyor, nasıl sınandı, hangi kısım henüz doğrulanmadı?

Karar verirken şu soruyu sor:

> “Bu değişiklik, mevcut node’ları ve akışları koruyarak komutların daha güvenilir çalışmasını sağlıyor mu? Kullanıcı aynı basit talimatları verebiliyor mu? Hız veya kısalık uğruna yeni bir risk getiriyor mu?”

## 16. Başarının ölçülmesi

Hedef, yalnızca derlenen kod veya etkileyici bir demo değildir. Gerçek kabul ölçütleri şunlardır:

- Kullanıcı, işin gerektirdiği sayıda mevcut node’u basit komutlarla kurabilir. Node sayısı az olduğu için akışa daha yüksek başarı puanı verilmez.
- Mevcut node’ların anlamları ve akışların davranışı korunur; hız veya sadelik adına güvenilirlikten ödün verilmez.
- Aynı akış ilk turla birlikte sonraki turlarda da doğru dosya, alan, pencere ve hesap üzerinde çalışır.
- Geciken işlem, OCR belirsizliği, kısa ağ kesintisi ve pencere hareketi karşısında makul biçimde toparlanır veya açık bir nedenle durur.
- Çok sayıda tur ve saatler süren çalışmada model çağrısı, bellek tüketimi, gecikme ve hata oranı kontrol altında kalır.
- Kullanıcı neyin tamamlandığını, neyin yarım kaldığını ve hangi dosyada durduğunu anlayabilir.
- Çözünürlük/DPI, uygulama sürümü ve addon arayüzü değişikliklerine dayanıklılık ilgili örneklerde ölçülür. Tamamen değişen her arayüze koşulsuz uyum garantisi verilmez.
- Bu işlevler tek Hunyuan–Blender akışına özel kalmaz; farklı web siteleri ve masaüstü uygulamalarında yeniden kullanılabilir.

Ölçüm için tamamlanan/başarısız/atlanan öğe sayısı, insan müdahalesi sayısı, yanlış veya tekrarlanan yan etkili eylemler, model çağrıları, işlem dışı bekleme süresi ve uzun çalıştırmadaki kaynak tüketimi kullanılabilir. Eşikler gerçek görevlerle belirlenmelidir; ölçülmeden “robust” denmemelidir.

## 17. Bilinçli kararlar

Bu bölüm, sahibinin denemeler sonunda verdiği kararları kaydeder. Burada yazan, bu belgenin başka yerlerindeki (özellikle §4 ve §16) “doğrulamayı geliştir, eşikleri ölç” yönündeki cümlelerle çelişirse **bu bölüm geçerlidir**. Aşağıdakileri “iyileştirmeye” çalışma.

- Sistem başarıyı yargılamaz; şüphede durmaz, tahmin etmez, açıkça raporlar.
- Ekran doğrulaması varsayılan olarak yalnızca-günlük modda çalışır. Eşik ayarı denendi ve sürekli sorun çıkardı, tekrar denenmesin.
- Hafızaya yalnızca gerçekten doğrulanmış hedefler yazılır; şüpheli hedefler yazılmaz.

**Kodun durumu (1.7.85 sonrası, dürüst not):** 1. ve 3. madde kodda uygulandı: akış hatalı öğe/tur içeriyorsa sonuç `ok: false` döner, kaldırılmış node türleri sessizce geçilmez, hafızaya yalnızca `confirm.ts` içindeki `proven` kanıtı olan hedefler yazılır. 2. madde **henüz uygulanmadı**: `ensureActed` (`electron/agent.ts`) hâlâ her eylemde iki ekran taraması yapıyor. Sonucu adımı başarısız saymıyor ve eylemi tekrar etmiyor, ama bekleme süresini, model çağrılarını ve hafıza yazımını etkiliyor. **Bu madde artık uygulandı (7 Ekim 2026):** "Kapalı / yalnızca-günlük / açık" seçeneği geldi (Ajan sekmesi · **Ekran doğrulaması**; varsayılan **yalnızca günlük**) — `electron/graph-types.ts` içinde `screenCheck` alanı ve `screenCheckMode()` yardımcısı, kararı `electron/agent.ts` içindeki `ensureActed` uygular: `off` eylemi sözüne güvenerek yapar (tarama yok, bekleme yok, model çağrısı yok), `log` bakar ve ne gördüğünü yazar ama adımı yargılamaz ve model çağırmaz, `on` yakından bakma ve plan sorma adımlarını da çalıştırır. "Bakman gereken" sonuç kategorisi de araç katmanında uygulandı: tepkisi doğrulanamayan adımlar sayılır ve `run.wait` ile `act.*` cevaplarında "bakılmalı" olarak bildirilir. Canlı ayrım ölçüldü: aynı tek tuş `log` modunda "gönderildi ama tepkisi net değil; bakılmalı", `off` modunda "yapıldı" olarak raporlandı. Eşik ayarı **denenmedi** (bu bölümün kararı).

## 18. Geliştirme döngüsü: Nubbo'yu Nubbo ile sınamak (dal: feat/test-profile)

Bu bölüm, ürünü geliştirirken kullanılan **kendi kendini denetleyen döngüyü** anlatır. Amaç, "araç cevap verdi" ile "iş gerçekten oldu"yu karıştırmamaktır.

**Ayrı örnek (şart).** `NUBBO_PROFILE=test` bir örneği **kendi klasörüne** koyar (akışlar, günlükler, jeton). Yalnız test profili kendi depo yolunu (`cwd`) alır; **gerçek profilin deposu yerinden oynamaz**. Jeton dosyası artık **uygulama sürümü + build damgası + profil** taşır; `nubbo where` "hangi örneğe bağlıyım"ı sürüm, build, jeton yaşı ve sağlıkla söyler.

**Tek komutla temiz örnek.**
- `node scripts/dev-seed-fixture.cjs test` → test profilini kapatır ve **sabit id'li fikstürü** yazar (`fixture-package` içinde `fixture-inner-type`, `fixture-inner-key`, `fixture-inner-wait`).
- `node scripts/dev-start-test.cjs test` → jetonun gösterdiği süreci **ağacıyla** kapatır → yeni exe'yi **kapatma sonrası** kopyalar → profil + build damgasıyla açar → `/health` yanıt verene kadar bekler. (Sıralama önemli: kopyalama kapatmadan önce yapılırsa eski build sınanır.)

**Senaryo + kanıt.**
`node scripts/dev-scenario.cjs scripts/scenarios/<ad>.json` → branch açar, düzenlemeleri yapar, `run.from` ile koşar, `run.wait` ile bekler ve **senaryodaki beklentilere** göre karar verir; `test-artifacts/<ad>-<zaman>/` altına senaryo, tüm kontroller, **motor günlüğü**, `run.report`, hata görüntüsü ve `evidence.md` bırakır. Dört sınıf ayrı tutulur:
`tool-answered` (kapı cevap verdi) · `input-sent` (motor yazdığı alanı geri okudu) · `observed` (adım/hata/resmî sonuç) · `completed` (diskte dosya, pencerede başlık). **Yalnız `completed` başarı sayılır.** Reddedilen bir çağrı kurulumu durdurur; beklentiler senaryodan gelir, koşucu onları asla yumuşatmaz.

**Araç katmanındaki yenilikler (bu dalda).**
- `flow.read` hangi **tuvalde** okuduğunu söyler (`tabName`, `tabs`) ve paketlerin içini `packagePath` ile listeler.
- **`flow.edit` artık paketin içini düzenleyebilir**: `packagePath: ["<paket node id>"]` verilirse işlemler o paketin **iç grafına** yazılır; grup bu hedefi hatırlar (`target`), `materialize`/`anchorsOf`/`describeBranch` aynı yolu izler. Alternatif yol (`path`) çıkarımı yalnız kök düzeyde çalışır; paket içi gruplar oraya karışmaz.
- `run.from { debug: true }` ilk hatalı adımda durur ve o anı dondurur; `run.report` node + paket yolu + kutu öğeleri + **son adımlar** + günlük + hata görüntüsü yolunu verir.
- `run.from { fast: true }` koşuyu ekran aşamalarında tutar (model çağrısı yok); `run.wait { timeoutMs }` koşu bitene kadar bekler ve resmî sonucu gözlenen adımlarla birlikte döndürür.
- `target.preview` hedef **aramayan** node'lar için (tuş/bekleme/bitir/kutu) "bulamadım" demez; ne yaptığını söyler.

**Kurallar.** Motor (runner/agent/worker) değiştirilmez; düzeltmeler araç ve arayüz katmanında yapılır. Kullanıcının gerçek akışı ve açık tuvali test için **değiştirilmez** — öneri dalı + geçici klasör kullanılır. Bir sürüm yeniden açıldığında **eski jeton kullanılmaz** (yukarıdaki başlatıcı bunu garanti eder). `main`'e otomatik merge **yok**; değişiklik dalda, kanıtıyla birlikte PR olarak bırakılır.

**Masaüstü güvenliği (şart).** Her koşu gerçek fareyi ve klavyeyi kullanır. Bu yüzden masaüstüne dokunan her komut **tek kapıdan** geçer: `node scripts/dev-safe.cjs -- <komut>`. Kapı, son girdiden bu yana geçen süreyi (`GetLastInputInfo`) ölçer ve insan son 60 saniyede bir şeye dokunduysa **koşuyu başlatmaz** (çıkış 4). Senaryo koşucusu da aynı denetimi kendi içinde yapar. Bu kural, bir koşunun kullanıcının odağını ve tıklamasını çalmasından sonra eklendi; `--yes` yalnız insan açıkça istediğinde kullanılır.

**Tek ekranda durum.** `node scripts/dev-status.cjs [profil]` — dal/sha ve **kirli ağaç** uyarısı, main'e göre kaç commit, uç noktanın port/pid/sürüm/**build damgası** (ölü jeton ve damga uyuşmazlığı ayrıca uyarılır), ekranın boş olup olmadığı ve son beş senaryonun kararı. Build damgası artık **kirli ağacı** da söyler (`<sha>-dirty`), çünkü "abc1234" damgalı ama commit edilmemiş bir ağaçtan derlenen exe kanıtı yanıltıyordu.



