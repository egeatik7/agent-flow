# Bug taraması v2 — 1.9.162/163 düzeltmelerinin denetimi + yeni bulgular

Tarih: 20 Ekim 2026 · Depo: `agent-flow/agent-flow` · Denetlenen HEAD: `e08b482` (1.9.163)

> 37 ajan: 10 düzeltme denetçisi (her düzeltmeyi kırma denemesi), 8 yeni tarama alanı, 19 bağımsız
> çürütme doğrulayıcısı. **73 ham → 70 geçerli** (3 çürütüldü): **12 yüksek, 34 orta, 24 düşük**.
> Hiçbir ürün dosyası bu tarama sırasında değiştirilmedi; düzeltmeler ayrı sürümde (1.9.164).

## 1. Düzeltme denetimi — ne tuttu, nerede kaçırdı

| Düzeltme | Sonuç | Açık kalan |
| --- | --- | --- |
| Checkpoint yazımı koşuyu durdurmuyor | ✅ çalışıyor (testle sabit) | Bayat checkpoint hâlâ geçerli devam noktası gibi görünüyor; devam edilirse aradaki öğeler yeniden oynar (orta) |
| Checkpoint saklama/`list()` toleransı | ✅ çalışıyor | Budama yalnız koşu bitiminde; koşu sırasında sınırsız büyüme sürüyor (orta) |
| Eylem dışı node hataları kalıcı | ⚠️ kısmi | **Koşul'un ham executor hatası (eksik API anahtarı) hâlâ sonsuz 3 sn turda** (yüksek) |
| Koşul turu `maxRounds=4` | ⚠️ kısmi | Kutu içinde "karar verilemedi" sessizce "hayır"a dönüşüp öğe **başarılı** sayılıyor (yüksek) |
| Model tuş koruması bağlandı | ⚠️ kısmi | `^w`, `^q`, `^+{w}`, `{ESC}{DELETE}` yazımları engeli atlıyor (yüksek) |
| Hatadan devam (H8) | ⚠️ kısmi | Klasör kutusunda `items` doluysa yine "Liste değişmiş" diyor (yüksek) |
| Etiket→alan + `EM_SETSEL` | ⚠️ kısmi | Odakta **başka bir yazı alanı** varsa etiket çözümü hiç çalışmıyor (yüksek) |
| `ensureActed` tarama koruması | ⚠️ kısmi | Tarama hatası "BAKILMALI" sayılmıyor; gözlenemeyen tıklama temiz başarı görünüyor (yüksek) |
| `run.from` başladı/başlamadı | ✅ çalışıyor | — |
| Kilit bırakma / tanılama budama | ✅ çalışıyor | `unlinkRetrying` main thread'i ~3,25 sn bloke edebiliyor (orta); budama ilk istekte senkron (düşük) |
| Kapanış kalp atışı | ✅ çalışıyor | Arayüz canlı ama iş bitmiyorsa 10 sn sınırı süresiz uzuyor (orta) |
| Portable işaret | ⚠️ kısmi | `dev-start-test.cjs` işareti okumuyor; PID geri dönüşümü (orta) |

## 2. Yeni bulgular — yüksek (12)

1. **Koşul'da ham executor hatası sonsuz tur** · `runner.ts:407, 518` — eksik API anahtarı/yerel model
   yokken koşu hiç bitmiyor; `maxSteps`, kurtarma, hata olayı devreye girmiyor.
2. **Kutu içinde belirsiz koşul sessiz "hayır"** · `runner.ts:602`, `agent.ts:1564` — 4 tur sonra
   tur sessizce biter, `succeeded++` olur; işlenmemiş öğeler "çalıştı" raporlanır.
3. **`readFolder` retry'sinde terminal/maxRounds yok** · `runner.ts:700-704` — eksik alt klasör
   koşuyu saatlerce kilitler.
4. **Hatadan devam yanlış reddi** · `tools.ts:1259` — klasör kutusunda bayat `items` karşılaştırılıyor.
5. **Etiket→alan, odak başka alandayken çalışmıyor** · `worker.ps1:1219` — ardışık alan yazmaları
   ilk alana düşer; §8 ihlali.
6. **Tarama hatası "BAKILMALI" değil** · `agent.ts:1056/1064` + `main.ts:365` — gözlenemeyen eylem
   temiz başarı sayılıyor.
7. **`keySet` SendKeys yazımlarını çözmüyor** · `key-guard.ts:31` — model `^w` ile pencere kapatabilir.
8. **Merge cevabı istek kimliği taşımıyor** · `main.ts:469-474` — gecikmiş cevap yanlış merge'i
   "başarılı" yapar, branch tarifi silinir.
9. **Merge "hiçbir şey yazılmadı" hâlâ yanlış** · `tools.ts:719-731` + `App.tsx:731` — tuval bellekte
   değiştiği hâlde ZIP kaydı başarısız olunca kesin ret; ikinci merge aynı op'ları tekrar yazar.
10. **Checkpoint 500 ms'de tam dosya yeniden yazımı** · `checkpoints.ts:101` — O(n²) yazma, `mark()`
    aynı kuyrukta olduğu için öğe gecikmesine ekleniyor.
11. **Checkpoint paneli 100.000 çıktıyı tek listede render ediyor** · `CheckpointsPanel.tsx:112` —
    10.000 satırda ~50 bin DOM düğümü, modal donuyor.
12. **Paket içi hedef seçici dış node'a yazıyor** · `SidePanel.tsx:537` — iç node hedefsiz kalıyor,
    kök düzeyde sahte Tıkla node'u ekleniyor (H7).
13. **Tamamlanan eylem, `finally` klavye temizliği hatasıyla "gönderilmedi" oluyor** ·
    `worker.ps1:1637-1646` — `INPUT_MODIFIERS_HELD` fırlarsa yapılmış tık/tuş `ok:false` döner,
    koşu boşuna durur.
14. **1080p piksel döngüleri PowerShell'de** · `screen.ps1:183-186, 655-665` — tarama +2,8 sn,
    model karesi +9,2 sn (ölçüldü).

## 3. Yeni bulgular — orta/düşük (öne çıkanlar)

- `runner.ts:546-548` adım bütçesi kutu/paket sınırında sıfırlanıyor → 2000 kutu geçişi × 2000 taze
  adım bütçesi.
- `runner.ts:447` paket içi tek hata iki kez sayılıyor (`failed=2`); `runnerSaydi`/`haltLoop` bayrağı
  sarmalamada kayboluyor.
- `library-lock.ts:88-98` `unlinkRetrying` main thread'i ~3,25 sn bloke ediyor (Durdur dahil).
- `send-log.ts:204` 200 klasör sınırı yoğun saatte ≈1,8 saat; saatlerce süren koşunun erken kanıtı
  siliniyor.
- `instance-marker.ts:24-33` PID geri dönüşümü eski klasörü "canlı" sayıp hiç silmiyor;
  `scripts/dev-start-test.cjs:101-113` işaret okumuyor.
- `yap-context.ts:149` bütçe `/2 + 2048` sığan isteği önden reddediyor (1.9.164'te düzeltildi).
- `tools.ts:1446` Durdur'da `act.*` "eylem-belirsiz/sent:false" diyor; ajan aynı tıklamayı yineleyebilir.
- `tools.ts:1392/1455` tek eylem sonrası pencere minimize kalıyor, Durdur kısayolu kayıtlı değil.
- `tools.ts:925` debug/sınırlı koşudan kalan durdurma bayrağı `target.preview`'ü bozuyor.
- `tool-state.ts:196-198` gözlenen sayaçlar çift sayıyor; probe olayı bitmiş koşuya yazılıyor.
- `agent.ts:1473` Yazı Yaz yolu doğrulanmamış alanı hafızaya yazıyor; `memory.win` yöntem adı taşıyor.
- `word-targets.ts:105-110` 400'lük aday kırpması tıkla/yaz komutunda loglanmıyor.
- `confirm.ts:73` yükleme sinyali 8 satıra kırpılmış `fresh` listesinde aranıyor.
- `zip-library-storage.ts:178` başarılı yayın sonrası temizlik unlink'i EPERM alırsa hata dönüyor.
- `zip-library-storage.ts:228-239` retry kapsamı yalnız publish rename'i; arşiv/sil ham link/unlink.
- `library-path.ts:38` korumalı-yol kapısı atlanıyor; açılışta sınırsız bekleme geri gelebilir.
- `canvas-session.ts:16-21` kurtarma taslakları sınırsız birikiyor.
- `viewer-server.ts:25` Origin denetimi yok, 12 soket jetondan önce sayılıyor.
- `main.ts:568-570` HUD `keepOnTop` interval'i temizlenmiyor; `main.ts:511` load sözleri yakalanmıyor.
- `tool-http.ts:93-109` eşzamanlı `startEndpoint` iki dinleyici açıyor; biri kapatılamıyor.
- `App.tsx:706/720/730` merge hedefi beklemelerden sonra `activeIdRef`'ten çözülüyor (yanlış tuval).
- `graph-ops.ts:78-81` çıkışı olmayan Bitir araya eklenince sonraki bağlantı siliniyor.
- `SidePanel.tsx:325` Yap "Süre sınırı" her tuşta 10–900'e kırpılıyor; `App.tsx:1273` yakalama
  sürerken koşu başlatılabiliyor; `App.tsx:376-380` her yamada tüm defter yazılıyor.
- `checkpoints.ts:163/173/196` budama yalnız finish'te; `list()` 2 sn'de tüm arşivi parse ediyor;
  `detail()` çıktı başına `access()`.
- `checkpoint-output-watch.ts:216` dolu klasör gezmesi `serial` kuyruğunda (Durdur'u geciktirir).
- `worker.ps1:1591-1598` (denetim) finally temizliği sonucu eziyor — 1.9.164'te düzeltildi.
- `screen.ps1:979-1017` tıklama imlecin hedefe vardığını doğrulamıyor; `:925` simge dx/dy telafisi
  kullanılmıyor.

## 4. 1.9.164'te kapatılanlar

- Koşul ham hata: `PermanentStepError` + 3 tur sınırı (koşu açık hatayla biter, asılı kalmaz).
- Kutu içinde belirsiz koşul: artık sessiz "tamamlandı" değil, öğe hatası.
- `readFolder`: `maxRounds=3`.
- Hatadan devam: klasör beslemeli kutuda karşılaştırma yok.
- Etiket→alan: odak türüne bakılmadan tıklama noktasının tek alanı çözülür.
- Tarama hatası: "BAKILMALI" sınıflandırmasına `tarama yapılamadı`/`tepki doğrulanamadı` eklendi.
- `keySet`: `^w`, `^q`, `^+{w}`, `%{F4}`, `{ESC}{DELETE}` artık engelli (basış bazlı ayrıştırma).
- Merge: yanıt `branchId` taşır (gecikmiş cevap yanlış isteği onaylamaz); ZIP kaydı başarısızsa
  `ambiguous:true` döner, "hiçbir şey yazılmadı" denmez.
- Worker `finally`: klavye temizliği hatası sonucu ezmez, `warning` olarak eklenir.
- Yap bütçesi: 3 bayt/token + 1024 pay (sığan istek önden reddedilmiyor).

## 5. Açık kalanlar (sonraki sürüm)

Checkpoint O(n²) yazımı (NDJSON) ve panel sanallaştırması · paket içi hedef seçici (H7) ·
`screen.ps1` piksel döngülerinin native'e indirilmesi · `unlinkRetrying`/`pruneEvidence` blokajı ·
`instance-marker` PID geri dönüşümü + `dev-start-test` işareti · paket `runnerSaydi` çift sayımı ·
`act.*` Durdur semantiği · merge hedefinin tıklama anında sabitlenmesi · §3'teki diğer orta/düşükler.

## 6. 1.9.165 durumu

**Kapatıldı:** checkpoint O(n²) yazımı (append-only NDJSON + meta JSON), panelin 100.000 satır
render'ı (ilk 300 + 'Daha fazla göster'), paket içi hedef seçici (iç node'a yazar), 1080p piksel
döngüleri (opak çekim + GDI+ 32→24; ölçüm ~2,8 sn → ~4 ms, ~9,2 sn → ~8 ms), kilit unlink blokajı
(~3,25 sn → ~0,6 sn), tanılama budamasının isteği bekletmesi, 24 saatten eski portable işareti,
act.wait doğrulama/30 dk sınırı, ZIP geçici dosya temizliği, startEndpoint çift dinleyici,
yakalama sürerken koşu başlatma.

**Hâlâ açık (orta/düşük):** merge hedefinin tıklama anında sabitlenmesi (App.tsx:706/720/730),
act.* Durdur semantiği ("eylem-belirsiz" + sent:false), tools.ts tek eylem sonrası minimize
kalma, target.preview durdurma bayrağı, tool-state çift sayaç, canvas taslak birikmesi, viewer
Origin/12 soket, HUD keepOnTop interval temizliği, graph-ops Bitir araya ekleme, SidePanel Yap
süre alanı, yazı yolunda doğrulanmamış memo, memory.win alanı, 400'lük aday kırpması günlüğü,
library-path korumalı yol, zip retry kapsamı, runnerSaydi çift sayım, koşul kurtarmasına vars
aktarımı, screen.ps1 imleç doğrulaması ve simge dx/dy telafisi.

Bu liste bir sonraki sürümün girdisidir; hiçbiri 1.9.165'te kapatıldı diye işaretlenmedi.
