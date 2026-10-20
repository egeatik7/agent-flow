# Oturum değişiklikleri — 1.9.162 → 1.9.169

Bu belge, 20 Ekim 2026 oturumunda **agent-flow/agent-flow** deposunda yapılan her değişikliği
sürüm sürüm, dosya dosya listeler. Kaynak: git geçmişi (`bbfb42a..b1b9738`) ve bu oturumda
çalıştırılan geçit komutlarının çıktıları.

| | |
| --- | --- |
| Depo | `C:\Users\ASUS TUF\agent-flow\agent-flow` (uzak: `origin`) |
| Başlangıç | `bbfb42a` — 1.9.161 (tarama `1.9.159 + 14e39aa` üzerinde başladı, repo tarama sırasında 1.9.160/161'e ilerledi) |
| Bitiş | `b1b9738` (docs) · son ürün commit'i `f68dd14` — 1.9.169 |
| Dal | `main`, temiz ağaç, `origin/main` ile aynı |
| Yayın | 8 sürüm, 8 etiket (`v1.9.162`…`v1.9.169`), 8 portable EXE masaüstünde |

## 0. Özet

| Sürüm | Tema | Ürün commit'i | Etiket | Vitest | Dosya | +/− |
| --- | --- | --- | --- | --- | --- | --- |
| 1.9.162 | Gözlemlenebilirlik işi durdurmaz; koşu/rapor dürüstlüğü | `3fd41d7` | `v1.9.162` | 193 / 1471 | 34 | +1058 / −61 |
| 1.9.163 | Giriş yolu: etiket→alan, Ctrl+A geri düşüşü, gözlem eylemi engellemez | `b47e64a` | `v1.9.163` | 193 / 1472 | 10 | +144 / −12 |
| 1.9.164 | Denetim düzeltmeleri: sonsuz tur, sessiz başarı, tuş yazımı, merge kimliği | `a4f6f00` | `v1.9.164` | 194 / 1481 | 17 | +355 / −51 |
| 1.9.165 | Checkpoint NDJSON, paket içi hedef seçici, piksel döngüleri native | `7034bf0` | `v1.9.165` | 195 / 1483 | 16 | +236 / −53 |
| 1.9.166 | Rapor dürüstlüğü, merge hedefi, kurtarma taslakları, güvenlik sınırları | `c7ae76e` | `v1.9.166` | 195 / 1486 | 14 | +173 / −30 |
| 1.9.167 | Sayaç dürüstlüğü, Bitir ekleme koruması, işaretçi doğrulaması | `bed7cb7` | `v1.9.167` | 197 / 1490 | 11 | +147 / −7 |
| 1.9.168 | Durdur her zaman çalışır, hafıza kanıt ister, checkpoint kesintisi görünür | `ff52b74` | `v1.9.168` | 198 / 1492 | 9 | +132 / −19 |
| 1.9.169 | Tek adımda Durdur, HUD bellek kartı, tuval menüsü, döngü listesi | `f68dd14` | `v1.9.169` | 198 / 1492 | 6 | +57 / −13 |

Docs-only commit'ler: `e08b482`, `75479e8`, `a0e2fc7`, `59b18da`, `b240045`, `b1b9738` (aşağıda §9).

## 1. 1.9.162 — `3fd41d7` (34 dosya, +1058/−61)

**Amaç:** Taramanın kritik ve yüksek bulgularının ilk partisi: koşuyu kilitleyen hatalar, checkpoint
yazımının koşuyu öldürmesi, yanlış raporlama ve kaynak sızıntıları.

### 1.1 Koşu/kilitlenme
- `electron/runner.ts` — `PermanentStepError` sınıfı; eylem dışı node'larda (Koşul/Paket/kaldırılmış
  tür) kalıcı hata artık tur döngüsüne girmez; paket içi hata `PermanentStepError`'a sarılır (paket
  baştan oynatılmaz, içindeki tıklama/yazma ikinci kez gitmez); checkpoint çağrısı `captureCheckpoint`
  ile korunur (`EndFlow`/`incomplete` düzeltmesi 1.9.163'te).
- `electron/method-cycle.ts` — `repeatMethodCycle`'a `maxRounds` eklendi; verilmezse davranış aynı.
- `electron/agent.ts` — Koşul yöntem turu `maxRounds: 4`; eylem öncesi/sonrası tarama hataları
  eylemi engellemez (sonuç "doğrulanamadı" sayılır, adım hata olmaz); `ConditionUndecidedError`
  runner'a ulaşır.

### 1.2 Checkpoint
- `electron/checkpoints.ts` — `renameWithRetry` (EPERM/EBUSY/EACCES, 12 deneme) + yarım `.tmp`
  temizliği; `pruneCheckpoints` (400 çift / 7 gün); `list()` bozuk/kilitli dosyayı atlar ve bir kez
  uyarır; `detail()`/`snapshot()` anlaşılır hata verir.
- `electron/main.ts` — koşu başında `begin`/`mark` try/catch; checkpoint başlatılamazsa koşu
  checkpoint'siz sürer (uyarı yazılır).

### 1.3 Rapor ve araç katmanı
- `electron/tools.ts` — `run.from` hazırlık hatasında "Koşu başladı" demez (`setImmediate` sonrası
  `startError` kontrolü); `resumeItemMismatch` (klasör beslemeli kutuda karşılaştırma yok);
  `assertModelKeysAllowed` `act.key` yoluna bağlandı.
- `electron/main.ts` — durdurulan koşunun sayaçları (`steps`, `failed`) korunur; merge zaman aşımı
  `ambiguous: true` döner.
- `electron/a11y-bridge.ts` — `clickCurrentAt` worker sonucunu (`warning`) döndürür.
- `electron/agent.ts` — görsel tıklama uyarısı günlüğe yazılır.

### 1.4 Girdi, kilit, kaynak, güvenlik
- `electron/recovery-runtime.ts` — modelin canlı tuş eylemi `assertModelKeysAllowed`'dan geçer.
- `electron/library-lock.ts` — `unlinkRetrying`; kendi PID'imizle kalmış kilit (çökme) devralınır;
  bırakma hatası çağrıyı hataya çevirmez.
- `electron/send-log.ts` — `pruneEvidence` (200 klasör / 7 gün) + dakikada bir budama.
- `electron/yap-context.ts`, `electron/openrouter.ts` — Yap giriş bütçesi bayt yerine token
  karşılığıyla kıyaslanır.
- `electron/window-close.ts`, `electron/main.ts`, `electron/preload.ts`, `src/App.tsx`,
  `src/types.ts` — kapanış kalp atışı (`closeProgress`): kullanıcı kaydetme diyaloğunda 10 sn
  sonra pencere zorla kapanmaz; arayüz çökerse sayaç yine dolar.
- `electron/instance-marker.ts` (yeni), `electron/temp-sweep.ts`, `electron/main.ts` — portable
  örnek PID işaretiyle klasörünü sahiplenir; başka örnek onu "bayat" diye silmez.

### 1.5 Testler (yeni/güncel)
`tests/checkpoint-retention.test.ts` (6), `tests/runner-terminal-errors.test.ts` (7),
`tests/model-key-guard.test.ts` (23), `tests/resume-item-check.test.ts` (4),
`tests/library-lock-release.test.ts` (4), `tests/evidence-retention.test.ts` (3),
`tests/window-close-heartbeat.test.ts` (3), `tests/yap-budget-units.test.ts` (5),
`tests/instance-marker.test.ts` (3); güncel: `checkpoint-runner`, `method-cycle-persistence`,
`bug-hunt`, `temp-sweep`.

### 1.6 Yayın
EXE: `Nubbo-1.9.162.exe` · SHA256 `63305897E321379612CB9E23DF87DE8D9FB7FD2B23C7E2C4F859F58DB4895CC8`

## 2. 1.9.163 — `b47e64a` (10 dosya, +144/−12)

**Amaç:** Giriş yolunda yanlış alana yazma ve gözlem hatasının eylemi kesmesi.

- `a11y/worker.ps1` — **H1:** klavye dalında, tıklama noktası verildiyse ve odak yazı alanı değilse
  komşuluğundaki **tek** yazı alanı bulunup odaklanır (eylem; ret yok). **H2:** `^a → DEL` sonrası
  alan okunur; metin kaldıysa `EM_SETSEL` ile seçilip yeniden silinir; `cleared` gerçek okumaya göre
  yazılır.
- `electron/agent.ts` — `ensureActed` öncesi/sonrası tarama try/catch; tarama hatası tıklamayı
  engellemez, başarılı tıklamayı `haltLoop`'lu hataya çevirmez.
- `electron/runner.ts` — Bitir'e ulaşıldığında `summary.incomplete` korunur.
- `electron/main.ts` — Durdur kısayolu kaydı başarısızsa uyarı (1.9.168'de kalıcı kayda taşındı);
  koşu bitince model kronometresi durur.
- `electron/tools.ts` — `act.wait` süresi `ms + 30 sn` (60 sn tavanına takılmaz).
- `electron/memory-meter.ts` — boş/timeout PowerShell çıktısı "başarılı boş ölçüm" sayılmaz.
- `scripts/test-stability-main.cjs` — harness'e `durdurHudStopwatch` yüzeyi eklendi (runFlow çağırıyor).
- Test: `tests/runner-terminal-errors.test.ts` genişletildi.

EXE: `Nubbo-1.9.163.exe` · SHA256 `C556F0A04CC079D734FF0C3866C929F0BB8FD2CA2613987BCCECBC9DCEA786FD`

## 3. 1.9.164 — `a4f6f00` (17 dosya, +355/−51)

**Amaç:** 37 ajanlık denetimin 12 yüksek bulgusundan 9'u. Ayrıntılı rapor:
`docs/bug-taramasi-1.9.164.md`.

- `electron/runner.ts` — Koşul'un **ham** executor hatası artık sınırlı (3 tur) ve kalıcı hata
  sınıfında; kutu içinde "karar verilemedi" sessizce "hayır" sayılmaz (öğe hatası); `readFolder`
  en çok 3 tur dener.
- `electron/agent.ts` — eksik API anahtarı/yerel model hatası `PermanentStepError`.
- `electron/tools.ts` — klasör beslemeli kutuda "Liste değişmiş" karşılaştırması yapılmaz.
- `a11y/worker.ps1` — etiket→alan çözümü **odak türüne bakmadan** çalışır (odakta başka yazı alanı
  olsa bile); `finally`'deki klavye temizliği hatası sonucu ezmez, `warning` olarak eklenir.
- `electron/agent.ts`, `electron/main.ts`, `electron/tools.ts` — tarama hatası "BAKILMALI"
  sınıflandırmasına girer (`tarama yapılamadı` / `tepki doğrulanamadı`).
- `electron/key-guard.ts` — basış bazlı `keyChords`: `^w`, `^q`, `^+{w}`, `%{F4}`, `^%{F4}`,
  `{ESC}{DELETE}` engelli; `ctrl+s`, `win+r`, `enter` serbest.
- `electron/main.ts`, `electron/preload.ts`, `src/App.tsx`, `src/types.ts` — merge yanıtı `branchId`
  taşır; ZIP kaydı başarısızsa `ambiguous: true`.
- `electron/yap-context.ts`, `electron/openrouter.ts` — bütçe 3 bayt/token + 1024 pay (sığan istek
  önden reddedilmez).
- Testler: `tests/runner-new-bounds.test.ts` (3), `model-key-guard` (23), `yap-budget-units` güncel.

EXE: `Nubbo-1.9.164.exe` · SHA256 `A6A3EC63C5D95EFAB15B8BA7051400F4D9C3AF91D342A1E0E75DE1220A445325`

## 4. 1.9.165 — `7034bf0` (16 dosya, +236/−53)

**Amaç:** Kalan üç yüksek: checkpoint O(n²), panel render, paket içi hedef seçici, piksel döngüleri.

- `electron/checkpoints.ts` — çıktılar append-only `<id>.outputs.jsonl`; checkpoint JSON'u yalnız
  meta (`metaOf`); `detail()` NDJSON + eski JSON ile uyumlu; `prune` `.outputs.jsonl`'u da siler.
- `src/components/CheckpointsPanel.tsx` — ilk 300 satır + "Daha fazla göster" (10.000+ satırda
  ~50 bin DOM düğümü donması bitti).
- `src/components/SidePanel.tsx`, `src/App.tsx` — paket içi Tıkla/Yazı Yaz için **İmleçle Yakala**
  ve **Ekrandan Seç** iç node'a yazar (`onCapturePackaged`, `onOpenScannerPackaged`; scanner durumu
  `pkgId` taşır; `updatePackaged` kullanılır).
- `a11y/screen.ps1` — kare çekilmeden önce opak siyahla doldurulur (alfa 255 → `Set-BitmapOpaque`
  örnek kontrolüyle anında döner; ölçüm ~2,8 sn → ~4 ms); 32→24 dönüşüm GDI+ `DrawImage`
  (~9,2 sn → ~8 ms).
- Hızlı orta bulgular: `library-lock.ts` unlink retry ~3,25 sn → ~0,6 sn; `send-log.ts` budama
  `setImmediate`; `instance-marker.ts` 24 saatten eski işaret bayat; `tools.ts` `act.wait` doğrulama
  + 30 dk sınırı; `zip-library-storage.ts` geçici dosya temizliği kilitliyse hata döndürmez;
  `tool-http.ts` `starting` kilidi (eşzamanlı iki dinleyici yok); `App.tsx` yakalama sürerken koşu
  başlatılamaz.
- Testler: `tests/checkpoint-ndjson.test.ts` (1), `checkpoint-retention` NDJSON testi (+1).

EXE: `Nubbo-1.9.165.exe` · SHA256 `F46D1306DC27B32689DE16F7B4EAE51503E75A60D67F78056CA6C4573789FBA6`

## 5. 1.9.166 — `c7ae76e` (14 dosya, +173/−30)

**Amaç:** Denetimin kalan orta bulguları: merge hedefi, Durdur semantiği, taslak birikmesi, güvenlik.

- `src/App.tsx` — merge hedefi girişte sabitlenir; beklemelerden (AI kopyası/ZIP) sonra sekme
  değişmişse yazılmaz; merge sırasında `libraryBusy` kilidi; işleyici hatası anında main'e bildirilir
  (1.9.168'de `.catch` eklendi).
- `electron/tools.ts` — `act.*` Durdur: girdi gittiyse `eylem-belirsiz + sent:true` ("tekrar
  gönderme"), gitmediyse `durduruldu`; `target.preview` başlamadan `clearStop()`.
- `electron/runner.ts` — paket sarmalaması `runnerSaydi`/`haltLoop`/`serviceFailure` işaretlerini
  korur (failed=2 bitti); koşul kurtarmasına `vars` aktarılır.
- `electron/canvas-session.ts` — kurtarma taslakları: aynı tuval (savedId/ad) tek kayıt, en yeni 20
  (`MAX_RECOVERY_DRAFTS`).
- `electron/viewer-server.ts` — Origin denetimi (yalnız 127.0.0.1/localhost).
- `electron/main.ts` — HUD `keepOnTop` interval'i `destroyHud`'da temizlenir; 1.9.166'da hata
  yollarına log eklendi.
- `electron/agent.ts` — `memo.win` gerçek pencere adı (`scan.window`), yöntem adı değil.
- `electron/zip-library-storage.ts` — `link/unlink` ve silme için `retrySync` (EPERM/EBUSY/EACCES).
- `electron/library-path.ts` — korumalı kökteki kayıtlı yol artık yoksa korumasız profile düşer.
- `scripts/dev-start-test.cjs` — ürünle aynı işaret dosyası kuralı (çalışan örneğin klasörü silinmez).
- Testler: `zip-library-path` (+2), `runner-terminal-errors` (+1: paket hatası tek sayım).

EXE: `Nubbo-1.9.166.exe` · SHA256 `90F82285FC4DFE16D663BCD722EBEC26E2F3A8BA8E5FDA48B32F1205B0D144DD`

## 6. 1.9.167 — `bed7cb7` (11 dosya, +147/−7)

**Amaç:** Sayaç dili, Bitir ekleme koruması, süre alanı, aday kırpması, kanıt saklama, işaretçi.

- `electron/tools.ts` — `run.state` "Gözlenen adım olayları" (bir öğe hatası iki olay üretebilir);
  resmî sonuç satırı öğe/tur sayısını ayrı söyler.
- `src/lib/graph-ops.ts` — çıkışsız tür (Bitir) araya eklenirse graf değişmez, `id: ''` döner;
  `src/App.tsx` kullanıcıya "Bitir'i akışın sonuna ekle" uyarısı verir (iki ekleme yolunda).
- `src/components/SidePanel.tsx` — `TimeoutField`: "Süre sınırı" taslak değerle yazılır, 10–900
  sınırı odaktan çıkınca/Enter'da uygulanır (120 yazınca 900 kaydı bitti).
- `electron/openrouter.ts` — 400'lük aday kırpması notu tıkla/yaz promptunda da görünür.
- `electron/send-log.ts` — `EVIDENCE_KEEP` 200 → 1000 (yoğun saatte ~9 saat; 7 gün yaşı sınırı aynı).
- `a11y/screen.ps1` — `Invoke-MouseAt`: `SetCursorPos` sonucu ve ClipCursor kırpması doğrulanır;
  imleç hedefe ulaşamazsa (bir yeniden denemeden sonra) tıklama gönderilmez, `INPUT_CLICK_STALE`.
- Testler: `tests/canvas-session-drafts.test.ts` (2), `tests/graph-ops-end-insert.test.ts` (2).

EXE: `Nubbo-1.9.167.exe` · SHA256 `0C91B6EBC70EA596DBA6C35224E693A50A96722296986BC9A459F75D045D832E`

## 7. 1.9.168 — `ff52b74` (9 dosya, +132/−19)

**Amaç:** Durdur'un her durumda çalışması, hafıza kanıtı, checkpoint kesintisinin görünmesi.

- `electron/main.ts` — Durdur kısayolu **uygulama ömrü boyunca** kayıtlı (tek eylem pencereyi
  gizlediğinde de çalışır); koşu içindeki register/unregister kaldırıldı; kayıt başarısızsa uyarı.
- `electron/agent.ts` — Yazı Yaz yolunda hafıza yalnız kanıtla yazılır: alanın geri okuması yazılanla
  eşleşmeli ya da kullanıcının seçtiği `locator` olmalı.
- `electron/checkpoints.ts` — yazım kesintisinde `.resume-unreliable.json`; `detail()` issues'a
  "buradan devam ederken öğeler yeniden çalışabilir" ekler; yeni koşuda işaret silinir.
- `src/App.tsx` — merge işleyicisi fırlatırsa hata main'e hemen gider (`replyAgentGraph` catch).
- `electron/main.ts` — `loadURL`/`loadFile` reddi günlüğe + önyükleme satırına yazılır.
- `electron/viewer-server.ts` — 12 izleyici sınırı jeton doğrulamasından **sonra**; bağlantı sayısı
  64 ile sınırlı.
- `scripts/test-stability-main.cjs` — kısayol kancası koşudan çıkınca geçersiz kalan temizlik
  senaryosu `hideHudSoon` üzerinden yeniden kuruldu.
- Test: `tests/checkpoint-unreliable.test.ts` (2).

EXE: `Nubbo-1.9.168.exe` · SHA256 `47CD8B107CDDADE243D82D25D48562F38A79EA9BCBC7AB2B2C7B9315424488E1`

## 8. 1.9.169 — `f68dd14` (6 dosya, +57/−13)

**Amaç:** Son küçük bulgular.

- `electron/tools.ts` — `run.stop` tek adım sürerken "koşu yok" demez; "süren tek adım iptal
  edildi" der ve durdurmayı kullanıcı olarak işaretler.
- `electron/main.ts` — koşu bitince HUD bellek kartı temizlenir (`bellekKartiniTemizle`, `{kart:null}`).
- `src/components/NodeCanvas.tsx` — sağ tık menüsü `scale()` katmanında küçülmez (karşı ölçek).
- `src/components/SidePanel.tsx` — döngü listesi dolu-konum taraması bir kez (satır başına O(n) →
  O(1), toplam O(n)); binlerce öğede tuş/sürükleme donması bitti.

EXE: `Nubbo-1.9.169.exe` · SHA256 `47BEE86DC8F58C86C19F46E88034D9017013007811DC727AB6A084389CCB6308`

## 9. Belgeler (docs-only commit'ler)

- `docs/bug-taramasi-1.9.161.md` (`3fd41d7` içinde) — ilk tarama raporu: 1 kritik, 20 yüksek,
  40 orta/düşük; dosya:satır, etki, düzeltme.
- `docs/surum-notu-1.9.162.md` … `docs/surum-notu-1.9.169.md` — her sürümün ne/niçin/doğrulama/sınır
  metni.
- `docs/bug-taramasi-1.9.164.md` (`a4f6f00` içinde) — 37 ajanlık düzeltme denetimi + yeni bulgular;
  §6–§10 sürüm sürüm durum ve kapanış özeti.
- §Durum güncellemeleri: `e08b482`, `75479e8`, `a0e2fc7`, `59b18da`, `b240045`, `b1b9738`
  (raporlardaki "kapandı/açık" tablolarının güncel tutulması).

## 10. Ek — dosya dosya değişiklik dizini

| Dosya | Sürümler | Değişiklik özeti |
| --- | --- | --- |
| `electron/runner.ts` | 162, 163, 164, 166 | `PermanentStepError`, paket sarmalama + işaret koruma, checkpoint guard, `EndFlow` incomplete, koşul ham hata sınırı, kutu içi belirsiz koşul hatası, `readFolder` 3 tur, koşul kurtarmasına `vars` |
| `electron/agent.ts` | 162, 163, 164, 166, 168 | tarama koruması, `PermanentStepError` (anahtar yok), hafıza kanıtı, `memo.win`, önizleme/`ensureActed` |
| `electron/checkpoints.ts` | 162, 165, 168 | rename retry, saklama, `list`/`detail` toleransı, NDJSON meta/detay, kesinti işareti |
| `electron/main.ts` | 162, 163, 164, 166, 168, 169 | checkpoint guard, sayaçlar, merge `ambiguous`, kısayol (önce uyarı, sonra kalıcı), HUD sayaçları/kart, yükleme hataları, viewer/tesis |
| `electron/tools.ts` | 162, 163, 164, 166, 167, 169 | `run.from`, `resumeItemMismatch`, `act.wait`, Durdur semantiği, önizleme stop, Bitir/uyarı, `run.stop`, tarama sınıfı |
| `electron/method-cycle.ts` | 162 | `maxRounds` |
| `electron/key-guard.ts` | 164 | basış bazlı `keyChords`, ek engelli kombinasyonlar |
| `electron/openrouter.ts` | 162, 164, 167 | bütçe birimi, aday kırpma notu |
| `electron/yap-context.ts` | 162, 164 | `yapBudgetCheck` birim dönüşümü |
| `electron/a11y-bridge.ts` | 162 | `clickCurrentAt` uyarı dönüşü |
| `electron/recovery-runtime.ts` | 162 | model tuş koruması |
| `electron/library-lock.ts` | 162, 165 | unlink retry, kendi PID devralma, kısa blokaj |
| `electron/send-log.ts` | 162, 165, 167 | budama, `setImmediate`, 1000 klasör |
| `electron/temp-sweep.ts` | 162 | `canliMi` |
| `electron/instance-marker.ts` | 162, 165 | yeni işaret dosyası + 24 saat bayatlık |
| `electron/window-close.ts` | 162 | `touchFor` kalp atışı |
| `electron/preload.ts` | 162, 164 | `closeProgress`, merge `branchId`/`ambiguous` |
| `electron/memory-meter.ts` | 163 | boş çıktı = başarısız ölçüm |
| `electron/canvas-session.ts` | 166 | taslak tekilleştirme + 20 sınır |
| `electron/viewer-server.ts` | 166, 168 | Origin + jeton sonrası 12 sınır |
| `electron/zip-library-storage.ts` | 165, 166 | tmp temizliği, link/unlink retry |
| `electron/library-path.ts` | 166 | korumalı+silinmiş yol → profile |
| `electron/tool-http.ts` | 165 | eşzamanlı başlatma kilidi |
| `a11y/worker.ps1` | 163, 164 | etiket→alan, `EM_SETSEL`, odak türü kapısı kaldırıldı, `finally` uyarısı |
| `a11y/screen.ps1` | 165, 167 | opak çekim + GDI+ 24-bit, işaretçi doğrulaması |
| `src/App.tsx` | 162, 164, 165, 166, 167, 168 | kalp atışı, merge hedefi/kilit, paket içi seçim, yakalama kapısı, Bitir uyarısı, merge hata yolu |
| `src/types.ts` | 162, 164 | `closeProgress`, merge yanıt alanları |
| `src/components/SidePanel.tsx` | 165, 167, 169 | paket içi seçim kancaları, `TimeoutField`, döngü listesi O(n) |
| `src/components/CheckpointsPanel.tsx` | 165 | 300 satır + "daha fazla" |
| `src/components/NodeCanvas.tsx` | 169 | menü karşı ölçeği |
| `scripts/test-stability-main.cjs` | 163, 168 | yeni runFlow yüzeyleri (`durdurHudStopwatch`), temizlik senaryosu |
| `scripts/dev-start-test.cjs` | 166 | işaret dosyası kuralı |
| `tests/*` | — | §1.5, §3, §4, §5, §6, §7, §8'de listelenen yeni/güncel dosyalar |

## 11. Doğrulama ve yayın zinciri

Her sürümde: `npm run typecheck` (3 proje) → `npx vitest run` → altı Node paketi (`test:keys`,
`test:input`, `test:recovery`, `test:targeting`, `test:stability`, `test:lock`) → ilgiliyse
PowerShell harness'leri (`test-worker`, `test-screen`, `test-scan-frame`,
`test-visual-crop-geometry`, `test-keyboard-safety`, `test-visual-input`) → `npm run build:electron`
→ sürüm notu → commit → etiket → `git push origin main && git push origin vX` → `npm run pack:win`
→ EXE masaüstüne kopya + SHA256 karşılaştırması.

**Son geçit (1.9.169):** typecheck ✓ · vitest **198 dosya / 1492 test** ✓ · altı Node paketi
**0 kırmızı** · `build:electron` ✓.

**Bilinen flaky:** `tests/zip-library-storage.test.ts` ("unchanged explicit save" / "physical
ordinal") — Windows `rename`/Defender EPERM; kullanıcı kararıyla F2 kapatıldı; tek başına 27/27
geçiyor. Tam pakette zaman zaman 1 kırmızı görüldü, sürümler bu nedenle durdurulmadı (raporda açık).

## 12. Bilinçli açık bırakılanlar (kapanış)

1. `screen.ps1` simge dx/dy telafisi — `locator` şemasına alan eklemek gerekir; CLAUDE.md §13
   şema değişikliğini yasaklıyor.
2. `zip-library-storage` EPERM flaky testi — kullanıcı kararı (F2).
3. `checkpoint-output-watch` dolu klasör gezmesinin tek yazıcı kuyruğunda olması — checkpoint
   tasarımının bilinçli sınırı.

## 13. Hızlı denetim komutları

```powershell
cd "C:\Users\ASUS TUF\agent-flow\agent-flow"
git log --oneline bbfb42a..HEAD          # tüm oturum commit'leri
git show --stat 3fd41d7                   # sürüm sürüm dosya dökümü
git diff bbfb42a..f68dd14 -- electron/a11y src   # kümülatif ürün farkı
npm run typecheck
npx vitest run
```

Sürüm EXE'leri: `C:\Users\ASUS TUF\Desktop\Nubbo-1.9.162.exe` … `Nubbo-1.9.169.exe`.
