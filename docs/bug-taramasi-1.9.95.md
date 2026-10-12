# Tam Proje Bug Taraması — Tur 2 (1.9.95, commit `527d4d2`)

**Yöntem:** 12 alan ajanı (yalnız-okuma, bilinen 1.9.93 listesi + 1.9.94/1.9.95 düzeltmeleri **dışlanarak**) ·
**Kod değişikliği: YOK** (bu rapor dosyası dışında ağaç dokunulmadı, `git status` temiz)

Etiketler: **✓ doğrulandı** · **~ kısmen** (ana iddia doğru, ayrıntı düzeltildi) · **✗ çürütüldü** · **◐ ajan tespiti** (satır kanıtlı, çürütme turuna girmeyen orta/düşük)

---

## 1. Ölçek ve doğrulama gücü

- **97 yeni bulgu**: 22 yüksek · 28 orta · 23 düşük · 24 not. (Önceki raporun 106 bulgusu tekrar sayılmadı; iki madde istisna, §5'te işaretli.)
- **22 yüksek bulgunun her biri için bağımsız çürütmeci ajan** kodu açıp karar verdi: **11 `dogru`, 11 `kısmen`, 0 `yanlış`** — yani hiçbiri uydurma değil, ama **11'i ayrıntıda düzeltildi** (aşağıda her biri işaretli).
- Ayrıca **kendi doğrulamalarım** (bu raporun yazarı): `boot.ts` tek örnek kapısı, `runner.ts` hata sayacı yolu, `tools.ts:1768` koşu özeti, Başlangıç node'u üçlü normalizasyonu — hepsi kod okunarak teyit edildi; kilit sahipliği kaybı **gerçek modülle deneyle ölçüldü**.
- Önceki turdaki **bir iddia çürütüldü**: "`test:stability` bayat `dist-electron` üzerinde koşar" ✗ — `npm run build:main`, `tsconfig.node.json` (`include: ["electron"]`) ile **tüm electron/ klasörünü** yeniden derler; `agent.ts` değişince `dist-electron/agent.js` güncellenir.
- **Kapsam sınırı (dürüst):** alan başına **tek** ajan çalıştı; doğrulama turu yalnız **yüksek** önemli 22 bulguyu kapsadı — orta/düşük/not maddeleri çürütme turundan geçmedi. Gerçek Windows masaüstü, fiziksel tablet ve canlı iki süreç yine sınanmadı.

---

## 2. Doğrulanmış yüksek bulgular

### 2.A Sessiz veri kaybı ve yanlış başarı raporu

**✓ 2.A.1 — Kütüphane çakışmasında "kaydedildi" deniyor, içerik geri dönüşsüz kayboluyor** (`electron/main.ts:1052-1066`, `src/App.tsx:293-318, 689-706`, `canvas-session.ts:7-13`)
`libraryStorage.save` `LibraryConflictError` fırlatınca katalog **atlanıyor** ama `store.set({canvases: librarySession(canvases), graph})` **oturumu yine yazıyor** — yani sekme grafiği *ve* ilerlemiş `baseline` diske gidiyor. `persistBook` çakışmada durmadığı için arayüz **"«X» Tuvaller'e kaydedildi."** başarı mesajı basıyor. Sonraki açılışta `canvasDirty` false olduğundan kurtarma taslağı üretilmiyor → **kullanıcının düzenlemesi sessizce yok oluyor**. Çürütmeci: doğru, zincir birebir.

**✓ 2.A.2 — Kilit hatası çakışma sayılmadığı için OTURUM da yazılmıyor; oturum içi yeniden sahiplenme yok** (`electron/main.ts:1041-1047, 1056-1066`, `library-lock.ts:138-142, 145-169`)
`catch (e) { if (!isLibraryConflict(e)) throw e }` → `lost()`/kilit hataları oturum yazımına varmadan dışarı çıkıyor. **Kendi deneyimle ölçtüm:** kilit dosyası dışarıdan silindiğinde `withLibraryLock`, `assertOwned` ve **aynı süreçte yeniden `claimLibraryLock` üçü de** "Kütüphane kilidi değişti; kayıt sahipliği kayboldu." veriyor; yalnız `release()` sonrası yeni claim çalışıyor ve uygulama bu yolu denemiyor. Çürütmeci: ana iddia doğru; *düzeltme* — "Yeniden Yükle" reddedilmiyor ve başka süreç tutuyorsa ret kalıcı değil (o süreç kapanınca devralınır).

**~ 2.A.3 — Başlangıç node'u silinebiliyor → üç farklı rastgele kimlik → kalıcı yanlış "başka sekmeden kaydedildi" ve kirlilik** (`graph-types.ts:841-853, 467-475`, `canvas-library.ts:26-40`, `NodeCanvas.tsx:999-1003`)
Bağlam menüsü her node için "Sil" sunuyor (yalnız `loop` farklı etiketli), Başlangıç koruması yok. `normalizeGraph` Başlangıç yoksa `createNode('start', …)` ile **`rid()` yani rastgele id** enjekte ediyor; `normalizeCanvasBook` ise sekme grafiğini (882), `baseline` grafiğini (884) ve **katalog kaydını** (869) **ayrı ayrı** normalize ettiği için üç id birbirinden farklı oluyor → kayıt karşılaştırma guard'ı sürekli sapma görüyor. Çürütmeci: mekanizma doğru; *düzeltme* — hata aynı oturumda değil **yeniden yükleme sonrası** ortaya çıkıyor ve tek kaçış "Farklı Kaydet" değil (Tuvaller'den açmak da olur).

**✓ 2.A.4 — Motor koşu sırasında okuduğu dosya listesini canlı tuvale yazıyor; makineye özel mutlak yollar kayda giriyor** (`electron/runner.ts:476-498, 604-605`, `canvas-content.ts:4-11`)
`patch(loop.id, { items: found })` canlı grafiği günceller, `listDirEntries` mutlak yol döndürür ve `canvasContent` `items`'ı "geçici koşu durumu" olarak süzmez → kullanıcı hiçbir şey düzenlememişken tuval kirli olur, otomatik kayıt ve kurtarma yolu tetiklenir. Çürütmeci: doğru.

**✓ 2.A.5 — Döngü dışı adım hatası "hatalı öğe yok" diye raporlanıyor** (`runner.ts:425-426, 553, 686`, `tools.ts:1768`, `main.ts:809`)
`tally.failed++` **yalnız** `runLoop` içindeki öğe hatasında (553) artıyor; döngü dışı bir adım hatası `StepFailedError` fırlatıp `runGraph`'ı 686'ya varmadan terk ediyor, `failed` alanı hiç oluşmuyor ve araç satırı "hatalı öğe yok" yazıyor — **aynı cümlede** "hata: …" da yazdığı için çelişkili bir özet çıkıyor. Çürütmeci: doğru (sayaç yol bağımlı).

**✓ 2.A.6 — Kurtarma tamamlaması kullanıcıya "Node tamamlandı; akış devam etti." diyor** (`RecoverySettingsPanel.tsx:127`, `recovery-report-view.ts:23`, `recovery.ts:57, 169-172`)
`completionBasis: 'model-observed'` durumunda node **yeniden hiç çalıştırılmadı**; motorun kendi sözleşmesi bunu "model gözlemine göre hedef gerçekleşti" diye tanımlıyor, doğru metin raporun **ikincil** satırında kalıyor. Üstelik `tests/recovery-ui.test.ts:68` bu beyanı sabitliyor. Çürütmeci: doğru.

**~ 2.A.7 — Kayıtlı çıkışına ulaşmayan paket ('blocked') hiçbir hata işareti üretmiyor** (`runner.ts:326-341, 404-411, 415-431`) — **1.9.93 raporunda zaten yazılıydı** (bkz. §5), yeni sayılmamalı. Çürütmeci ayrıca düzeltti: "kalan dış adımlar çalışır" **yanlış** — zincir `runner.ts:430`'da durur, yalnız sonraki döngü öğeleri sürer.

### 2.B Kapanış ve kilitlenme

**✓ 2.B.1 — Uygulama kapanışı renderer'ın tek yanıtına bağlı, zaman aşımı yok** (`main.ts:1241-1246, 406-412`, `window-close.ts:8-15`)
`before-quit` → `closeGuard.ready && !approved` ise `preventDefault()`; `approved` yalnız `window:finish-close` IPC'sinden gelir. Renderer asılır/çökerse kapanış **sonsuza kadar** engellenir ve **kaydedilmemiş oturum diske inmez**; alternatif çıkış veya `render-process-gone` yedeği yok. Çürütmeci: doğru.

**~ 2.B.2 — Tek örnek kilidi kaybedildiğinde `return` yok** (`boot.ts:13-20`)
`if (!app.requestSingleInstanceLock()) { app.quit() } else { … }` — `app.quit()` sonrası `return` **yok**, modülün geri kalanı koşulsuz çalışıyor (splash + `startApp`). Çürütmeci düzeltti: `quit` zaten "commit" durumda olduğu için splash açılsa da süreç hemen ölür; "tüm uygulama başlar" **garanti değil**, `main.ts`'e yetişmesi yarışa bağlı. Yine de standart Electron kalıbı ihlali ve garantisiz.

**~ 2.B.3 — Tablet izleme "açık" kaydediliyor ama Tailscale yayını hata verse de geri alınmıyor** (`main.ts:1112-1116`) — `viewerEnabled=true` Tailscale adımından **önce** yazılıyor; hata yalnız `viewerInfo()` yanıtına düşüyor. Çürütmeci düzeltti: `serve --bg` kalıcı olduğu için "yeniden başlatmada 8443 kaybolur" kısmı **yanlış**.

### 2.C Hedef bulma, doğrulama ve model maliyeti

**✓ 2.C.1 — Aynı yazıdan iki tane varsa metin yolu bağlama bakmadan ilk öğeyi seçiyor** (`matcher.ts:126-145`, karşıt kural `target-match.ts:53-62`)
`pickBest` eşitlikte `return a.item.id - b.item.id` yapıyor; "iki aday var, karar veremiyorum" çıkışı yok ve LLM aşamasına sıra gelmiyor — UIA adı yolu (`clickableBy`) aynı durumda reddederken OCR/metin yolu reddetmiyor → **yanlış "Kaydet"e tıklama** riski. Çürütmeci: doğru.

**✓ 2.C.2 — `judgeScreen` "hazır" kararını **alt-dize** ile ve "yükleniyor" denetiminden **önce** veriyor** (`confirm.ts:70-89`, `matcher.ts:331-335`, `agent.ts:838-841, 1130`)
`has()` → `containsText` → `includes(q)` (kelime sınırı yok); `ready` dalı (75-77) `loading` denetiminden (87-89) önce. Çürütmeci **gerçek modülle koşturdu**: ekranda "Tamam" + "Tamamlanıyor" varken sonuç `ready` → "Emin" günlüğü, `saveMemo` ile **doğrulanmamış hedefin hafızaya yazımı** (§4/§17 ihlali) ve `log` modunda da geçerli.

**✓ 2.C.3 — Hedef seçimi modeline giden aday listesi hiç sınırlanmıyor** (`word-targets.ts:64-72`, `matcher.ts:345-350`, `openrouter.ts:517-544`)
`describeWordCandidates` her aday için `describeItems([item])` çağırıyor → 400'lük varsayılan sınır **tek elemanlı dizide etkisiz**; listeye ekrandaki **her OCR kelimesi** giriyor ve hiçbir token/boyut budaması yok → yoğun ekranda on binlerce token; bağlam taşması ya adımı düşürüyor ya da aynı dev istek 15 dk tekrarlanıyor. Çürütmeci: doğru.

### 2.D Renderer (masaüstü arayüzü)

**~ 2.D.1 — `agent:patch` yükü tuval kimliği taşımıyor** (`App.tsx:471-474`; yayıncı `agent.ts:160, 1093`)
Kimliksiz yük, "açık olan grafiği" yamalar. Çürütmeci düzeltti: `await api.runAgent` + FIFO IPC sırası nedeniyle **pratikte** önceki tuvalin patch'i yeni aktif tuvale kaymıyor; yine de herhangi bir gecikme/kuyruk değişikliğinde kırılgan (savunma yok, yalnız sıra garantisi var).

**◐ 2.D.2 — İmleçle yakalama (3 sn bekleme) tuval kimliğini kilitlemiyor** (`App.tsx:1018-1035`; `editorLocked` `capturing`'i içermiyor, `NodeCanvas` `capturing` prop'unu hiç kullanmıyor) → bekleme sırasında tuval değişirse locator/prompt/çapa **başka tuvaldeki aynı id'li node'a** yazılabilir. (Orta; çürütme turuna girmedi.)

**◐ 2.D.3 — Kapanış akışında yazma bariyeri yok** (`App.tsx:1426-1464`, 1048-1090, 1092-1116)
`writeQueue` yalnız **son kayıttan önce** bir kez boşaltılıyor; kapanış başladıktan sonra kuyruğa giren otomatik yazımlar (400 ms klasör debounce'u `closingRef`'i görmüyor, şablon doldurma effect'inin bağımlılıklarında `closing` yok) **boş oturum kaydından sonra** diske yazılabiliyor. (Orta; çürütme turuna girmedi.)

**◐ 2.D.4 — Erişilebilirlik gerçekleri:** `CanvasTabs` `role="tab"` ilan ediyor ama hiçbir sekme **odaklanabilir değil** (`tabIndex` yok, ok tuşları/Enter yok) → WAI-ARIA sekme sözleşmesi uygulanmamış (`CanvasTabs.tsx:64-84`); `TabletDialog`'un **odak tuzağı yok** ve `TabletDialog`/ekran tarayıcı `editorLocked` kapsamına alınmadığı için modal açıkken global kısayollar tuvali değiştirmeye devam ediyor (`App.tsx:1424, 1529-1530`).

### 2.E Tablet / izleyici
✓ 2.B.3 dışında yeni yüksek bulgu yok; `viewerEnabled`/Tailscale ve `run.from` adı kalan iki kalem (ikincisi 1.9.93 listesinde).

### 2.F Testler ve kanıt dürüstlüğü

**✓ 2.F.1 — Gerçek iki-süreç kilidi testi hiçbir kapıya bağlı değil** (`scripts/test-library-lock-process.cjs`, `package.json:15-28`, `windows-targeting.yml:94-105`)
Ne `npm test` (vitest `tests/**`), ne CI adımı bu betiği çağırıyor; buna karşılık [surum-notu-1.9.95.md](surum-notu-1.9.95.md) onu **doğrulama kanıtı** sayıyor ve "6 tur" sayısı kodda sabit (`for round < 6`). Çürütmeci düzeltti: "yeniden üretilemez" fazla sert — `build:main` sonrası elle koşulabilir (ben de koştum: 1 pass).

**✓ 2.F.2 — Reload/çakışma arayüz testleri gerçek çakışma durumunu üretemiyor** (`tests/workspace-lifecycle.test.ts:32-37`)
Sahte `api.saveCanvases` yalnız `boolean` döndürüyor; üretimde `main.ts:1056-1065` **`{conflict:boolean}`** döner. Dolayısıyla `App.tsx:301-314`'teki çakışma dalı ve kullanıcı uyarısı **hiçbir testte** üretilmiyor → 1.9.94'ün çakışma toparlanmasının arayüz kanıtı eksik.

**~ 2.F.3 — İki-yazar sınırının üretim testi kütüphane ve izleyici katmanını no-op sahteyle değiştiriyor** (`tests/workspace-main.test.ts:37-40`) → çakışma/kilit kaybı dalında "oturum yine yazıldı mı" ölçülmüyor. Çürütmeci: doğru, ancak aynı sınır `tests/workspace-save.test.ts:156-169`'da ayrıca sınanıyor.

**~ 2.F.4 — Senaryo koşucusu bazı başarılı koşularda `input-sent` sınıfını "atlandı" sayıyor** (`scripts/dev-scenario.cjs:295-296, 350-351, 380`)
`noTyping` yüzünden `/Alan doğrulandı/` hiç denenmiyor ve `passed = ok || skipped` olduğu için **GEÇTİ + exit 0** yazılıyor (kanıt: `test-artifacts/region-bounded-…/result.json` → `passed:true` + `field-verified skipped:true`). Çürütmeci düzeltti: yalnız `stoppedBy: 'until'/'user'` senaryosunda tetikleniyor (tek örnek: region-bounded); normal koşularda gerçekten ölçülüyor.

**◐ 2.F.5 — Kilit modülünde sahiplik kaybı sonrası `held` kaydı temizlenmiyor** (`library-lock.ts:147-150`)
`claimLibraryLock`'ta `held.get(file)` varsa `assertOwned` fırlatır ama `held` kaydı **silinmez**; o süreçte aynı dizin için sonraki her talep kalıcı "sahiplik kayboldu" verir (benim deneyim bunu doğruladı: yeniden claim de patlıyor → pratikte release şart). `tests/library-lock.test.ts:158-167` bu davranışı sabitliyor. Orta/kaynak-sızıntısı; çürütme turuna girmedi ama **deneyle ölçüldü**.

**◐ 2.F.6 — Yalancı/boş iddialar:** `tests/bug-hunt-2.test.ts:196-203` (ilk iddia `if (a)` içinde totoloji, eşik yanlış ölçekte) · `tests/workspace-save.test.ts:60-67` ("açık sıra yakalanır" satırı iki taraftan aynı ifadeyle türetiliyor) · `tests/audit-files-scripts.test.ts:67-74` (uyarının **yokluğunu** doğruluyor, varlığını değil — uyarı üreten satır silinse de geçer) · `tests/bug-hunt-2.test.ts:284-290` (duvar saati eşiği 600 ms).

### 2.G PowerShell worker

**✓ 2.G.1 — Üretimde `typeText` korumalı dalı hiç çalışmıyor** (`agent.ts:1034`, `a11y-bridge.ts:487-510`, `worker.ps1:1163-1199`)
Tek üretim çağrısı `bridge.typeText(text, false, clear, at)` → `keyboard:true` sabit ve **guard/fieldToken gönderilmiyor**; `Assert-TypeFocus`/`Focus-Input`/`Set-TextValue`/`out.value` geri okuma zinciri **yalnız testlerde** besleniyor, üretimde `out.value` her zaman `null`. Çürütmeci: doğru — yani "yazının gerçekten alana gittiği" doğrulaması üretimde yok.

**~ 2.G.2 — Tuş Gönder serbest metni `SendKeys`'e kaçırılmadan gidiyor** (`worker.ps1:324-341`, `common.ps1:185-194`)
`+ ^ % ~ ( ) { }` modifier/kontrol olarak yorumlanıyor; aynı dosyada `Send-TextPaced`/`ConvertTo-SendKeysText` kaçırıyor, `keys` yolu kaçırmıyor. Çürütmeci düzeltti: bu **kasıtlı** `SendKeys` sözdizimi (`test-worker.ps1:334-355`), gözetim değil — ancak kullanıcı düz metin bekliyorsa sürpriz (`+50` → Shift bırakmaz, `%0` yazar).

**~ 2.G.3 — Pano testleri taklidi doğruluyor** (`scripts/test-input-recovery.ps1:12-72`, `worker.ps1:1341-1357`) — klavye dalı panoyu `Get-ClipboardSnapshot`+`SetDataObject` ile yedekler; `XpText.SetClipboard/RestoreClipboard` **ölü guarded dalda**. Çürütmeci: kısmen doğru.

**◐ 2.G.4 — Worker öldürülünce `finally` koşmuyor:** köprü zaman aşımında `kill()` (`a11y-bridge.ts:157-162`) → `typeText`'in pano geri yükleme/geçici dosya silme `finally` blokları çalışmaz (`worker.ps1:1188, 1354-1357`) → kullanıcının panosu değişmiş kalabilir (orta/veri-kaybı; çürütme turuna girmedi).
**◐ 2.G.5 —** UIA bütçesi pencere başına 6 sn × 13 tarama kökü = **78 sn** üst sınır (`screen.ps1:522-543`, `a11y-bridge.ts:285-307`), istek bütçesi 180 sn (performans, orta).

### 2.H Güvenlik

**◐ 2.H.1 — "Ajan izni" girdi göndermeyen araçlara uygulanmıyor** (`tools.ts:1507-1571, 1807-1837`, `main.ts:996-999`)
`screen.read` `sendsInput:false` olduğu için **izin "Kapalı" olsa bile** jetonlu dış çağıran tüm masaüstünün ekran görüntüsünü + OCR metnini (pencere başlıkları dâhil) alabiliyor; `CLAUDE.md`'nin "dış çağıranlar izin ayarından geçer" cümlesiyle çelişiyor. (Orta; tarama raporunun kendi notu: kritik/yüksek yok.)

**◐ 2.H.2 — Renderer'da CSP yok, `will-navigate`/`setWindowOpenHandler` yok, `sandbox:false`** (`src/index.html`, `main.ts:373-387, 445-467`; splash `boot.ts:72-74` ise `sandbox:true`)
Bugün **canlı bir kaçış yolu yok** (uzak içerik yüklenmiyor, `src`'de `dangerouslySetInnerHTML`/`innerHTML`/`window.open`/`<a href>` **hiç yok** — doğruladım), ama sertleştirme tutarsız: daha ayrıcalıklı pencereler daha az korumalı ve preload geniş bir yüzey sunuyor (`openPath`/`showInFolder` herhangi bir yolu doğrulamadan `ShellExecute`'a verir, `.exe` dâhil).
**◐ 2.H.3 (kendi bulgum) — Yap node'unda kod çalıştırma varsayılan AÇIK:** `yap.ts:8, 34` (`allowCode = true`, `node.allowCode !== false`) ve panel onay kutusu (`SidePanel.tsx:312`) işaretli geliyor; aynı yetki onarım ayarında **opt-in** (`recovery-settings.ts:54`, `=== true`). Model, kullanıcı ek bir şey yapmadan kullanıcı yetkileriyle PowerShell çalıştırabilir (araç açıklaması "sandbox değildir" diyor). Bu bir **varsayılan tutarsızlığı/risk**; §19 felsefesiyle bilinçli olabilir ama yazılı değil.
**◐ 2.H.4 (kendi bulgum) — Yerel uç nokta için anahtar desteği yok:** `openrouter.ts:86` yerel isteklerde `Authorization` göndermiyor ve ayarlarda yerel anahtar alanı yok → jeton isteyen yerel sunucular (LM Studio auth, proxy'li Ollama) kullanılamıyor. Sızma riski yok (anahtar hiç yok), işlev boşluğu.

---

## 3. Orta önemden öne çıkanlar (28 madde içinden)

- **◐ Yedekleme/geri yükleme arayüzden erişilemez:** `backup`/`restore` uçtan uca kodlu ve test edilmiş ama **hiçbir arayüz öğesi çağırmıyor** (`CanvasLibrary.tsx:205`, `main.ts:1077, 1080-1088`) → kullanıcı elle yedek alamıyor.
- **◐ Doğrulama iğnesi komutun tamamı:** `confirm.ts:26-44` — "Kaydet butonuna tıkla" gibi serbest yazı olduğu için `ready` pratikte hiç oluşmuyor → memo yazılmıyor, `on` modunda her tıklama gereksiz görsel model + plan çağrısı üretiyor.
- **◐ Tekli kıvrık tırnak `‘…’` hiç tırnak sayılmıyor** (`matcher.ts:85-87`, `confirm.ts:20`, `agent.ts:1177`) → uygulamanın kendi örneğiyle yazıldığında yerel/modelsiz yol sessizce kapanıyor.
- **◐ Profil adı → klasör adı dönüşümü çakıştırılabilir** (`profile.ts:20-28`) → iki farklı profil **aynı** userData/electron-store dosyasını paylaşabilir; "tek yazar" garantisi profil düzeyinde kırılır (veri-kaybı riski).
- **◐ ONNX okuyucu yüklenemezse hiçbir yerde gösterilmiyor** (`ocr-onnx.ts:28-30, 80-96`, `a11y-bridge.ts:212-347`): hata metni atılıyor, `onnx:false` bayrağını **src'de hiçbir bileşen okumuyor**; yardım metni ise "Windows + ONNX" diyor (`src/manual/tips.ts:338`).
- **◐ Derleme determinizmi:** `build:main` çıktıyı temizlemiyor → kaynakta artık olmayan `dist-electron/custom-input.js` ve `window-theme.js` **1.9.95 asar'ına girmiş** (silinen modüller pakete sızıyor).
- **◐ Paketlenen exe kendini "Electron 33.4.11 / GitHub, Inc." tanıtıyor** (ProductName/CompanyName damgalanmamış).
- **◐ Tuval sekmeleri klavyeyle seçilemiyor, `role="tab"` ama `tabIndex` yok**; `TabletDialog`'da odak tuzağı yok.
- **◐ `NodeNavigator` Enter'ı iki kez açıyor** (`NodeNavigator.tsx:37-47`: `onKeyDown` + native click'in 300 ms gecikmeli ikinci navigate'i); klavye yolu test dışı.
- **◐ `ScreenScanner` kapsam değişince yeniden taramıyor** (`ScreenScanner.tsx:220-227`) → eski pencerenin karesi ve eski koordinatlı kutular ekranda kalıyor.
- **◐ `NodeCanvas` sürüklemede her `mousemove`'da tüm grafiği dışarı yazıyor** + memo'ları geçersizleştiriyor (`NodeCanvas.tsx:415-444`) → büyük grafiklerde sürükleme maliyeti.
- **◐ Sayısal `Her Öğe İçin` kutusunda `{{öğe}}` arayüzde "1", koşuda "#1"** (`reveal.ts:24-28`, `graph-types.ts:577-582`) — 1.9.93'teki "kimlikle devam" bulgusunun kardeşi.
- **◐ `agent.ts:1219-1236` ekran görüntüsü kanıt yolu** yazıldığı hâlde "henüz yazılmadı" diyebiliyor (ve tersi).
- **◐ Durdurma nedeni damgası yalnız yeni koşu başında temizleniyor** (`tool-state.ts:345-352`) → Durdur'dan sonraki tek adım/eylem yolları "kullanıcı durdurdu" damgasını taşıyor.
- **◐ Şablon klasörlü döngü** `items`'ı canlı node'a yazıyor (2.A.4 ile aynı kök, ayrı kanıt: `tests/workspace-save.test.ts:122-134`).

---

## 4. Sistemik örüntüler

1. **Sayaç ve kanıt yolu bağımlılığı:** aynı olay (adım hatası, paket bloke, "yazıldı") yola göre farklı raporlanıyor (2.A.5, 2.A.7, 2.F.4, ekran görüntüsü kanıtı). §4'ün "komut gönderildi / sonuç gözlendi / belirsiz" ayrımı **araç raporunda** yer yer kayboluyor.
2. **Çakışma ve kilit hatalarının asimetrisi:** kütüphane çakışması "ayrı durum" sayılıyor ama **oturum yine yazılıyor** (2.A.1); kilit hatası ise çakışma sayılmadığı için **oturum hiç yazılmıyor** (2.A.2). İki uç da yanlış: biri veriyi sessizce kaybediyor, öbürü tüm oturumu rehin alıyor.
3. **Kimlik taşımayan mesajlar ve yeniden normalize edilen kimlikler:** `agent:patch` tuval kimliği taşımıyor; `normalizeGraph` eksik Başlangıç'a **rastgele** id veriyor ve üç ayrı normalizasyon üç farklı kimlik üretiyor (2.D.1, 2.A.3) — kimlik üretimi ile kimlik doğrulaması ayrı yerlerde.
4. **Testlerin üretim yolunu atlaması:** kilit süreç testi kapıya bağlı değil, reload/çakışma testleri sahte `api` ile çakışma dalını hiç üretmiyor, `typeText`'in korumalı dalı yalnız testlerde besleniyor, pano testi taklidi doğruluyor (2.F.1-2.F.4, 2.G.1, 2.G.3). "Yeşil" ile "ölçüldü" arasındaki mesafe kapanmıyor.
5. **Varsayılanların tutarsızlığı:** kod çalıştırma Yap'ta açık / onarımda kapalı; pencere sertleştirmesi splash'te açık, ana pencerede kapalı (2.H.2, 2.H.3).

## 5. Bilinenlerle çakışan maddeler (dürüstlük notu)

- §2.A.7 (`blocked` paketin tamam sayılması) **1.9.93 raporunda** zaten yazılıydı → yeni değil.
- Sayısal kutuda `{{öğe}}` "#1" ↔ "1" farkı, 1.9.93'teki **"kimlikle devam sayısal kutularda çalışmıyor"** maddesinin kardeşi → yeni sayılmamalı.
- Çürütülenler: "`test:stability` bayat dist üzerinde koşar" ✗ · "`boot.ts` ikinci örnek tüm uygulamayı başlatır" (garanti değil, yarış) ✗ · "Tailscale yeniden başlatmada kaybolur" ✗ · "`+50` SendKeys gözetimi" (kasıtlı sözdizimi) ✗ · "`agent:patch` pratikte yanlış tuvale yazar" (FIFO engelliyor) ✗.

## 6. Öncelik sırası (değişiklik yapılmadı; istenirse sıra budur)

1. **§2.A.1 çakışmada baseline ilerlemesi + yanlış başarı mesajı** — geri dönüşsüz veri kaybı; en yüksek kazanç.
2. **§2.A.2 kilit hatasında oturumun da yazılmaması + `held` kaydının temizlenmemesi (2.F.5)** — oturum rehin alınıyor.
3. **§2.B.1 kapanış zaman aşımı** — uygulama kapanmıyor, oturum yazılmıyor.
4. **§2.C.2 alt-dize "hazır" + memo yazımı** ve **§2.C.1 eşitlikte ilk öğe** — yanlış tıklama/yanlış hafıza.
5. **§2.A.3 Başlangıç node'u koruması ve kimlik tutarlılığı** (tek `normalize` geçişi ya da kalıcı id).
6. **§2.C.3 aday listesi bütçesi** — maliyet ve bağlam taşması.
7. **§2.F.1-2.F.2 kanıt kapıları** (kilit süreç testini `npm test`e bağla; sahte `api` ile çakışma dalını üret).
8. **§2.H.1 izin kapsamı** ve §2.H.3 varsayılan tutarlılığı — kullanıcı kararı gerektirir.

---

*Rapor tamamen yalnız-okuma taramadan üretildi; repo ağacında yalnız bu dosya eklendi, hiçbir kaynak değiştirilmedi, commit/push yapılmadı.*
