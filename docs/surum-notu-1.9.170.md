# Sürüm notu — 1.9.170 (plan Paket 1 çekirdeği + kendi regresyonlarımızın geri alınması)

**Taban:** `27b22e2` (1.9.169) · **Plan:** `C:\Users\ASUS TUF\Downloads\nubbo-deepseek-vizyon-ve-duzeltme-plani.md`
(Bu sürüm planın **Paket 1**'inin dört maddesini ve planın doğruladığı **gece regresyonlarını** kapatır;
Paket 1'in 3. maddesi (teknik hata yönlendirmesi) ve Paket 2–5'in kalanı sonraki pakete bırakıldı.)

## A. Kritik gece regresyonu (ekran okuma tamamen çöküyordu)

1. **`a11y/screen.ps1` — `Set-BitmapOpaque` örnek noktaları.** 1.9.165'te eklenen
   `@(3, 3 + ($w/2)*4, ...)` ifadesi PowerShell'de virgül/artı önceliği yüzünden
   `Object[] op_Multiply` üretiyordu: **her ekran görüntüsü okuması** bu yola girip çöküyordu
   (1.9.165–169 arası tüm sürümler). Örnek konumlar ayrı skalerlerde hesaplanır, tampon sınırına
   göre süzülür. Yeni harness: `scripts/test-screen-opaque.ps1` (1×1, 4×1, 1×3, 1920×1080,
   1920×1082; alfa 255 + RGB korunumu; opak hızlı yol ve 24bpp'ye dokunmama). **Geçti.**

## B. Koşul yönlendirmesi (plan Paket 1 · madde 2, 4)

2. **Belirsiz Koşul artık hiçbir kapsamda "yok" sayılmıyor** (`electron/runner.ts`). Tek kural:
   - kesin "yok" + "yok" çıkışı bağlı → o kol çalışır (değişmedi);
   - kesin "yok" + çıkış bağlı değil → kökte salt-okunur Kurtarma'ya sorulur; kutu/pakette tur
     burada biter (eski anlam korunur), pakette "tamamlanmadı" olarak raporlanır;
   - **karar verilemedi** → kök/kutu/paket fark etmeksizin Kurtarma karar verir; Kurtarma yoksa
     açık `ConditionHaltError` ("kurtarma ajanı kapalı") ile durur.
   - Kurtarma "var" → doğru kol; "yok" + bağlı çıkış → yok kolu; aksi hâlde açık gerekçeyle durur.
3. **Kurtarma prompt'undan "emin değilsen yok de" kaldırıldı** (`electron/recovery.ts`): "var"
   yalnız açık kanıtla, "yok" yalnız açık karşıt kanıtla; kanıt yetersizse `recovery_stop`.
   `recovery_condition` artık `answer` alanını zorunlu tutmaz (kanıtsız cevap üretilmez).
4. **Kurtarma içi belirsiz girdi tekrarı** (`electron/recovery.ts`): `step.run` sonucu
   `eylem-belirsiz` ise veya gönderildi bilgisi varsa (ya da hata `inputMayHaveBeenSent` taşıyorsa)
   `failedNodeSent = true`; aynı node körlemesine yeniden çalıştırılmaz.

## C. Pencere kimliği (plan Paket 1 · madde 5, kısmi)

5. **Kurtarma `screen_read` artık hedef pencereyi kendiliğinden okur** (`electron/recovery.ts`):
   model pencere belirtmezse node'un `locator.windowTitle`'ı enjekte edilir; `hwnd`/`pid` alanları
   şemaya eklendi (pencere kimliği tüm ekran yerine o pencereye bağlanır). HWND/PID'nin motordan
   otomatik taşınması Paket 1'in kalan işidir.

## D. Kendi eklediğimiz regresyonların geri alınması (plan Paket 2–4 doğrulamaları)

6. **Kurtarma taslakları** (`electron/canvas-session.ts`): 1.9.166'daki "adla tekilleştir + 20 sınır"
   geri alındı. Kimlik = `savedId` ya da oturumdaki tab id'si; **aynı adlı iki ayrı kaydedilmemiş
   tuval birleştirilmez**, kullanıcı taslakları sabit eşikle **silinmez** (test: 25 taslak korunur).
7. **Kütüphane yolu** (`electron/library-path.ts`): 1.9.166'daki "korumalı kökte yoksa profile düş"
   geri alındı. Kullanıcının kayıtlı yolu **tartışmasız korunur**; geçici erişim yokluğu kalıcı
   ayar göçü değildir (test güncellendi).
8. **Örnek işareti yaşı** (`electron/instance-marker.ts`): 24 saat kuralı kaldırıldı; **canlı PID
   yaştan bağımsız canlıdır** (25 saattir açık portable örnek "bayat" diye silinmez).
9. **Viewer Origin** (`electron/viewer-server.ts`): yalnız localhost kabul eden 1.9.166 kuralı
   geri alındı; Origin, isteğin **Host**'u ile aynı olmalı. Böylece gerçek Tailscale adresi
   (`https://…ts.net:8443`) yine bağlanır, başka sitelerin Origin'i reddedilir.
10. **Merge kendi kilidine takılıyordu** (`src/App.tsx`): 1.9.166'da merge sırasında açılan
    `libraryBusyRef`, `saveCurrentCanvas`'ı reddettiriyor ve merge'i **her seferinde** başarısız
    yapıyordu. Kilit kaldırıldı; hedef sekme kimliği denetimi korunuyor.
11. **Merge yanıtı 20 sn boşa bekliyordu** (`electron/main.ts`): `ipcMain.once` eşleşmeyen bir
    cevapla tükeniyordu. Artık `ipcMain.on` + `branchId` **ve gönderen pencere** eşleşmesi;
    eşleşmeyen cevap dinleyiciyi tüketmez, timeout yalnız gerçekten cevapsız kalınca döner.
12. **HUD bellek kartı** (`electron/main.ts`): koşu bitince kart `null` ile silinmiyor; son ölçüm
    **donmuş/eski** olarak yeniden yayınlanıyor (saatler önceki değer "az önce" görünmez).
13. **Otomatik silme kaldırıldı** (`electron/checkpoints.ts`, `electron/send-log.ts`): tamamlanmış
    checkpoint geçmişi ve tanılama kanıtı artık **sessizce budanmaz** (`prune*` yalnız açık çağrı
    için durur). Planın "kullanıcı geçmişi eşikle silinmez" kuralı.
14. **`act.wait` zaman aşımı** (`electron/tools.ts`): normalize edilmiş `ms` (1 ms–30 dk) hem node'a
    hem zaman aşımı hesabına gider; ham değer taşınmaz.

## Doğrulama

- `npm run typecheck` ✓ (üç proje).
- `npx vitest run` → **198 dosya / 1493 test** yeşil. Güncel/eklenen: `condition-recovery`
  (belirsiz + bağlı yok kolu → Kurtarma kararı; kurtarma yoksa açık duruş), `runner-new-bounds`
  (kutu içi belirsizlik → açık duruş), `canvas-session-drafts` (ad birleştirmez, 25 taslak korunur),
  `zip-library-path` (kayıtlı yol korunur), `method-cycle-persistence`.
- Altı Node paketi: `test:keys` 3 · `test:input` 7 · `test:recovery` 27 · `test:targeting` 20 ·
  `test:stability` 40 · `test:lock` 1 — **0 kırmızı** (stability harness'ine `bellekKartiniTemizle`
  yüzeyi eklendi).
- PowerShell: `test-screen-opaque` (yeni), `test-worker`, `test-keyboard-safety`,
  `test-visual-input`, `test-screen`, `test-scan-frame`, `test-visual-crop-geometry` — **hepsi geçti**.
- `npm run build:electron` ✓ (pack ile).

## Bu sürümde YAPILMAYANLAR (dürüst sınır)

- **Paket 1 · madde 3 (teknik hata yönlendirmesi):** Koşul/klasör teknik hatalarının aynı node'da
  Kurtarma'ya devri, `isApiDown` metin sınıflandırmasının kaldırılması, yapısal hataların ön
  kontrole taşınması — sonraki paket.
- **Paket 1 · madde 5 (tam):** HWND/PID'nin motordan Kurtarma isteğine taşınması; şu an pencere
  başlığı enjekte ediliyor, HWND/PID alanları şemada hazır.
- **Paket 2–5'in kalanı** (Kurtarma'nın kendi hata sınıfları, WGC/GDI yakalama mimarisi, sadelik
  turu, koşul sözleşmesinde `satisfied:true` + kanıt zorunluluğu vb.) — plandaki sıraya göre
  "devam" denince ele alınacak.
- Canlı masaüstü koşusu yapılmadı; ekran harness'i gerçek `Set-BitmapOpaque`'i sahte bitmap'lerle
  ölçtü, gerçek masaüstü yakalaması bu oturumda çalıştırılmadı.

## EXE

`Nubbo-1.9.170.exe` · `C:\Users\ASUS TUF\Desktop\Nubbo-1.9.170.exe` · SHA256
`8F16FDC3C90DFD18DD4D1FB824035EB70F06A4679E098918267313DFDD05B314` (build = masaüstü kopyası,
97.586.802 bayt).
