# Tam Proje Bug Taraması — 1.9.93 (commit `5f1f81d`)

**Tarih:** 24 Aralık 2026 · **Yöntem:** çok ajanlı, yalnız-okuma denetimi · **Kod değişikliği: YOK** (bu rapor dosyası dışında ağaç dokunulmadı)

Etiketler: **✓ doğrulandı** (kod satır satır ikinci kez okunup teyit edildi) · **~ kısmen** (ana iddia doğru, bir alt iddia çürütüldü/düzeltildi) · **✗ çürütüldü** · **◐ ajan tespiti** (satır kanıtlı, çürütme turundan geçmedi)

---

## 1. Yöntem ve kapsam

- **23 ajan** çalıştı: 11 alan tarama ajanı (paralel, derin okuma) → önem sırasıyla kritik/yüksek bulgular için **doğrulama ajanları** (her bulgu için iddianın dosyası yeniden açıldı, satır aralığı ve patlama zinciri ayrı bir ajanca teyit edildi) → örüntü analizi.
- Tarama alanları: runner/döngü/paket · hedef+girdi+eylem (`agent.ts`) · PowerShell worker (`a11y/*.ps1`) · model katmanı+yerel yönlendirme · IPC+ayarlar+kalıcılık · köprü+harness+scripts · kütüphane+SQLite+bölümler · Yap node+araç katmanı · tablet/görüntüleyici+android · performans+uzun koşu.
- **Kapsam sınırı (dürüst not):** 11 alan ajanından 10'u sonuç döndürdü. **Renderer/UI alanı ajanı (App.tsx / NodeCanvas / bileşenler) sonuç üretmedi**; bu alan yalnız komşu ajanların çapraz okuması ve aşağıdaki elle denetimlerle kısmen kaplandı. UI'a özel ayrı bir tarama istenirse ikinci tur gereklidir.
- Elle doğrulama (bu raporun yazarı): iki-yazar kayıt zinciri, kütüphane kilidi (pid+nonce), görüntüleyici sunucusu, ViewerApp bölünmesi, ölü proplar/ölü CSS, kendi-pencere koruması, atlanan test envanteri.
- **Ölçümler (bu derlemede gerçekten koşuldu):** typecheck **yeşil** (3 tsconfig); Vitest **102 dosya / 750 geçti / 1 atlandı / 0 kırmızı** (7,5 sn); beş Node regresyon paketi **97 geçti / 21 atlandı / 0 kırmızı** (keys 3, input 7, recovery 27+12 atlandı, targeting 20, stability 40+9 atlandı). Atlananlar: 19 emekli inisiyatif-motor testi (`scripts/test-input-recovery.cjs` ×10, `scripts/test-stability-agent.cjs` ×9) + 1 kaldırılmış kurtarma paneli testi (`tests/workspace-lifecycle.test.ts:144`).
- Ajanlar toplam **106 bulgu** kaydetti. Bunlardan kritik/yüksek olanlar doğrulama turuna girdi; aşağıda 9'unun tam doğrulama kararı verildi (kalanı §4'te alan özetleriyle taşınıyor).

---

## 2. Kritik ve yüksek bulgular (doğrulanmış)

### 2.1 ✓ **"Defterin iki yazarı" kuralı bileşimde ters işliyor — branch kayıtları kalıcılığa hiç ulaşmıyor** (KRİTİK)

- **Yer:** `electron/main.ts:951, 1056-1057` + `electron/workspace-store.ts:7-9` + `electron/tool-branch.ts:111-118`
- **Zincir (kodda birebir izlendi):** `tools.ts:400-401` branch ekler ve `ctx.saveCanvases(book)` çağırır → `main.ts:951` `toolLayerSave(loadCanvases(), book.branches)` ile yeni branch'ler yazılan kitaba konur → `storeWorkspace` **tekrar** `current = loadCanvases()` (bayat mağaza kopyası) yükler → `writeWorkspace` içinde `windowSave(written, current)` `branches` alanını **her zaman `current`'tan** (`{...written, branches: current.branches ?? []}`) alır → mağazaya **bayat** branch listesi yazılır.
- **Etki:** `branch.create` / `flow.edit` / `branch.drop` kayıtları diske asla yazılmaz; `getCanvases()` her çağrıda mağazadan taze yüklediği için araç katmanının branch durumu çağrılar arası da kaybolur. `tools.ts`'in kendi ölçüduğu "1 grup → 0 grup" arızası (719-720 civarı) birebir geri gelmiş durumda. Birim testler yalnız saf fonksiyonları (`windowSave`/`toolLayerSave`) sınadığından bu bileşim hatası testlerde görünmüyor.
- **Not:** Kuralın *amacı* doğru ve iki fonksiyon doğru; hata `storeWorkspace`'in iki yolu tek örüntüde birleştirmesi. `main.ts:1118-1119`'daki yorum ("branch'ler araç katmanının son yazdığından alınır") kodun gerçekte yaptığını yanlış anlatıyor.

### 2.2 ✓ **Tuş Gönder: hedef pencere doğrulanmadan kısayol gönderiliyor — hedef pencere kapalıysa tuş rastgele uygulamaya gider** (YÜKSEK)

- **Yer:** `a11y/worker.ps1:1394-1401` (direct dal) + `electron/agent.ts:1166` + `electron/a11y-bridge.ts:559`
- **Kanıt:** direct dalda `try { Enter-Window (Find-Window ...) } catch {}` — boş catch, hem "pencere bulunamadı"yı hem aktivasyon başarısızlığını yutar; ardından yalnız ownPid (Nubbo'nun kendi penceresi) koruması var, öndeki pencereyi denetleyen `Assert-KeyWindowActive` zinciri (1406-1421) **yalnız non-direct dalda** çalışıyor ve köprü her çağrıda `direct:true` gönderiyor. Ek: `targetWindow` varsayılanı `''` (`graph-types.ts:280`) — ayar boşken tuş koşulsuz öndeki uygulamaya gider.
- **Nüans:** `agent.ts:1153` yorumu bunu bilinçli tasarım gibi gösteriyor (§19 kapı-kaldırma kararıyla ilişkili olabilir), ancak tuş yolunun bilinçli istisna olduğu kaynakta yazmıyor. §6 "başka uygulama yerine geçmez" kuralı tuş yolunda uygulanmamış.

### 2.3 ✓ **ensureActed'ın "adımı asla hata yapmaz" sözleşmesi kırılıyor: başarılı tıklama, günlük amaçlı bir tanılama çağrısı yüzünden hata olabilir** (YÜKSEK)

- **Yer:** `electron/agent.ts:805-812` + `electron/a11y-bridge.ts:513-516`
- **Kanıt:** `await act()` sonrası `await bridge.inputState()` try/catch'siz; `inputState` köprüde catch'siz 10 sn timeout'lu `worker.call`. Tetikleyici: tıklama + sıradaki type node'u prompt'suz/locator'sız (yalnız alan seçme). İstisna yükselme zinciri teyitli: agent.ts:1104 catch yok → runner.ts:270-274 catch yok → runner.ts:381; `isFatal` kapsamaz; kurtarma kapalıysa node "error" işaretlenir. Aynı dosyada `cursorPos` (415-423) ve `isLocked` (529-536) kendi catch'ine sahipken `inputState`'e tolerans verilmemiş.
- **Yumuşatıcı:** gerçek reddetme yolları 10 sn zaman aşımı / worker ölümü / hata yanıtı (eşzamanlı "meşgul reddi" oluşmaz); `screenCheckMode:'off'`'ta bu çağrı hiç yapılmaz — ama varsayılan mod `log`'dur, yol canlıdır.

### 2.4 ✓ **Tıkla→Koşul zincirinde doğrulamasız `return true` → doğrulanmamış hedef hafızaya yazılıyor** (YÜKSEK)

- **Yer:** `electron/agent.ts:813-817` + `agent.ts:1130`
- **Kanıt:** sıradaki node Koşul olduğunda `await act()` sonrası hiçbir ekran değerlendirmesi yapılmadan `return true`; `if (confirmed) saveMemo(node, t.memo)` koşulsuz memo kapısını açar. Bu, fonksiyonun kendi sözleşmesiyle (792-793 "only confirmed targets go into memory") ve CLAUDE.md §17 ile çelişir. Yazılan memo sonraki turlarda `likeness` (agent.ts:224, 381) ve `conflict` (279-281) üzerinden gerçekten etkili. 805-811'deki tıklama→yazma durumunun bilinçli `return false`'u, `confirmed`'ın gerçekten memo kapısı olduğunu gösterir — Koşul dalı bu kapıyı bypass ediyor.
- **Yumuşatıcı:** 'off' modunda memo zaten her node için doğrulamadan yazılıyor; `likeness` yalnız yakın-eşit adaylar arasında bağ kırıcı — kalıcılık etkisi gerçek ama ima edilenden biraz daha sınırlı.

### 2.5 ✓ **Zaman aşımını aşan Koşul beklemesi her yinelemede tam ekran tarama + bir LLM çağrısı üretiyor** (YÜKSEK / performans)

- **Yer:** `electron/runner.ts:298-305` + `electron/agent.ts:335, 477-480, 492-497, 1207`
- **Kanıt zinciri:** koşul metni bütünüyle tırnaklı değilse `exists()` her 700 ms'de `resolveTarget`'a düşer; koşullarda `marked=null` olduğundan windows OCR aşaması atlanır, geriye yalnız `list` aşaması kalır → her yinelemede `scanFor(fresh:true, wide:true)` tam ekran OCR taraması + `pickFrom(llmOnly=true)` → `chooseScreenTarget` model çağrısı. 60 sn'lik bekleme ≈ 10-25 yineleme × (tarama + model). §9 "model çağrıları sınırsız büyümemeli" ve §10 kontrollü gözlem sıklığı bu yolda karşılanmıyor.
- **Yumuşatıcı:** tırnaklı koşullar (1194-1201) hızlı OCR yoluyla modelsiz çalışır; gerçek aralık 700 ms + tarama/model süresi (serek ama pahalı).

### 2.6 ✓ **%TEMP% süpürmesi ÇALIŞAN başka bir portable örneğin çıkarma klasörünü silebilir** (YÜKSEK / risk)

- **Yer:** `electron/main.ts:222-241, 249-287` (özellikle 271, 276-279) + `electron/temp-sweep.ts:43-51` + `electron/boot.ts:9-14`
- **Kanıt:** ölçüt yalnız mtime (10 dk) + exe varlığı + kendi-klasör muafiyeti; **PID/canlılık denetimi yok**. Tek örnek kilidi profile bağlı olduğundan gerçek profil + test profili aynı anda çalışabilir; yeni başlayan test örneği, çalışan gerçek örneğin klasörüne `fs.rmSync(recursive, force)` uygular. Kısmi silme catch ile sessizce yutulur; 281-282'deki günlük başarısız silmeyi bile "silindi" sayar.
- **Sınır:** "mtime'in çıkarma anında donması" ve hangi dosyaların kilitli kaldığı statik okumayla kanıtlanamaz — mekanizma tamamen teyitli, patlama OS'a bağlı.

### 2.7 ✓ **Kütüphane çakışması sonrası "Yeniden Yükle" toparlanması ilk otomatik kayıtla geri alınıyor** (YÜKSEK)

- **Yer:** `src/App.tsx:798-801` (+ 280-288, 391, 694) + `electron/main.ts:1078` + `electron/library-storage.ts:73-78`
- **Kanıt:** reload yolu `setLibrary(...)` yapıyor ama `bookRef.current`'a yazan tek yer `adoptBook` (281) — taze kütüphane oturum kitabına **hiç aktarılmıyor**. İlk tuval düzenlemesi `commitActive()` üzerinden bayat kütüphaneyi geri gönderir; `main.ts:1078` reload'da raw'ı tazelediği için bir sonraki `save()` içindeki `current.equals(this.raw)` denetimi **geçer** ve dış yazarın değişikliği sessizce ezilir. Uyarı metninin (App.tsx:308) söz verdiği toparlanma bu yolda tutulmuyor.

### 2.8 ✓ **Bozuk/boş `.nubbo-library.lock` dosyasından kurtarma yolu yok; kilit yazımı atomik değil** (YÜKSEK)

- **Yer:** `electron/library-storage.ts:34, 43-44` (claim tarafı 96, 99-100) + `electron/main.ts:1046`
- **Kanıt:** kilit doğrudan dosyaya yazılır (temp+rename yok); yazım arızasında finally'deki `JSON.parse` SyntaxError fırlatır ve boş catch yutar → boş kilit diskte kalır. Sonraki her `locked()` çağrısı 34. satırdaki parse'ta ham SyntaxError alır (38. satırdaki anlaşılır mesaja bile varamaz); `claim()` dosyayı hiçbir koşulda temizlemez; main yalnız warn ile yutar. Tek seferlik yazım arızası, elle müdahale gerektiren kalıcı kilitlenmeye dönüşür.
- **İnce ayar:** "herkese kilitli" ifadesi yazım+sahiplik için geçerli; `load()` mevcut kütüphaneyi kilitsiz okumaya devam eder.

### 2.9 ✓ (dar pencere) **Ölü kilit devralma yarışı (TOCTOU): iki süreç aynı ölü kilidi birden alabilir** (YÜKSEK / risk)

- **Yer:** `electron/library-storage.ts:39-41` (claim tarafı 101-106)
- **Kanıt:** ESRCH saptaması ile unlink+`openSync('wx')` arasında atomik sahiplenme yok; Windows'ta FILE_SHARE_DELETE nedeniyle B, A'nın taze kilidini bile silebilir. İki tarafın `save()`'i de çakışma denetimini geçebilir → son yazan kazanır. **Düzeltme:** iddiadaki "en azından Backups kopyasında kalır" ayrıntısı yanlış — kaybeden tarafın yazdığı içerik hiçbir yedeğe düşmez, tamamen kaybolur (nüanstan daha ağır). Yarış penceresi ms-altı; iki örneğin çökme sonrası neredeyse eşzamanlı başlamasını gerektirir.

### 2.10 ~ **`applyPlan` üyelik kapanışı, motorun kasıtlı olarak yok saydığı "kutu üyesinden kutu dışına" kenarlarını kutuya üye yapıyor** (YÜKSEK)

- **Yer:** `electron/tool-edit.ts:457-470` · **Durum:** ~ kısmen
- **Doğrulanan ana iddia:** `while(buyudu)` kapanışı üye→dışarı kenarlarının hedefini koşulsuz ve geçişli olarak kutu üyeliğine alır (geometri/kapsam/port kontrolü yok; hata portundan çıkan kenarlar bile). Motor sözleşmesi aksini söyler: `runner.ts:202-204` ("An edge from a loop member to outside its scope does not leave the loop"), `enterable` (227-238), `runChain` (432-438 "Tur burada biter"). Böyle bir kenarı olan taban akışa giren **herhangi bir** plan (salt `patchNode` bile) türetilmiş grafikte dış node'u her turda koşturur; `step.run`/`run.from --branch`'ta masaüstünde gerçek etki, merge taşıması açıkken kullanıcı akışına yazılır.
- **Çürütülen alt iddia:** "kapanış yalnız kök düzey kutuları tarıyor" — değil; kapanış çağrıldığı grafik düzeyindeki tüm kutuları tarar ve her düzey kendi kapanışını alır (düzey-başına uygulama).

---

## 3. Orta önem — satır kanıtlı öne çıkanlar

- ◐ **Kimlikle devam sayısal kutularda fiilen çalışmıyor:** araç katmanı `"3"` yazar, motor `['#1','#2',…]` anahtarlarında arar → `runner.ts:506-508` "kayıtlı öğe yeni listede yok". (`tool-context.ts:100-105`, `graph-types.ts:577-582`)
- ◐ **Paket iç koşusunun `incomplete` bayrağı dışarı taşınmıyor;** üstelik kayıtlı çıkışı 'yok' portu olan paket başarılı çıkışına rağmen incomplete işaretleniyor (iki anlam tek bayrakta). Net sonuç: iç pakette yarım kalan iş resmî sonuçta `ok=true`. (`runner.ts:334-341, 185-194, 428, 686`)
- ◐ **Kayıtlı çıkışına ulaşamayan paket ("blocked") öğeyi "tamam" saydırıyor** — toplu koşuda eksik iş başarı gibi raporlanır. (`normalizeGraph`'ta `blocked` portu hiç var olamadığından bu sonuç ekstra şüpheli.)
- ◐ **Tekrarlayan hata kümesi koruması normal koşuda etkin değil:** `lastFail` her dış öğede sıfırlanıyor; imza koruması (`turImzalari`) yalnız debug koşusunda ve yalnız üst düzey kutuda. Kalıcı iç-döngü hatası yüzlerce öğeyi tek tek hatalı geçirebilir (§9 ihlali) + öğe başına ekran görüntüsü yazılıyor. (`runner.ts`)
- ◐ **Görüntü desteklemeyen model seçildiyse her GUI/görsel adımı 15 dakika boşa döngüde:** `ImageUnsupportedError` "kalıcı red" sayılmıyor; `chat()`'ın onu `ModelRejected`'e çevirmesi metne-dönüşü ve `onImageFallback`'i ölü kod yapıyor. (`openrouter.ts`, `llm-flow.ts`)
- ◐ **`recoveryToolTurn` yerel Ollama hedeflerine `reasoning_effort` göndermiyor** — 1.9.84'te ölçülen "düşünme → boş cevap" sorunu Yap/İnisiyatif onarım yolunda yeniden üretilebilir. (`main.ts:706` allowLocal yolu)
- ◐ **`validateTargetReply` id'yi doğrulamıyor:** geçersiz model numarası sessiz "hedef yok" olup metin eşleşmesine → yanlış tıklama riskine düşer; 0-1 normalize koordinatlar reddedilmeden sol üst köşeye nokta olur. (`openrouter.ts`)
- ◐ **`normalizePrompts` kullanıcı prompt'larını "Sen bir / Sadece JSON" kalıpları yüzünden kayıt sırasında sessizce siliyor** (ayar kalıcılığında veri kaybı). Ayrıca `globalShortcut.register` dönüş değeri yok sayılıyor → Ctrl+Shift+Q sessizce işlevsiz kalabilir. (`main.ts`, ipc ajanı)
- ◐ **dev scriptleri hata yolunda devam ediyor:** `dev-start-test.cjs` token'ı sildikten sonra kapatılamayan süreçte garanti başarısız başlatma yapar; `dev-seed-fixture.cjs` canlı örneğin altına depo yazabilir. UTF-8/parça-sınırı çözüm hatası `windows-tools.ts:35-36` ve `dev-scenario.cjs:113` ve benzerlerinde.
- ◐ **`runOneAction` sınırsız `timeoutMs` + runner'da sınırsız bekleme → tek eylem yuvası fiilen süresiz kilitlenebilir.** Yap ajanının `task_complete` kapısı "doğrudan işlem sonucunu incele" iznini hiçbir kod yolunda vermediği için doğrudan araçla biten iş başarısız node olarak raporlanabilir.
- ◐ **Tablet kenar-izi tur-sıfırlama mantığı PC'den (`run-progress.ts`) ayrışıyor:** paket/döngü çerçevesine yeniden girişte önceki turun kenarları yakmış kalmaya devam eder (`viewer-state.ts:29` + `model.ts:23`). Ayrıca `model.ts:12` her olayda (bir log satırı dahil) tüm koşu grafiğinin `structuredClone`'unu alıyor — uzun koşuda ölçülebilir CPU/pil maliyeti.

---

## 4. Alan alan özet (106 bulgunun dağılımı)

### runner + döngü + paket (10 bulgu)
Yukarıdaki 3.1-3.4 maddelerine ek: sınırlı bölge testi sınır node'u hata ile biterse durmuyor; gözlenen hata sayısı öğe başına iki kez artıyor; `boundaryPending()` hiç temizlenmiyor; boş-items'li klasör kutusu sayısal dala düşüp `{{öğe}}="1"` üretiyor; ayraçla biten yolda `{{öğe.ad}}` boş kalıyor. **Doğrulanmış sağlamlık:** iç kutu bitince dış tur değişkenleri `finally { vars = outer }` ile geri geliyor; klasörlü iç kutu her dış turda listeyi yeniden okuyor; kimlikle devam liste kutularında kayıttan bağımsız; durdurma `interruptibleSleep` ve zincir başı kontrollerle çalışıyor.

### hedef + girdi + eylem (14 bulgu)
§2.2-2.5'e ek not düzeyinde: koşul `conditionWindow` yolu `readOnly:false` ile odak çalıyor; `conditionWindow+uia` kanıtı yalnız `type:"Text"` öğelerle sınırlı (düğme yazısını görememe); simge hafızası çoklu monitörde 0-1 dışına taşıyor; type yürütücüsünde daima false olan `confirmed/saveMemo` ölü kodu; worker'ın geri okuduğu `TypeResult.value` hiçbir yerde tüketilmiyor; `hoverDecision` yalnız testlerde kullanılıyor; `guiReplace` ölü değişkeni; `deferOnnx/discardShot` erişilemeyen yolu. **Doğrulanmış sağlamlık:** kelime adaylarının `parentId` ile geri eşlenmesi doğru (`openrouter.ts:563-566`); popup kapatma tek seferlik ve geciken model cevabı `checkStopped`'a takılıyor; `ensureActed` aynı komutu iki kez göndermiyor; shots/hata klasörleri sınırlı büyüyor; koşu tek kapıyla sıralanıyor.

### PowerShell worker (13 bulgu)
`screen.ps1:57-61` `Wait-WinRt` sonsuz bekleyişi worker'ı dondurabilir (köprü zaman aşımıyla kurtulur ama istek+worker kaybı olur); ana Windows OCR motorunda `RecognizeAsync` hatası yakalanmadığından tek OCR hatası bitmiş scan sonucunu düşürüyor (CJK motorları korunuyor — asimetri kesin); `Focus-Input`'ta `INPUT_CLICK_OCCLUDED` throw'u aynı try'nın boş catch'iyle yutuluyor (koruma hatası ölü, tıklama yine atlanır); **üç .ps1 BOM'suz UTF-8 olduğu için PS 5.1 bunları ANSI okur — Türkçe hata dizeleri mojibake**; `XpText.CanType` ANSI `VkKeyScan` kullanırken kardeşi `VkKeyScanW` — kod sayfası uyuşmazlığında yanlış karakter sessizce yazılabilir. Notlar: korumalı typeText yolu + needChoice/fieldToken üretimde ölü (köprü `keyboard:true` sabit); pixelCap 12MP koşulu ölü; snap yuvarlama overlay ölçeğiyle uyuşmuyor; FindAllBounded iş parçacığı sızıntısı; köprü timeout kill'inde basılı modifier/fare düğmesi yapışma riski. **Çürütülenler (ajan kendi şüphesini çürüttü):** [bool] dizi dönüşümü, Console OutputEncoding BOM'u, Convert-TiltRect yönü, Shrink taşmaları. **OCR koordinat dönüşümlerinde (ölçek bölmesi, 90° geri dönüşüm) matematiksel hata bulunamadı.**

### model katmanı + yerel yönlendirme (12 bulgu)
§3'teki maddelere ek: `usedImage` iç fallback sonrası yanlış raporlanıyor; "Sadece JSON" içeren kayıtlı özel promptlar yüklenirken sessizce atılıyor; `warmOnnx` ilk geçici hatada oturum boyu ölü kalıyor; json-retry kararı kırılgan regex'le veriliyor. **Doğrulanmış sağlamlık:** `guardedFetch`, `stoppableWait`, 90° döndürme koordinatları, CTC decode, NCHW tensor düzeni, `setLocalEndpoint` yenilenmesi — somut hata yok.

### IPC + ayarlar + kalıcılık (8 bulgu)
§2.1, §2.6, §3'e ek: saniye çözünürlüklü koşu günlüğü adı çakışması; bozuk kilit dosyasının kayıt yolunu opak hatayla tıkaması; not düzeyinde viewer port hash çakışması ve `viewer:manage` disable/`ensureViewer` yarışı. **Doğrulanmış sağlamlık:** will-quit/before-quit temizliği, atomik kütüphane yazımları, tool-http ve viewer-server sınırları hatasız çıktı.

### köprü + harness + scripts (10 bulgu)
§3'e ek: dev-scenario hata temizliği yanlış profil/jeton dosyasına gidebilir; `a11y-bridge` send()'de dar kayıt-yarışı ölü işçiye karşı tam zaman aşımı bekletir; not düzeyinde dev-scenario önekli branch temizliği, dev-status EPERM tutarsızlığı, tool-http aşırı-gövde yolunun yıkılmış sokete yazması. **Doğrulanmış sağlamlık:** Worker sıralaması/zaman aşımı tasarımı bridge-browser testiyle iyi kapsanıyor; dev-safe/dev-idle taşma aritmetiği doğru; jeton dosyası tek yazıcı; profile adı her iki kopyada tutarlı; scenario dosya kökü sembolik bağlantıyı da reddediyor.

### kütüphane + SQLite + bölümler (12 bulgu)
§2.7-2.9'a ek orta düzey: çakışma-dışı kütüphane hatasının oturum yazımını da düşürmesi; bölüm'süz klasörün iki ağaçta da görünmemesi (koddaki yorum/belge/test başlığıyla çelişir); restore/open yollarının `windowSave`'i bypass edip branches kayıtlarını silmesi (§2.1 ile birleşir); `claim()` yazım hatasının süreci kendi kilidine hapsetmesi; PID yeniden kullanımında sonsuz kilit. Notlar: karışık dal taşımada içerik-bölüm uyumsuzluğu; `newFolder` tekrar-ad denetiminin yanlış bölüme bakması; `aktifTalepNonce` tek-global-yuva yarışı; her kayıtta tam yedek+fsync ile 30 yedek derliğinin tükenmesi. **sql.js WASM paketleme tarafında (asar + require.resolve) somut kusur kanıtı yok.**

### Yap node + araç katmanı (10 bulgu)
§2.10 ve §3'e ek: `graphStamp` volatile alanları yalnız kök düzeyde temizlediği için paket içi koşu durumu (items/loopIndex/memory) her koştan sonra "temel tuval değişti" yanlış alarmı üretiyor; `branch.merge` `viewBranch`'in bayat yol güvencesini bypass edip eski path ile silme listesi üretebiliyor (applyMerge kapalı olduğundan silme yolu latent); `flow.suggest` var olmayan packagePath'te köke sessiz düşüyor; `flow.edit` bozuk packagePath'i sessizce başka düzeye yazıyor; ölü `actFields` saplaması; HTTP'de gövde-boyut mesajının yutulması ve `startEndpoint` yarışı. **Doğrulanmış sağlamlık:** boş branchId koruması, tek-adım yuvasının senkron talebi, `run.stop` neden etiketi, HTTP'nin 127.0.0.1+jeton+graph-silme kapısı doğru çalışıyor.

### tablet / görüntüleyici + android (11 bulgu)
§3'e ek düşükler: WS upgrade'da jeton/origin yokken 12 slotun jetonsuz doldurulup gerçek tablet bağlantısının engellenebilmesi (`viewer-server.ts:25` — istismar da mümkün, DoS da); disable/ensureViewer yarışı; sunucunun 1008 kodunu yanlış jeton ve 5 sn eşleşme zaman aşımı için birlikte kullanması (istemci geçici gecikmeyi kalıcı eşleşme hatası sanıyor); Android `onReceivedError`'da ERR_ABORTED ayrımı yok (çalışan sayfa hata sayfasına dönebilir); tailscale serve boş çıktıda JSON.parse patlaması; **tablet Arşiv düğmesi Otomasyonlar modunda işlevsiz** (`ViewerApp.tsx:36` + `LibraryTree.tsx:29`); `run.from` canvasId göndermediğinden tablette koşu adı hep "Çalışan tuval"; Android QR yalnız 0°/90° deniyor (180°/270° tutuşta başarısız); `setBook` her çağrıda tüm kitabı WS'ye yolluyor. **Doğrulanmış sağlamlık:** hata-koru mantığı sunucu/istemci arasında birebir tutarlı; Android QR döndürme matematiği ve gesture ankraj/zoom matematiği satır satır doğrulandı.

### performans + uzun koşu (6 bulgu)
§2.5, §3'e ek: zaman aşımıyla öldürülen worker'ın ~8 MB BGRA raw+preview dosyaları bir sonraki açılışa kadar %TEMP'te kalıyor (süpürme yalnız startApp'te bir kez); sürüm başına log klasörleri hiç temizlenmiyor; HUD yükleme takılırken `did-finish-load` dinleyici birikimi; koşu sırasında her `agent:patch` tüm `config.json`'ın senkron yeniden yazımını tetikliyor. **Doğrulanmış sağlamlık:** tüm büyüme sınırları temiz — `MEMO_KEEP=5`, STEP/LOG ring, `MAX_SHOTS=10`, recovery 100, kütüphane yedek 30; model zinciri 15 dk/256 tur/8 red; Yap ≤60 adım; renderer listener temizlikleri tamam.

### renderer/UI (ajan null döndü — kısmi, elle doğrulanmış)
- ✓ ViewerApp (`src/viewer/ViewerApp.tsx:36`) hâlâ eski Kütüphane/Arşiv araç çubuğunu kullanıyor — masaüstündeki üç-sekme tasarımıyla (Tuvaller / Arşivlenmiş Tuvaller / Otomasyonlar) ayrışıyor; arşiv kavramı otomasyonlara da sızıyor (masaüstünde otomasyon bölümünde arşiv YOK).
- ✓ **Ölü proplar:** `CanvasLibrary`'de `tabs` (satır 16), `recovery` (24) ve `onAskCanvasSave` (21) bildirilmiş ama bileşen içinde hiç kullanılmıyor; `App.tsx:1672` hâlâ `onAskCanvasSave` geçiriyor.
- ✓ **Ölü CSS:** `.automation-card` sınıfı hiçbir bileşende kullanılmıyor (`xp.css:2118,2152` + `workspace.css:157-158`); `--tab-hue` tamamen temizlendi (1.9.93 hedefi tuttu).
- ✓ Çakışma durumu hâlâ yalnız günlükte (`App.tsx:303-308`); arayüzde banner yok.

---

## 5. Çürütülenler ve sağlam bulunanlar (öz)

- ✗ "kapanış yalnız kök düzey kutuları tarıyor" (§2.10 alt iddiası)
- ✗ "yarışta kayıp en azından Backups kopyasında kalır" (§2.9 düzeltmesi — kayıp tam)
- ✗ PS worker'da şüphelenilen [bool] dönüşümü, OutputEncoding BOM'u, Convert-TiltRect yönü, Shrink taşmaları (ajan kendi şüphesini kodla çürüttü)
- ✓ Sağlam çıkan başlıca alanlar: OCR koordinat matematiği (ölçek/tilt), guardedFetch/stoppableWait/90° geri dönüşüm, viewer-server sınırları (loopback+jeton+GET-only+traversal koruması), bridge sıralama tasarımı, dev-safe GetLastInputInfo aritmetiği, hafıza/ring/yedek büyüme sınırlarının tamamı, will-quit temizliği, döngü bağlamı dönüşü ve durdurma zinciri.

## 6. Örüntüler (sistemik)

1. **Yutulan hata yolları (boş catch):** worker.ps1 direct tuş dalı, Focus-Input koruması, %TEMP% süpürmesi, kilit finally'si, HUD dinleyicisi. Hata yolları sessizce yanlış-durum üretiyor.
2. **Sözleşme-uygulama ayrışması:** ensureActed "asla hata yapmaz" / §17 "yalnız doğrulanmış hedef hafızaya" / "iki yazar" / §9 "kalıcı hata listeyi tüketmemeli" — dördü de kodda bir bileşim ya da dal yüzünden kırılıyor. Doküman doğru, kod kayıyor.
3. **Kilitleme atomikliği:** kilit yazımı atomik değil + TOCTOU devralma + PID-canlılık yok (kütüphane kilidi ve %TEMP% süpürmesi aynı ailenin iki üyesi).
4. **Uzun koşu maliyeti:** koşul bekleme seli, grafik structuredClone, öğe başına screenshot, log klasörleri — hepsi saatler süren koşularda ölçeklenen maliyetler.
5. **Yeniden tasarım sonrası entegrasyon boşlukları:** 1.9.93 üç-sekme tasarımı masaüstüne oturmuş ama ViewerApp'te eski haliyle kalmış; ölü proplar/ölü CSS eski tasarımdan artıklar.

## 7. Bilinen açık kalemler (bu taramayla birleşen defter)

- Tablet ViewerApp üç-sekme tasarımına geçmedi (✓ yeniden teyit); tablette Arşiv düğmesi Otomasyonlar modunda işlevsiz.
- Klavye/erişilebilirlik: ağaç ok tuşları, çoklu-seçim tabIndex, bağlam menüsü odağı, Home/End.
- Ağ paylaşımında PID denetimi anlamsız; PID yeniden kullanımı kalıcı kilit (✓ kodda teyit); ikinci Nubbo penceresi hedef olabilir (✓ ownPid koruması yalnız kendi penceresini kapsıyor — `windows-tools.ts:66`).
- `dev-start-test.cjs` "tek temiz örnek" sözünü kapatılamayan sürecin hata yolunda tutmuyor (✓).
- APK imzası hâlâ kullanıcı anahtarına bağlı; çakışma durumu arayüzde banner'sız (✓); canlı iki-örnek/çakışma senaryosu test edilmemiş.
- 20 atlanmış test (§1 ölçümler) — inisiyatif motorunun emekli kapsamı + kaldırılan kurtarma paneli.

## 8. Önerilen düzeltme sırası (değişiklik yapılmadı; onay istenirse sıra budur)

1. **§2.1 iki-yazar bileşimi** — tek satırlık görsel düzeltme (`storeWorkspace` içinde `windowSave`'in branch'leri yazan kitaptan alması); araç katmanı branch kalıcılığı geri gelir. En yüksek kazanç/en düşük risk.
2. **§2.7 reload→adoptBook** — dış yazarın ezilmesi veri kaybıdır.
3. **§2.8 + §2.9 kilit sağlamlaştırma** — atomik kilit yazımı + parse-kurtarma + ESRCH sonrası yeniden-oku.
4. **§2.3 inputState try/catch** — tek guard, sözleşmeyi geri koyar.
5. **§2.5 koşul beklemesi bütçesi** — yineleme başına tarama/model sıklığı sınırı.
6. **§2.6 %TEMP% süpürmesi canlılık denetimi** — rmSync öncesi pid/exe kontrolü.
7. **§2.2 tuş dalı ön-pencere denetimi** — §19 kapsamıyla ilişkilendirildiği için kullanıcı kararı gerekir.

---

*Rapor tamamen yalnız-okuma taramadan üretildi: repo ağacında yalnızca bu dosya eklendi; hiçbir kaynak dosya değiştirilmedi, commit/push yapılmadı.*
