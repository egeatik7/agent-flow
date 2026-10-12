# Kütüphane kimliği, oturum kaydı ve toplu işlemler — devam defteri

Kullanıcı: en fazla 25 dakikalık parçalarla ilerle; sonraki parça için kullanıcı devam yazacak. Temiz ve geriye uyumlu değişiklik; önceki Koşul/panel ve bug düzeltmeleri korunacak.
Başlangıç commit: 4df4496 (Koşul/panel + son dört bulgu kapatılmış).
Dal: fix/library-manager-part-1. Kaynak sürümü ara parçada 1.9.93.

## Kodda doğrulanan nedenler
- Kayıtlı tuvallerin zaten SavedCanvas.id kimliği, açık sekmelerin ayrı CanvasTab.id kimliği ve savedId bağlantısı var. Sorun kimliğin hiç olmaması değil; kimliği taşıma ve çakışma sözleşmesinin bütün yollarda korunmaması.
- App exportGraph ve kütüphanedeki onExportCanvas yalnız graph nodes/edges dışa aktarır. importGraph her seferinde yeni sekme + saveCanvas(newId) yapar. Dolayısıyla dışarı giden/geri gelen aynı tuvalin kimliği kaybolur.
- exportAutomation v2 dosyası tuval ID'lerini taşır ama importAutomation kimliği korumaz: aynı ad+aynı graph bulursa reuse, değilse yeni ID üretir. Aynı ID/farklı içerik çakışması yakalanmaz.
- normalizeSavedCanvases tekrarlı ID görünce sessizce yeni ID verir. Modern kimlikli dosyalarda çakışma gizlenmemeli; legacy eksik ID göçünü ayrı tutmak gerekecek.
- persistBook, api.saveCanvases'in {conflict:true} yanıtını session yazıldı diye true sayıyordu. Explicit saveLibraryChange başarı mesajı verip uygulanmamış katalog değişikliğini UI'da kabul edebiliyordu.
- Marquee/Ctrl/Shift seçimi LibraryTree'de var; CanvasLibrary Sil menüsü sadece menu.item.id kullanıyordu ve Delete tuşunun toplu işlem çağrısı yoktu.

## Parça 1 — tamamlandı
- Yeni electron/library-delete.ts seçim planını oluşturur ve tüm seçimi tek saf katalog mutasyonunda siler. Seçilen klasörlerin alt ağacı genişletilir; çakışan seçimler bir kez sayılır.
- Silinen tuvallerin otomasyon linkleri temizlenir. Açık sekmeler korunup kayıt bağından ayrılır; içerikleri taslak kalır. Kalan kayıtlar, araç/branch verileri ve otomasyon editör taslakları korunur.
- Silme onayında sayı gösterilir. Onay sırasında silinecek kayıtlar/klasör içeriği değişmişse plan yenilenmeden silinmez.
- UI'da çoklu seçim için Seçilenleri Sil, üst seçim düğmesi ve Delete tuşu aynı batch callback'ini çağırır. Seçilmiş öğeye sağ tık çoklu seçimi korur; çoklu seçimde tek-tuval Sil menüsü gizlenir.
- İşlem başarısız/iptal ise seçim korunur. Input/textarea içinde Delete dosya silme yoluna gitmez.
- Explicit kütüphane değişiklikleri ve kapanıştaki kabul edilmiş tuval Save artık persistBook(requireCatalog=true) ister. Katalog conflict yanıtı false döner; başarı mesajı/adoptBook çalışmaz. Otomatik draft oturum kaydı varsayılan yolunu korur.

## Doğrulama
- 801 Vitest geçti; 6 mevcut test atlandı; 108 dosya; 0 hata.
- Typecheck, build:electron ve git diff --check başarılı.
- Testler: marquee → Delete tek batch; çoklu sağ tık tek batch; failed delete seçim korunması; tüm seçim/link silme; klasör alt ağacı/dedup; onayda değişen plan; gerçek App'te disk conflict sonrası kaydın UI'da kalması; batch silme bir disk yazımı; sonradan session autosave ve yeniden açılış silinmiş tuvalleri yeniden yayınlamaz.
- Linux/React/mock desktop ortamı. Canlı Windows dosya yöneticisi/görsel arayüz/EXE testi yapılmadı. Ara paket teslim edilmedi.

## Sonraki parça — kimlikli dosya ve sürüm çakışması
1. Yeni kimlikli tuval dosyası/export-import sözleşmesi tasarla. Eski düz nodes/edges JSON'ları çalışmaya devam etmeli. Dışa/içe aktarımda aynı ID korunmalı; farklı kayıt istenirse explicit yeni ID (Farklı Kaydet / kopya olarak aktar).
2. Aynı kimlik+aynı içerik tekrar import edilince sessiz çoğaltma değil mevcut kaydı açma/reuse; aynı kimlik+farklı içerik çakışma ekranı ve Farklı Kaydet. Kullanıcı açıkça mevcut kaydı güncelle demeden overwrite yok.
3. Canvas revision/baseline ile sürüm kontrolünü save/open/reload/rename/duplicate/automation yollarında tutarlı hale getir. savedId'si olan ama katalog kaydı kaybolmuş sekmenin normal Save ile kendiliğinden yeniden yayınlanmasını incele.
4. importAutomation v2 kimlik çakışması/dedup yolunu düzelt. Kimliksiz legacy dosyalar için geriye uyumluluğu koru.
5. normalizeSavedCanvases'in duplicate ID'yi sessiz re-ID etmesi ile legacy göçü ayrı ele alınmalı. Aynı isim tek başına aynı tuval değildir; aynı ID farklı içerik çakışmadır.
6. Otomatik session yazımlarının katalog sahipliği ve startup/recovery/last-open akışlarını daha kapsamlı incele; taslak autosave ile explicit library Save farklı işlemler olmalı. Bu parçada API katmanına yeni session-only writer protokolü eklenmedi.
7. Kaydedilmemiş otomasyon taslağı tree'de sentetik satırdır; stored-item toplu silme planına katılırsa 'kayıt yok' döner. Mevcut Vazgeç yolu çalışır; karma stored+unsaved seçim için davranışı sonraki UI turunda netleştir. Tuval toplu silme tamamlandı.
8. Arşiv/klasör taşıma/yeniden adlandırma, multi export/duplicate beklentilerini son UI turunda incele. İlk parça sadece deletion ve acknowledgment düzeltmesidir; kütüphane bütünü bitti sayılmadı.

## Blender araştırması
Resmî referanslar:
- https://developer.blender.org/docs/features/asset_system/backend/asset_catalogs/
- https://docs.blender.org/manual/en/4.0/files/asset_libraries/catalogs.html
Blender katalog kimliğini UUID ile ad/yoldan bağımsız tutar ve katalog kaydını .blend dosya kaydından ayırır. Buradaki UUID katalog kimliğidir; bunu tuval/asset UUID'si sanıp birebir kopyalama. Nubbo için çıkarım: ad/klasör kimlik değildir, açık çalışma ve katalog kaydı ayrı sahiplik taşır. Latest manual fetch erişim hatası verdi; resmî developer dokümanı ve manuelin arama sonucu kullanıldı.

## Parça 2 — kimlikli aktarım ve tuval sürümü çakışması tamamlandı
- Yeni tuval JSON'u format=nubbo-canvas/version=1/canvasId/name taşır; nodes ve edges üst seviyede kaldığı için eski akış okuyucuları bunu yine okuyabilir. Kimliksiz eski JSON'lar yeni belge kimliği alır.
- Açık çalışma tabı artık optional canvasId taşır; yeni tab, normal Save, açma, session/recovery normalizasyonu ve Farklı Kaydet bu kimliği korur/explicit yeniler. Sekme ID'si ve kayıt ID'si ayrı rollerdir.
- Dışa aktarma hem menüde aktif tuvali hem kütüphanedeki kayıtlı tuvali gerçek belge kimliğiyle yazar.
- Aynı kimlik+aynı içerik+aynı ad tekrar import edilince katalog kaydı çoğalmaz; temiz açık sekme varsa o aktive edilir. Kirli açık kopya bozulmadan ayrı çalışma tabı açılır.
- Aynı kimlik+farklı içerik/ad CanvasIdentityConflictError üretir. Gerçek uygulamada çakışma penceresi Farklı Kaydet / Mevcut Tuvali Aç / İptal sunar. Dosya kopyası seçilirse ad penceresi açılır, yeni kimlikli kayıt oluşur; eski kayıt güncellenmez. Diyalog keyboard focus/Tab/Escape destekler.
- Otomasyon v2 import artık tuval kimliklerini korur; aynı ID farklı sürüm varsa bütün işlem atomik çakışır. Farklı Kaydet yolunda sadece çakışan tuvaller yeni ID alır ve otomasyon bağlantıları bu kopyalara gider. Otomasyon v1 kimliksiz legacy göçünü korur.
- Modern schemaVersion=2 katalogda duplicate/missing canvas ID sessiz re-ID edilmez; açık hata verilir. Kimliksiz eski kütüphane göçü ve legacy bozuk duplicate-onarma yolu ayrı kalır. Mevcut bir legacy test buna göre sınırlandırıldı.
- Kayıtlı kimliği olan ama reload sonrasında katalog kaydı kaybolan tab normal Save ile sessizce yeniden yayınlanmaz; Farklı Kaydet gerekir.
- Kütüphane satırlarının tooltip'i tuval kimliğini gösterir.

### Parça 2 doğrulaması
815 Vitest başarılı, 6 mevcut test atlandı, 109 dosya. Typecheck/build:electron/git diff --check başarılı. Dosya roundtrip, farklı ID aynı ad, aynı ID farklı sürüm, unsaved export ardından Save, Save As, dirty tab koruma, automation v2 kimlik/fork, modern duplicate/missing ID ve gerçek App conflict Cancel/SaveAs yolları test edildi. Canlı Windows/EXE/görsel QA yapılmadı.

## Sonraki parça — oturum sahipliği ve son kütüphane taraması
- Önceki Sonraki parça listesinin kimlikli tuval/automation aktarım ve modern duplicate ID maddeleri kapandı. Kalan ana kapsam: draft autosave/session-only ile catalog explicit-write ayrımını main.ts / workspace-store / library-storage / App'te incele ve netleştir.
- savedId silinme, açık sekmede eski graph, reload, restart/recovery ve explicit Save/SaveAs yollarını tarayıp kalan kimlik bağlantılarını doğrula. İçerik/baseline karşılaştırması sürüm çakışmasını yakalıyor; ayrı numeric revision alanı bu parçada eklenmedi.
- Otomasyonun kendi dosya kimliği halen export formatında yok; otomasyon dosyası tekrar import edilince yeni otomasyon kaydı oluşur. Tuval kimlikleri korunur. Kullanıcının ana kimlik isteği tuvallerdir; grup kimliğinin genişletilmesini gerekirse son turda değerlendir.
- Sentetik kaydedilmemiş otomasyon satırının batch deletion ile davranışı, arşiv/taşıma/rename dahil son UI taraması ve kütüphane save-status mesajları açık.
- Tam doğrulama ve tek son paket bu son turun sonunda. Ara ZIP teslim edilmedi. Önceki Koşul/panel patch'leri bu branch'in tabanında korunuyor.

## Parça 3 — oturum sahipliği ve son yönetici düzeltmeleri tamamlandı
- IPC/preload saveCanvases için geriye uyumlu catalog seçeneği eklendi. Eski çağrılar explicit window/catalog yazımı yapar; App'in otomatik draft/sekme/startup kayıtları catalog:false gönderir. tools yazıcısı sadece araç branch'lerini yazar. Session/tool yolları LibraryStorage.save çağırmaz.
- workspace-store session modunda renderer'ın taşıdığı katalog yok sayılıp main'in mevcut kataloğu kullanılır. Katalog yoksa boş schemaVersion=2 enjekte edilir; açık sekmeler yeniden legacy kayıt sanılıp katalogda çoğaltılmaz.
- Kütüphane kaydı disk conflict veya IO hatasıyla reddedildiğinde unpublishedCatalogSession önceki başarılı baseline/savedId/automation expected bilgisini korur, yeni kayıt girişimlerini unsaved draft bırakır. Session yine kaydedilir; conflict çağırana bildirilir veya gerçek IO hatası yeniden fırlatılır. Viewer da reddedilmiş katalog kopyasını görmez.
- Sadece tuval açmak, draft restore/discard ve tab düzenlemek de session-only yoldadır. Explicit Save, Save As, import, deletion, archive, rename ve folder move katalog kaydı ister. Otomatik session başarısı katalog conflict bilgisini yanlışlıkla sıfırlamaz.
- Sentetik kaydedilmemiş otomasyon satırı toplu seçimden ayrı draft kimliğiyle taşınır; kayıtlı seçilmiş öğeler ve seçilmiş taslak aynı tek onay/yazımla silinebilir. Yalnız draft silme katalog yayını gerektirmez.
- Bölümsüz legacy karma klasörler iki görünümde de görünür; ağaç hiyerarşisi kaybolmaz.
- Klasör taşıma aynı adlı ikinci sibling oluşturamaz. Türü uyuşmayan bölüm taşıması içeriği görünmez bir bölüme retag etmez. Boş alt ağaç başka bölüme taşınırsa bütün alt klasörlerin section bilgisi güncellenir. Kendi altına taşıma öncelikle cycle olarak reddedilir.

### Son doğrulama
826 Vitest geçti / 6 mevcut test atlandı / 109 dosya; 98 Node regresyonu geçti / 21 mevcut test atlandı. Typecheck, build:electron ve git diff --check başarılı.
Gerçek main.ts callback'leriyle session-only/tool yazımlarının kataloğu çağırmaması, dış revision rejection ve disk IO failure sonrasında draft recovery korunması test edildi. App'in startup/autosave/explicit Save modları, karma draft deletion, legacy folder görünürlüğü ve folder taşıma çakışmaları da doğrulandı.

### Tamamlanan kullanıcı kapsamı
Toplu seçme/silme; kimlikli tuval export/import; aynı kimlik farklı içerik için çakışma + Farklı Kaydet; kimliksiz eski JSON uyumu; otomatik session kayıtlarının katalogdan ayrılması; reddedilen kütüphane kaydında taslakların kaybolmaması ve ilgili yönetici regressions tamamlandı.
Ara patch'ler tek final pakette birleştirilecek; önceki Koşul/panel düzeltmeleri tabanda korunuyor. Kaynak sürümü 1.9.93 kaldı; bu kaynak checkpoint'idir.

### Sınırlar
Canlı Windows/PowerShell/UIA/OCR/EXE testi ve Chromium ile görsel QA yapılamadı. React render/DOM ve Linux/Node testleri yapıldı. EXE paketi yok.
Modern katalogda zaten bozuk/tekrarlı tuval kimliği varsa hata görünür; otomatik ID değiştirme/onarım yapılmaz. Mevcut kayıt korunur. Sayısal per-canvas revision şeması eklenmedi; aynı kimlikte sürüm ayrımı içerik/ad + başarılı save baseline ile yapılır, dosya/katalog eşzamanlılığı mevcut storage revision/lock ile korunur.
Otomasyon dosyasının grubunun kendisi klasik davranışla yeni grup kaydı olarak import edilir; içindeki tuval ID'leri korunur. Tuval kimliği görevi tamamlandı; ayrı otomasyon-belge kimliği bu kapsamda eklenmedi.
Önceki geniş 1.9.93 audit listesinin bu taleple ilgisiz diğer maddeleri tamamlandı sayılmadı.
