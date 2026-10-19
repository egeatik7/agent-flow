# Bug taraması — Nubbo Agent Studio 1.9.161

Tarih: 20 Ekim 2026 · Depo: `agent-flow/agent-flow` · Dal: `main` (`bbfb42a`)

> **Anlık görüntü notu.** Tarama `1.9.159` + `14e39aa` (checkpoint patch'i) üzerinde başladı; tarama sürerken `1.9.160` (`63a78dc`) ve `1.9.161` (`bbfb42a`) geldi. Kritik/yüksek bulguların satır numaraları `1.9.161` üzerinde yeniden doğrulandı; `runner.ts` bu arada 822 → 866 satıra çıktı, `checkpoints.ts` değişmedi. Hiçbir ürün dosyası değiştirilmedi; bu belge tek istisnadır (commit edilmedi).

## 0. Kapsam ve ölçüm

- **40 ajan**: 14 alan keşfi + 14 bağımsız çürütme doğrulaması + 6 sistem-geneli uzman (durdurma, döngü, sessiz hata, güvenlik, durum yarışları, renderer) + doğrulamaları. Ayrıca hiçbir alana girmeyen **checkpoint** özelliği için 2 ek denetim.
- **68 ham bulgu** → **66 korundu**, 2 çürütüldü, 1 belirsiz. Doğrulanmış dağılım: 1 kritik, 15 yüksek, 31 orta, 19 düşük.
- Alan dağılımı: tools 5 · storage 5 · agent 5 · branch 4 · renderer-app 4 · renderer-ui 4 · x-stop 4 · x-swallow 4 · worker 3 · model 3 · main 3 · targeting 3 · screen 3 · recovery 3 · x-state 3 · x-renderer 3 · runner 2 · bridge 2 · x-loop 2 · x-security 1.
- **Ölçüm (temiz HEAD):** `npm run typecheck` 3 proje ✅ · `npx vitest run` **183 dosya / 1401 test ✅** · `test:keys`, `test:input`, `test:recovery`, `test:targeting`, `test:lock` ✅.
- **Kapı kırmızı:** `npm run test:stability` **3 test ölü** (`checkpoints is not defined`) — ayrıntı §5.

Şiddet ölçütü: **kritik** = yanlış hedefe geri alınamaz yan etki / saatlerce koşunun sessizce çökmesi / koşunun hiç bitmemesi; **yüksek** = belirgin yanlış davranış veya veri kaybı; **orta** = koşula bağlı hata; **düşük** = kozmetik/kenar durum.

## 1. Yönetici özeti

1. **Koşu hiç bitmiyor:** eylem türü olmayan bir node (boş Koşul, eski `browser/waitFile/moveFile`, Paket içinden sızan hata) ölümcül olmayan hata verirse `repeatMethodCycle` **sınırsız** dönüyor; 3 sn'de bir yeniden deneme, `maxSteps` devreye girmiyor, hata sayılmıyor. Paket içinde bu, **tamamlanmış tıklama/yazmaların 3 sn'de bir yeniden oynatılması** demek.
2. **Checkpoint yazımı otomasyonu öldürüyor:** her öğede yazılan checkpoint dosyası `EPERM/ENOSPC` alırsa koşu iptal olur (ve iç içe döngüde kalan öğeler sessizce atlanır). Aynı `rename` sınıfı depoda ölçülmüş: ZIP kilidi 20 koşuda 3–6 kez EPERM veriyor.
3. **Yazı yanlış alana gidebiliyor:** tıklanan etiket → komşu alan çözümü üretimde **ölü kod**; Ctrl+A'yı yok sayan klasik Edit'lerde temizleme geri düşüşü de ölü. İkisi de `writeSent:true` / `cleared:true` dönüp başarı sayılıyor.
4. **Hedef doğruluğunda iki sessiz kaçak:** görsel onaylı tıklamada worker'ın "pencere değişti" uyarısı yutuluyor; `alt+f4`/`ctrl+w`/`shift+delete` koruması (`key-guard.ts`) hiçbir üretim kodundan çağrılmıyor.
5. **Devam (resume) ana senaryoda kırık:** klasörden okunan döngüde hatadan devam, kayıtlı boş listeyle koşu-anı listesini karşılaştırıp "Liste değişmiş" diye reddediyor.
6. **Disk sınırsız büyüyor:** checkpoint geçmişi (öğe başına 2 dosya, tam graf klonu) ve `send-log` tanılama klasörleri (ölçülen 2169 klasör / ~210 MB) hiç budanmıyor.

## 2. KRİTİK

### K1 — Eylem dışı node hatası sonsuz yeniden denemeye düşüyor; Paket içi eylemler tekrar oynatılıyor
`electron/runner.ts:441-493` (kanıt: `483`, `487`, `490`, `491`), `electron/method-cycle.ts:8`

`persistentStep` kurtarma yönlendirmesini yalnız `['click','type','key','wait','ai']` için yapıyor; diğer her türde hatayı olduğu gibi `throw` ediyor (`:487`). `repeatMethodCycle` **sayaçsız** (`for (let round = 1; ; round++)`) ve `terminal: isFatal`; `isFatal` bu hataları kapsamıyor. Sonuç:

- **Boş Koşul** (`:388`), `conditionCompatibilityError` (`:386`), **"Bu node türü artık desteklenmiyor"** (`:412`) ve **Paket iç grafından sızan** terminal olmayan hata: 3 sn'de bir sonsuz retry.
- Adım `error` olayı hiç gönderilmiyor, `budget.used` artmadığı için `maxSteps` / `LapLimit` **hiç devreye girmiyor**, `runGraph` dönmüyor, `main` `running` bayrağını bırakmıyor → sonraki koşular "Ajan zaten çalışıyor."
- Paket yolunda `runGraph(inner)` her turda **baştan** çalışıyor: paketteki Tıkla/Yazı Yaz yeniden gönderiliyor ("Oluştur"a 3 sn'de bir tıklama) — §8'in "yan etkili eylemi körlemesine tekrarla" yasağı.
- Günlüğe saatte ~1200 satır; `Ctrl+Shift+Q` ile durdurulursa sonuç "0 hata" görünüyor.

**Düzeltme:** eylem dışı türlerde `repeatMethodCycle`'ı hiç kullanma ya da `terminal`'a yeni bir "kalıcı hata" sınıfı ekle; Paket için iç graftan çıkan hatayı yeniden oynatmadan yukarı fırlat (veya `afterNodeId` ile kaldığı iç adımdan sürdür). `tests/runner-loop.test.ts:58-68` bu yolu **debug** koluyla sınadığı için normal koşuda hiç yakalamıyor.

## 3. YÜKSEK

### A. Girdi ve hedef doğruluğu

**H1 — Tıklanan etiket → alan çözümü üretimde çalışmıyor** · `a11y/worker.ps1:1201-1204` (ölü kalan çözüm: `:1271-1285`, `:607-617`)
Köprü her zaman `keyboard: true` yolluyor (`a11y-bridge.ts:595`) ve `inputGuardFor` (`input-policy.ts:55`) hiçbir yerden çağrılmıyor. Klavye dalı `$P.x/$P.y/$P.fieldToken`'ı **hiç okumuyor**; etiket→komşu Edit eşlemesi (`Get-TypeChoices`/`Find-FieldLabel`/`Focus-Input`) yalnız erişilemez dalda. FolderBatcher gibi klasik formlarda "Kaynak klasör" başlığına tıklanıyor, Static'e tıklamak odağı komşu Edit'e taşımıyor → metin **odakta kalan başka alana** gidiyor, `writeSent:true` ile başarı sayılıyor. §8'in açık kuralı ihlal.

**H2 — Ctrl+A'yı yok sayan klasik Edit'lerde temizleme geri düşüşü ölü** · `a11y/worker.ps1:1215-1223` (geri düşüş `:1295`/`:1358-1371` erişilemez)
`^a → {DEL} → cleared=true` hiç okuma/doğrulama yapmıyor; `EM_SETSEL` geri düşüşü yalnız guard'lı dalda. Kutu eski metni koruyor, yeni yol üstüne ekleniyor (`C:\ResimlerC:\Other\images`), uygulama yanlış klasörü işliyor. `7a76005` bu hatayı tam bu dosyada düzeltmişti; `09f0624` (8 Ekim) köprüyü `keyboard:true`'ya çevirince düzeltme yeni dala taşınmadı. Testler yeşil çünkü mock `^a`'yı yok sayıp `{DEL}`'de tüm metni siliyor.

**H3 — `clickCurrentAt` worker uyarısını yutuyor** · `electron/a11y-bridge.ts:520-522`
Worker artık "pencere değişti / nokta örtülü" durumunda **tıklar ve uyarı döndürür** (`worker.ps1:1105-1120`); köprü `Promise<void>` ilan edip sonucu atıyor, doc yorumu hâlâ "TIKLAMAZ". Tek çağıran `agent.ts:1214` uyarıyı loglamıyor (kardeş yollar `clickAt`/`moveMouse` logluyor). Görsel onaylı tıklamada onay karesi ile tıklama arasında pencere değişirse yanlış pencereye tıklanır ve tek kanıt günlükte yoktur.

**H4 — Modelin kapatma/silme tuşu koruması hiç bağlı değil** · `electron/key-guard.ts:49-56`
`assertModelKeysAllowed` repoda **hiçbir yerden** import edilmiyor (yalnız test). İnisiyatif/Yap modeli `alt+f4`, `ctrl+w`, `ctrl+q`, `shift+delete` seçebiliyor: hedef uygulama kapanıp saatlik kaydedilmemiş iş gidebilir veya seçili öğe kalıcı silinebilir. Yorum "the model may not press" diyor; niyet var, çağrı yok.

**H5 — Koşul'da `ConditionUndecidedError` döngü içinde yutuluyor** · `electron/agent.ts:1540-1546`
Hata `repeatMethodCycle`'ın attempt'i içinde fırlatılıyor ama `terminal` verilmiyor → 3 sn'de bir sonsuz retry. `runner.ts:391-397`'deki 1.9.154 "karar verilemedi → kurtarma" yolu **ölü kod**; `exists` hiç `undefined` döndürmüyor. Okuyucu kalıcı hata verdiğinde (OCR/worker/model) Koşul node'u saatlerce kilitleniyor, "hayır" dalı hiç alınmıyor. `tests/condition-recovery.test.ts` sahte executor hatayı doğrudan fırlattığı için yeşil.

**H6 — `ensureActed`'ın önce/sonra taramaları korumasız** · `electron/agent.ts:1049-1054`
`log` modunda tıklama **öncesi** tarama hata verirse tıklama hiç gönderilmiyor (eylemden önce engel — §19); **sonrası** tarama hatası ise başarılı tıklamayı `haltLoop`'lu "girdi gönderilmiş olabilir" hatasına çevirip döngüyü durduruyor.

**H7 — Paket içi ayarlarda "Ekrandan Seç"/"İmleçle Yakala" dış paket node'una yazıyor** · `src/components/SidePanel.tsx:531-539`
`NodeFields`'e yalnız `onUpdateNode` override edilmiş; `TargetBox` hâlâ dış `onOpenScanner`/`onCaptureForNode` prop'larını çağırıyor (`App.tsx:1829-1830`). İç node hedefsiz kalıyor, kök düzeyde fazladan Tıkla node'u ekleniyor veya paket node'una sahte locator yazılıp günlüğe "bağlandı" düşüyor.

**H8 — Hatadan devam, klasörden okunan döngüde yanlış reddediliyor** · `electron/tools.ts:1242-1249`
`contextOf(...).loops` koşu-anı listesini döndürüyor; kayıtlı `box.item` ile karşılaştırma, `Klasör={{öğe}}` ile doldurulan kutuda "Liste değişmiş: … artık ''" diyerek **ana senaryoda aynı öğeden devamı imkânsız** kılıyor.

### B. Koşu ve rapor bütünlüğü

**H9 — `run.from` koşu başlamadığında da "Koşu başladı" diyor** · `electron/tools.ts:1276-1302`
Yapı ön kontrolü reddi yalnız günlüğe gidiyor; araç `ok:true, started:true, sent:true` dönüyor. Ajan `run.wait` çağırıp **önceki koşunun sonucunu** bu koşunun sonucu sanıyor; `setStopAt` kalıntısı sonraki cevaplara sahte "sınırlı bölge tamamlanmadı" notu ekliyor.

**H10 — Durdurulan koşunun sayaçları kayboluyor** · `electron/main.ts:1225-1228`
`StoppedError` dalı hazır `tally`'yi atıp `{ok:false, stopped:true}` dönüyor: 210 adım koşup durdurulan iş "0 adım · hatalı öğe yok" görünüyor, aynı cevabın üstünde "Gözlenen adımlar: 412 tamam" yazıyor. §16'nın "ne tamamlandı, ne yarım kaldı" ölçütü.

**H11 — Merge zaman aşımı "hiçbir şey yazılmadı" diye kesin raporlanıyor** · `electron/tools.ts:719-723`
Belirsizlik regex'i gerçek 20 sn metnini ("Pencere uygulamayı onaylamadı; tuval değiştirilmedi." — `main.ts:468`) yakalamıyor. Pencere grafiği **kayıttan önce** belleğe uyguladığı için (`App.tsx:725-731`) tuval değişmiş olabilir; tarif silinmiyor → ikinci merge aynı op'ları `nb<grup>-1-1` id'leriyle **ikinci kez** yazıyor. `tests/review-fixes.test.ts:93-104` sahte metin enjekte ettiği için gerçek yolu sınamıyor.

### C. Depolama, kaynak ve performans

**H12 — Checkpoint geçmişi sınırsız** · `electron/checkpoints.ts:63-85`
Her döngü öğesinde yeni UUID'li **iki** dosya (biri tam graf `structuredClone`'u) yazılıyor; silen tek satır yok (`unlink|rm` yok), `.tmp` artıkları da kalıcı. 500 öğelik koşu ≈ 501 snapshot + 501 detail; graf G bayt ise koşu başına ≈ 501·G.

**H13 — Checkpoint: 500 ms'de tam dosya yeniden yazımı + kırılgan `list()`** · `checkpoints.ts:38`, `:83`, `:104-116`
Her flush, o an büyümüş tüm `outputs` dizisini yeniden yazar (O(n²) bayt), `list()` her 2 sn'de **tüm** dosyaları outputs'larıyla parse edip atar, `detail()` çıktı başına `access()` yapar. Tek bozuk/kilitli dosya `JSON.parse`'ta patlayıp **tüm listeyi** düşürüyor; panel "Çıktılar yükleniyor…"da asılı kalıyor, `Promise.all` yüzünden monitoring de donuyor.

**H14 — Kütüphane kilidi kendi kendini kilitleyebiliyor** · `electron/library-lock.ts:166-172` (`removeOwned` `:76`)
`releaseHeld` kaydı `held`'den silip sonra `unlinkSync` yapıyor; unlink `EPERM/EBUSY` alırsa hata `withLibraryLock` finally'sinden dışarı çıkar ve kilit dosyası **kendi canlı PID'imizle** kalır. Sonraki her `load/save` → `EEXIST` → `mayRecover` → `live(own pid)` → "Kütüphane başka bir Nubbo tarafından kullanılıyor" — oturum boyunca kütüphaneye yazılamaz; `loadCanvases` hatayı yutup **boş kütüphane** gösterir.

**H15 — Boş/okunamayan kütüphane anlık görüntüsü sekmelerin `savedId`'sini siliyor** · `electron/zip-workspace.ts:39-43`
Geçici okuma hatası veya problemli grup, açık sekmelerin `savedId`+`baseline`'ını kalıcı silip diske yazıyor. Sonraki Kaydet, `main.ts:1592`'deki "kayıtlı tuval artık ZIP'te yok" kapısını atlayıp aynı `canvasId` ile **ikinci ZIP grubu** üretiyor; ikisi de "problem" işaretlenip kilitleniyor.

**H16 — Tanılama kanıt klasörleri sınırsız** · `electron/send-log.ts:203-222`
Her model isteği kalıcı bir klasör (tam ekran görüntüsü + öğe envanteri + prompt) bırakıyor; hiçbiri silinmiyor. Bu makinede ölçülen: **2169 klasör / ~210 MB** (günde ~220 klasör). Uzun koşuda disk dolar; ayrıca ekran görüntüsü + OCR metni süresiz saklanır.

**H17 — Alfa/32→24 bit kopya piksel başına PowerShell döngüsü** · `a11y/screen.ps1:183-186`, `:655-665`
1080p'de **tarama başına ~2,9 sn**, model karesi başına ~9,2 sn saf yorumlanmış piksel işi; yüzlerce turda adım süresini katlar ve bu süre boyunca Durdur işlemez.

**H18 — Kapanış kapısı 10 sn sonra pencereyi zorla kapatıyor** · `electron/main.ts:518-525`, `window-close.ts:2`
Arayüz "Kaydet/Kaydetme/Vazgeç" diyaloğunu açıp kullanıcıyı **süresiz** beklerken main'in 10 sn sayacı doluyor; `forceClose` pencereyi kapatıyor, "Kaydet" kararı uygulanmıyor, ZIP kopyası oluşmuyor, günlük yanlışlıkla "Kapanış onayı gelmedi" diyor.

**H19 — Yap giriş bütçesi bayt tahminini token penceresiyle karşılaştırıyor** · `electron/openrouter.ts:140-145`
`yapInputEstimate` **bayt** (araç JSON'u + görüntü başına 4096) döndürüyor, `window` **token**. ≤8192 pencereli yerel modelde istek hiç gönderilmiyor; `compact` denemeleri sabit araç şemasını düşürmediği için 3 tur sonra kurtarmaya devrediyor — yerel-only kullanıcıda kurtarma anahtarı olmadığından öğe başarısız.

**H20 — Çalışan portable örneğin `%TEMP%` klasörü 10 dk sonra "bayat" sayılıyor** · `electron/temp-sweep.ts:28-49`
`KORUMA_MS = 10 * 60_000`; başka bir örnek (test profili) açılışta bu klasörü silmeye çalışıyor — yarıda kalan silme **saatlerce süren koşuyu** düşürebilir.

## 4. ORTA / DÜŞÜK (özet)

| Şiddet | Yer | Bulgu |
| --- | --- | --- |
| orta | `main.ts:1085-1088` | Durdur kısayolu kaydı başarısızsa sessiz yutuluyor; pencere gizliyken koşu pratikte durdurulamaz |
| orta | `main.ts:1253` | Model kronometresi koşu bitince durmuyor; kart koşu sonrası canlı sayaç gösteriyor |
| orta | `main.ts:1077-1083` | Günlük açma hatası sessiz; `shotDir` boş kalınca hata görüntüleri de alınmıyor |
| orta | `main.ts:1729-1739` | `shell:showItem`/`openPath` IPC yol doğrulaması yok (mutlaklık/UNC/kök denetimi); `.exe` çalışır, `\\host\share` SMB bağlantısı kurar |
| orta | `tools.ts:1340`, `1376-1401` | `act.wait` 60 sn tavanıyla kesiliyor ve "hata" diye raporlanıyor |
| orta | `tools.ts:1429-1431` | Durdurulan eylem "durduruldu" değil "eylem-belirsiz" diyor; ajan körlemesine tekrar deneyebilir |
| orta | `tools.ts:918-922` | Her debug/sınırlı koşudan sonra kalan durdurma bayrağı `target.preview`'i bozuyor |
| orta | `tools.ts:1756-1766` | `run.stop` tek adım sürerken "koşu yok" diyor ama adımı iptal ediyor |
| orta | `tool-edit.ts:62` | Parmak izi motorun ürettiği `loop.items`'i belge değişikliği sayıyor → branch kalıcı "temel değişmiş" |
| orta | `canvas-session.ts:18-23` | Kurtarma taslakları aynı tuval için birikiyor (çökme sonrası sınırsız kopya) |
| orta | `zip-library-storage.ts:226-239` | 1.9.158 retry'si yalnız `publish`'teki rename'i kapsıyor; arşivle/yeniden adlandır/sil ham `link/unlink` |
| orta | `library-path.ts:37-38` | Yapılandırılmış yol korumalı-yol kapısını atlıyor; silinen klasör `mkdirSync` ile geri gelip UI donuyor |
| orta | `runner.ts:685-691` | Devam kimliği yinelenen öğede ilk satırı seçiyor (`keys.indexOf`) |
| orta | `runner.ts:891` | Bitir'e ulaşınca `summary.incomplete` düşüyor → `ok:true` / "tamamlandı" |
| orta | `memory-meter.ts:459-467` | Boş/timeout PowerShell çıktısı "taze boş ölçüm" sayılıyor; son geçerli örnek yok ediliyor |
| orta | `screen.ps1:979-983`, `:1010-1015` | Tıklama yolu imlecin hedefe vardığını doğrulamıyor; `ok:true` dönüyor |
| orta | `screen.ps1:909-926`, `:952-953` | `Get-IconCrop` dx/dy telafisi hesaplanıyor, hiç kullanılmıyor → kenar öğelerinde ≤110/70 px kayma |
| orta | `worker.ps1:1591-1598` | finally'daki klavye temizliği hata verirse tamamlanmış eylem `ok:false` düşüyor |
| orta | `openrouter.ts:1048/1087` | Gönderilmeyen aday numarası (400 satıra kırpılmış liste dışı) tam kümede doğrulanıp sunulmamış kelimeye tıklatıyor |
| orta | `openrouter.ts:1049-1052` | Görüntüsüz sessiz geri dönüş "marked görüntü cevabı" sayılıyor (`imageUsed:true` yazıyor) |
| orta | `agent.ts:217-228` | Durdur, hedef taraması sürerken etkisiz (sinyalsiz `bridge.scan`) |
| orta | `agent.ts:403-407` | İkinci bakış modeli numara vermezse bulunmuş yazı eşleşmesi atılıyor |
| orta | `agent.ts:1022-1026`, `:1412` | `screenCheck='off'` modunda doğrulanmamış hedef hafızaya yazılıyor (§17) |
| orta | `agent.ts:1255-1266` | `stampType` köprünün "gönderilmiş olabilir" bayraklarını siliyor → güvenli olmayan tekrar |
| orta | `App.tsx:705-731` | Merge hedefi beklemelerden sonra `activeIdRef`'ten çözülüyor; sekme değişirse yanlış tuvale yazar |
| orta | `graph-ops.ts:74-82` | Çıkışı olmayan tür (Bitir) araya eklenince sonraki bağlantı sessizce siliniyor |
| orta | `App.tsx:376-380` | Otomatik kayıt effect'i koşu sırasında da her ajan yamasında tüm defteri yazıyor |
| orta | `SidePanel.tsx:325` | Yap "Süre sınırı" alanı her tuşta 10–900'e kırpılıyor (120 → 900) |
| düşük | `App.tsx:1273` | "İmleçle Yakala" sayacı sürerken koşu başlatılabiliyor |
| düşük | `App.tsx:462-465` | `agent:graph` cevabı hata durumunda hiç gönderilmiyor |
| düşük | `SidePanel.tsx:171-178` | Döngü listesi satırları render'da O(n) tarama (binlerce öğede ~2n²) |
| düşük | `NodeCanvas.tsx:993-999` | Sağ tık menüsü/Shift+A paleti `scale()` içinde → zoom ile küçülüyor |
| düşük | `tool-state.ts:244-245` | Kutu dışı hata veren debug koşusunda görüntü hiç gelmiyor, rapor "henüz yazılmadı" diyor |
| düşük | `tool-edit.ts:435-443` | Aynı listedeki disconnect doğrulanıyor ama uygulanmıyor ("✂ kaldırıldı" der, ok durur) |
| düşük | `main.ts:750-790` | HUD bellek kartı koşu bitiminde temizlenmiyor; saatler önceki ölçüm "az önce" görünüyor |
| düşük | `agent.ts:344/382/414/525` | Hafızadaki konum tıklanan kelime kutusu değil OCR satırı merkezi |
| düşük | `viewer-server.ts:25` | Upgrade'te Origin denetimi yok, 12 soket sınırı jetondan önce sayılıyor |
| düşük | `tool-http.ts:88-109` | Uç nokta iki kez başlatılabiliyor; sahipsiz 127.0.0.1 dinleyicisi kalıyor |

## 5. Kapı ve test boşlukları

**Not (güncellendi):** `test:stability` kırmızısı `14e39aa` (checkpoint patch'i) anında 3 testti
(`checkpoints is not defined`); `63a78dc` (1.9.160) harness'e `checkpoints` + `structuredClone`
stub'larını ekledi ve **kapı 1.9.161'de yeşil** (49 test / 40 geçti, 0 kırmızı). Kırmızı olduğu
pencerede şu üç koruma sınanmıyordu:

1. bozuk graftan sonra run-state sızıntısı yok + sonraki koşu çalışır (uygulamayı "Ajan zaten çalışıyor." ile kilitleyen sınıf),
2. hata → kurtarma → aynı öğede devam sözleşmesi (ayrı kurtarma anahtarı dâhil),
3. Durdur ve kısmi hata sonucunun şekli (`stopped`, `failed`).

Kıran commit `14e39aa`; commit mesajı yalnız typecheck + checkpoint testlerini raporluyor, §19 tam kapısı çalıştırılmamış. En küçük düzeltme: `...overrides` öncesi `checkpoints` + `structuredClone` stub'ı (ölçüldü: 5/5 yeşil).

**Testlerin davranışı yanlış sabitlediği yerler** (kod düzeltilince test de dönmeli):
- `tests/checkpoint-runner.test.ts:59-64` — "checkpoint yazımı hata verirse koşu reddedilir, eylem yapılmaz" **bilinçli olarak** kilitlenmiş. Hedeflenen davranış tersi olmalı (koşu devam eder, uyarı yazılır).
- `tests/visual-pointer-agent.test.ts:11` — mock hâlâ `INPUT_CLICK_STALE` **fırlatıyor**; gerçek worker artık tıklayıp uyarı döndürüyor (H3).
- `tests/runner-loop.test.ts:58-68` — kaldırılmış türleri `debug: true` ile sınıyor; normal koşudaki sonsuz retry (K1) kapsam dışı.
- `tests/review-fixes.test.ts:93-104` — merge belirsizliğini sahte metinle sınıyor; gerçek `main.ts:468` metnini kapsamıyor (H11).
- `tests/condition-recovery.test.ts` — sahte executor hatayı doğrudan fırlatıyor; gerçek `exists` yolunu kapsamıyor (H5).

## 6. Önerilen düzeltme sırası

**P0 — koşuyu durduran / yanlış yere yazan (her biri ayrı küçük patch):**
1. K1: eylem dışı türlerde sonlu retry + Paket'i yeniden oynatma.
2. K2/H12-13: checkpoint yazımını `try/catch` + `warn` ile yut; `write`'a `renameRetrying`; saklama sınırı (son N koşu / X gün); `list()`'te dosya başına tolerans.
3. H1/H2: etiket→alan çözümünü ve `EM_SETSEL` geri düşüşünü üretimdeki klavye dalına taşı (ret eklemeden, eylem olarak).
4. H4: `assertModelKeysAllowed`'ı Yap/İnisiyatif tuş yoluna bağla.
5. H8: resume karşılaştırmasını koşu-anı listesine göre yap (veya "liste değişti" kontrolünü kaldır, kimlikle devam zaten var).

**P1 — yanlış raporlama ve kayıp:**
H3, H5, H6, H9, H10, H11, H14, H15, H18, H19, H20.

**P2 — kaynak/performans ve UI:**
H13 yazma amplifikasyonu (NDJSON + debounce + `index.json`), H16 budama, H17 piksel döngüsünü native'e indirme, H7 ve §4 tablosu.

Her patch için ölçüt §19'daki gibi olmalı: *"iş ilerledi mi"* (dosya oluştu, alana yazıldı, koşu bitti) — "kapı fırladı mı" değil.

## 7. Yöntem sınırları

- Tüm bulgular **kod okuması + bağımsız çürütme** ile doğrulandı; hiçbiri canlı masaüstü koşusuyla yeniden üretilmedi (bu taramada masaüstüne dokunulmadı).
- Ölçülen sayılar (2169 tanılama klasörü, 1401 test, EPERM sıklığı) bu makinedeki mevcut durumdan; farklı makinede değişebilir.
- `screen.ps1` performans sayıları (2,9 sn / 9,2 sn) ajanın piksel döngüsü sayımından türetildi; gerçek sayaçla ölçülmedi.
- 2 bulgu bağımsız doğrulamada **çürütüldü**, 1'i belirsiz kaldı; bunlar bu rapora alınmadı.

## 8. D�zeltme durumu

**1.9.162'de kapat�ld�:** K1 (sonsuz retry/paket oynatma), K2 + H12 + H13'�n liste k�sm�
(checkpoint yaz�m�, saklama s�n�r�, bozuk dosya tolerans�, rename retry), H3 (t�klama uyar�s�),
H4 (model tu� korumas�), H5 (ko�ul turu s�n�r�), H8 (klas�r kutusunda devam), H9 (`run.from`
ba�lad� demiyor), H10 (durdurulan ko�u saya�lar�), H11 (merge belirsizli�i), H14 (kilit b�rakma),
H16 (tan�lama budama), H18 (kapan�� diyalo�u), H19 (bayt/token b�t�esi), H20 (portable klas�r
sahipli�i).

**A��k kalanlar (sonraki patch'ler):** H1/H2 (worker etiket�alan ve `EM_SETSEL` geri d�����),
H6 (`ensureActed` tarama korumas�), H7 (paket i�i hedef se�ici), H15 (`savedId` silinmesi),
H17 (`screen.ps1` piksel d�ng�s�), H13'�n 500 ms tam-dosya yeniden yaz�m� ve �4 tablosundaki
orta/d���k bulgular.
