# Kararlılık eylem planı (Haiku için)

Hazırlayan: Sonnet 5.5 (kod okuyarak, canlı koşu YAPILMADI). Uygulayan: Haiku 5.5.
Kapsam: zamanlama, kaynak/koordinat tutarsızlığı, uç durumda durma, GUI-Owl, yavaşlık, geliştirme döngüsü.

## 0. Önce bunu oku

- Bu plan CLAUDE.md'nin **yerine geçmez**. Çelişki olursa CLAUDE.md kazanır (özellikle §6, §10, §17, §19, §20). §20 bu çalışmanın izin verdiği dar motor değişikliklerini ve hâlâ yasak olanları sayar; faz içinde şüphede kalırsan oraya bak.
- **Çalışma dizini:** `C:\Users\ASUS TUF\agent-flow\agent-flow` (1.9.150, uzak adı `origin`). Üstteki `agent-flow` klasörü eski ayrı bir checkout'tur (1.9.130); orada çalışma, orayı değiştirme.
- Her faz **ayrı bir patch**tir. Bir faz bitmeden sonrakine geçme.
- "Doğrulandı" yazan satırlar kodda görüldü. "Hipotez" yazanlar ölçülmeden doğru sayılmaz.
- Sahip ölçütü yeşil test değil, **gerçek koşuda işin ilerlemesidir** (§19). Test yazarken "kapı fırladı mı" değil "iş yapıldı mı" sor.

## 1. Değişmezler (ihlal etme)

1. Node türlerini, anlamlarını, çıkışlarını, parametrelerini, şemayı **değiştirme**. Yeni node türü ekleme (§13).
2. Eylemden **önce** izin isteyen yeni kapı ekleme. Eylem yapılır, sonuç gözlenir (§19).
3. İnisiyatif `finished` sonrası ikinci model kontrolü **ekleme** (§17).
4. Her eylemden sonra model yargısı **ekleme**. `screenCheck` varsayılanı yalnızca-günlüktür, eşiği tuning etme (§17).
5. Hafızaya yalnız doğrulanmış hedef yazılır; bunu gevşetme.
6. Ekran görüntüsü, OCR kutusu, tıklama koordinatı ve model cevabı **aynı koordinat sistemine** bağlı kalır (§6).
7. Windows XP görünümüne dokunma. Yeni EXE, servis, bağımlılık, paralel yürütücü ekleme.
8. "Otomatik onarım yöneticisi" ekleme (7 Ekim kararı). Onarım döngüsü geliştirme sürecidir (Faz 1), ürün özelliği değil.
9. Kullanıcının gerçek akışına ve gerçek profil deposuna dokunma. Koşular yalnız `NUBBO_PROFILE=test` ile.
10. Masaüstüne dokunan her komut `node scripts/dev-safe.cjs -- <komut>` kapısından geçer. Kapı reddederse (çıkış 4) **bekle ve kullanıcıya söyle**, `--yes` verme.

## 2. Her faz için protokol

1. İlgili dosyayı **aralık okuyarak** oku (agent.ts 1574, openrouter.ts 1878 satır; bütün dosyayı yeniden yazma, `Edit` kullan).
2. Sorunu somutlaştır: hangi node, hangi dosya:satır, hangi davranış.
3. Önce başarısız olan test/senaryo, sonra düzeltme (ölçüm ve doküman fazları hariç).
4. Küçük değişiklik. Varsayılan davranış değişecekse **dur ve sor**.
5. `npm run typecheck` ve ilgili testler. Faz sonunda tam geçit (CLAUDE.md §19 adım 6).
6. Yayın zinciri CLAUDE.md §19'daki gibi (sürüm artışı + `docs/surum-notu-<sürüm>.md` + commit + etiket + push). Commit mesajı dosyadan. Mevcut sürüm 1.9.150; ilk patch 1.9.151.
7. Rapor 3 satır: **neyi değiştirdim · ne ölçtüm · ne hâlâ bozuk**.

### Dur ve kullanıcıya sor (DURMA KOŞULLARI)

- Temel çizgide yeşil olan bir test kırmızıya döndü ve 2 denemede düzelmedi.
- Değişiklik node şemasına, varsayılan bekleme/zaman davranışına veya bir kapının (throw) kaldırılmasına dokunuyor ve ilgili onay satırı bu dosyada yok.
- Koşu gerekiyor ama `dev-safe` reddediyor.
- Kodun gerçek davranışı bu dosyadaki "doğrulandı" satırıyla uyuşmuyor.
- Bir faz 3'ten fazla dosyada davranış değişikliği gerektiriyor.

## 3. Doğrulanmış zemin (kod okunarak)

| Konu | Kanıt |
| --- | --- |
| Sabit beklemeler | `agent.ts:98` FOCUS_MS=420, `:100` REFRESH_RETRY_MS=3000, `:1050` pause(900), `:1056` pause(2000)×3, `:1085` pause(2500), `:1290` pause(240), `:1305` 5000 poll, `:1307` pause(1500); `pause` tanımı `:153` |
| Her eylemde iki tarama | `ensureActed` (`~:1018-1095`): `snap` önce + `act()` + `pause(900)` + `snap` sonra. Yalnız mod `off`, ya da sıradaki `type`(promptsuz)/`condition` ise atlanır |
| Model yargısı varsayılan olarak yok | `judgeReaction` yalnız `lookCloser` içinde, o da `mode === 'on'` (`:1066`). Varsayılan `log` (CLAUDE.md §17; F0'da `screenCheckMode` varsayılanını doğrula) |
| GUI-Owl koordinatı | 0–1000 ızgara. Dönüşüm `agent.ts:783-784` ve `:877-878` (iki kopya), kaynak alan `res.area`/`a` (yakalamadan gelir). Çözümleme `openrouter.ts:1506-1507`. Doğrulama `agent.ts:740` (`n <= 1000` dahil) |
| Yakalama sanal ekranı kullanır | `a11y/screen.ps1:63` `Get-VirtualScreen`; `:807` yalnız `primary=true` ise birincil ekran |
| `screenArea()` yalnız tek yerde | `agent.ts:167` tanım, `:616` kullanım (simge hafızası rx/ry). Birincil ekranı varsayar |
| Kapı sayısı | `agent.ts` 55, `a11y/worker.ps1` 66 `throw`. §19 listesindeki `INPUT_*` kodları kodda hâlâ geçiyor (tek tek sınıflandırılmadı) |
| Runner bilinçli durmaları | `runner.ts:206,219,222,364,374` (açık paket yok, döngü yok, devam konumu belirsiz, Yap ortam yok, eski node türü) |
| Flaky test | `electron/zip-library-storage.ts:145` `fs.renameSync` EPERM (Windows). Test tek başına geçiyor |
| Hazır araçlar | `scripts/dev-safe.cjs`, `dev-scenario.cjs`, `dev-start-test.cjs`, `dev-status.cjs`, `dev-harness-loop.cjs`, `dev-repair-battery.cjs`, `replay-target.cjs`, `test-visual-crop-geometry.ps1`, `scripts/scenarios/*.json`, `electron/target-trace.ts` |
| Test stili | `tests/*.test.ts`, vitest, sahte `Executor` (`tests/runner-loop.test.ts`) |
| Uç nokta/araçlar | Yalnız `NUBBO_PROFILE` + `NUBBO_TEST_TOOLS=1` ile (`main.ts:1394`). README bunu hâlâ eski anlatıyor |

Hipotez (ölçülmeden doğru sayma): yavaşlığın ana kaynağı eylem başına iki `snap` + sabit bekleme; GUI-Owl kaymasının nedeni koordinat dönüşümü değil kırpma/model çıktısı olabilir; "zamanlama tutmuyor" sorunu 900/420/240 ms gibi tahmini sabitlerden.

## 4. Fazlar

### F0 — Temel çizgi (kod değişmez)
- `git status` temiz mi, `git log -1`.
- `npm run typecheck`, `npx vitest run`. Sayıları kaydet (referans: 1302 test, 1 flaky).
- `screenCheckMode` varsayılanını `graph-types.ts` içinde doğrula.
- Çıktı: `docs/kararlilik-temel-cizgi.md` (komut, sonuç, tarih). Kabul: dosya var, sayılar yazılı.

### F1 — Geliştirme döngüsü runbook'u (yalnız doküman)
Amaç: "güçlü model kuramlar, orta model düzeltir" döngüsünü **mevcut araçlarla** yazıya dökmek. Yeni araç yazma.
- Rol: güçlü model = hipotez + senaryo JSON + `completed` kabul ölçütü. Haiku = düzeltme + kanıt.
- Komut zinciri: `dev-status` → `dev-seed-fixture test` → `dev-start-test test` → `dev-safe -- dev-scenario scripts/scenarios/<ad>.json` → `test-artifacts/<ad>-<zaman>/evidence.md`.
- Kural: bir hipotez için en fazla **3 düzeltme denemesi**; sonra kanıt paketiyle (`evidence.md`, motor günlüğü, hata görüntüsü) güçlü modele devret.
- Yalnız `completed` sınıfı başarıdır (CLAUDE.md §18).
- Çıktı: `docs/gelistirme-dongusu.md`. Kabul: komutlar kopyala-çalıştır doğrulukta (dosyaları gerçekten okuyarak yaz, ezberden değil).

### F2 — Flaky EPERM (küçük düzeltme)
- Dosyalar: `electron/zip-library-storage.ts` (~120-180), `tests/zip-library-storage.test.ts`.
- Yap: `renameSync` etrafında **sınırlı** yeniden deneme (win32, yalnız EPERM/EBUSY/EACCES, en çok 5 deneme, 20→200 ms artan bekleme). Hash/çatışma denetimi ve kilit mantığı **aynı kalır**.
- Test: sahte `fs` iki kez EPERM verip sonra başarır → yazılır; hep EPERM verirse → hata yüzeye çıkar ve geçici dosya temizlenir.
- Yapma: çatışma algılamayı gevşetme, sessizce yutma.
- Kabul: ilgili test 20 ardışık koşuda geçiyor.

### F3 — Ölçüm (davranış DEĞİŞMEZ)
- Yeni küçük yardımcı: `electron/step-timing.ts` (saf, sahte saat ile test edilebilir): bekleme ms, tarama sayısı+ms, model çağrısı sayısı+ms, node başına toplam.
- Bağla: `agent.ts` `ensureActed`/`pause`/`snap` ve model çağrısı sarmalayıcıları. Çıktı **yalnız günlük**: node başına tek satır `Süre: toplam … · bekleme … · tarama N× … · model M× …`.
- Yapma: yeni UI, yeni ayar, davranış değişikliği.
- Kabul: tam geçit yeşil; bir senaryo koşusunda satırlar görünüyor; yardımcı için birim test.
- **Kullanıcıdan veri iste**: gerçek bir koşunun günlüğü F6 kararı için gerekli.

### F4 — GUI-Owl koordinat saflaştırma
- Yap: `electron/visual-geometry.ts` içinde saf `gridPointToScreen(coord, area)`; `agent.ts:783-784` ve `:877-878` onu kullansın. Sonuç alan içinde kalsın (`x ≤ area.x+area.w-1`; şu an `1000` alan dışına 1 px taşar).
- Test: negatif x'li sol monitör alanı, %125/%150 DPI fiziksel piksel alanı, 0 ve 1000 uçları, yuvarlama. Mevcut `visual-pointer-agent.test.ts` yeşil kalmalı.
- `scripts/test-visual-crop-geometry.ps1`'i **önce oku**, `dev-safe` ile çalıştır, sonucu rapora yaz.
- `screenArea()` (`:167`/`:616`): yalnız test, simge hafızası oranlarının (rx/ry) ikinci monitörde [0,1] dışına çıktığını **gösterirse** düzelt (yakalamadan gelen alanı kullan). Köprüde sanal ekran alanı yoksa **DUR ve sor**.
- Kabul: dönüşüm tek yerde, testler yeşil, davranış mevcut tek-monitör durumunda aynı.

### F5 — GUI-Owl teşhis izi
- `electron/target-trace.ts` ve `scripts/replay-target.cjs`'i oku. Hâlihazırda kaydedilenleri listele.
- Eksik varsa ekle (yalnız iz/günlük): modele giden görüntü boyutu, kırpma dikdörtgeni, ham model çıktısı (en çok ~500 karakter), ayrıştırılan eylem, nihai piksel.
- Çıktı: `docs/gui-owl-teshis.md`: başarısız bir GUI-Owl hedeflemesinden iz alma ve `replay-target` ile yeniden oynatma adımları.
- Kabul: bir iz kaydı alınıp yeniden oynatılabiliyor (fixture ile), kayma sorusu "koordinat mı model mi" ayırt edilebiliyor.

### F6 — Bekleme sabitleri
- **6a (yapılır):** literal değerleri `electron/timing-constants.ts` içinde adlandırılmış sabitlere taşı. **Değerler aynı.** Koruma testi: değerler eskisiyle eşit.
- **6b (KULLANICI ONAYI ŞART, F3 verisi gerekli):** sabit `pause(900)`'ü "değişiklik görülene kadar, en çok eski süre kadar" bekleyen bir döngüye çevirmek. Önce köprüde **ucuz** bir değişim sinyali olup olmadığına bak (tam `snap` her 200 ms'de pahalı olur). Yoksa DUR. Yeni davranış `off/log/on` modlarını ve hafıza yazma kuralını (`true` dönüşü) değiştirmemeli.
- Kabul (6a): davranış birebir aynı.

### F7 — Durma kapıları kataloğu (önce yalnız analiz)
- Çıktı: `docs/durma-kapilari-katalogu.md`. Kaynak: `agent.ts`, `runner.ts`, `a11y/worker.ps1` içindeki her `throw`.
- Sütunlar: dosya:satır · kod/mesaj · tetikleyici · **§19 tek sorusu** ("belirsizlik mi, gerçek imkânsızlık mı?") · öneri (kalır / uyarıya döner / mesajı iyileştir) · test var mı.
- Haiku **sınıflandırır, değiştirmez.** Kullanıcı satır satır onaylar.
- **7b (yalnız onaylı satırlar, her biri ayrı patch):** önce "iş ilerledi mi" senaryosu (kırmızı) → kapıyı uyarıya çevir → senaryo yeşil. Gerçek imkânsızlık kapılarına (kapanmış pencere, başka PID, Nubbo'nun kendi penceresi, Durdur, boş hedef, API anahtarı yok, bozuk node) **dokunma**.
- **7c (güvenli, onaysız yapılabilir):** `runner.ts` durma mesajlarının sonuna "ne yapmalı" eki (ör. "Satırı seç ya da listeyi yeniden yükle"). Mevcut mesaj öneklerini koru (`runner-*.test.ts` bunlara bakıyor olabilir; önce oku).

### F8 — README senkronu (opsiyonel, yalnız doküman)
README, kaldırılan branch/merge arayüzünü ve "Dışarı açık" ayarını hâlâ anlatıyor. Haiku **farkları listeler**, yeniden yazmaz; kullanıcı onaylarsa düzeltir.

## 5. Sıra gerekçesi

Ölçmeden (F3) bekleme ve yavaşlık kararı verilmez. Saf fonksiyona çıkarma (F4) ve ad verme (F6a) davranışı değiştirmeden riski düşürür. Motorun eylem yolu (F7b) en riskli iştir; en sona ve yalnız onaylı satırlarla bırakıldı.

## 6. Kullanıcı cevapları (17 Ekim 2026) — geçerli

- **Yayın:** Her patch otomatik push + exe üretimi (CLAUDE.md §19 zinciri). Uzak adı uyuşmazlığında yine DUR ve sor (aşağıdaki not).
- **Bilgisayar:** Şu an boş. Koşulara izin var, ama `dev-safe` yine kapıdır. Kullanıcı koşu sırasında fare/klavyeye dokunmaz; kapı reddederse bekle ve kullanıcıya söyle.
- **GUI-Owl:** Kullanıcının PC'sinde aktif; programda istendiğinde kullanılabilir. Eski günlükler: `%APPDATA%\xp-agent-studio\logs\<sürüm>\calistirma-*.txt` (186 klasör, GUI-Owl geçenler ör. `1.9.97`–`1.9.99`, 12 Ekim 2026). Bunlar **eski sürümlere** aittir: örüntü ipucu olarak oku, güncel davranış kanıtı sayma. Güncel kanıtı F5'teki iz ile yeni koşudan al.
- Kullanıcı Haiku'ya geçişi kendisi yapar.

(Eski sorular: yayın zinciri, boş saat, GUI-Owl günlüğü. Hepsi cevaplandı. Not: §19 `git push github` der, çalışma deposunda uzak adı `origin`; `git remote -v` ile doğrula.)

## 7. Durum notları (Haiku, 17 Ekim 2026)

- **F0 tamam**, push edildi (`2ae0122`). `docs/kararlilik-temel-cizgi.md`.
- **F1 tamam**, push edildi (`6e4183a`). `docs/gelistirme-dongusu.md`.
- **F2 KAPATILDI (kullanıcı kararı: seçenek 2, "kişisel program, önemli değil").** Yeniden deneme kodu geri alındı; testler yalnız dokümante edildi. Plan varsayımı yanlış çıktı: `zip-library-storage.ts` içinde `renameSync` EPERM'i, 5 denemede (en fazla 160 ms) ve 10 denemede (en fazla 500 ms, toplam ~2,6 sn) düzelmedi.
  - Ölçüm, 20 ardışık `zip-library-storage` + `zip-rename-retry` koşusu: 5 deneme → **6/20 başarısız**; 10 deneme → **3/20 başarısız**.
  - Yığında hata `renameRetrying` yeniden denemeleri bittikten sonra yüzeye çıkıyor. Kodda açık tutamaç yok (`readBuffer` ve `publish` fd'leri kapatıyor). Olası neden: Windows Defender veya indeksleyici hedef/geçici dosyayı tutuyor. Hipotez, doğrulanmadı.
