# Sürüm notu — 1.9.83 (Kayıt ve otomasyon yaşam döngüsü)

Kaynak ✓: `Nubbo_Kayit_Otomasyon_Patch` ✓. `CURSOR_UYGULAMA.md` taban olarak **`14cfc63a…`** veriyor ✓ = **birebir benim HEAD'im** ✓;
patch **SHA256 paketin beyanıyla aynı** ✓ (`41f506f7…` ✓); düz `git apply --check` = **0** ✓ (paket dosyaları dahil ✓) → **zorlamadan** uygulandı ✓;
`git diff --check` **0** ✓; **18 dosya** ✓ (paketin listesiyle aynı ✓).

## Gelen davranış
- **Çalışma taslağı / açık kayıt ayrımı** ✓: açık tuval ve otomasyon düzenlemeleri **taslak** olarak korunur ✓,
  kalıcı kayıt **açıkça Kaydet** ile güncellenir ✓.
- **`Ctrl+S`** aktif tuvali ✓, **`Ctrl+Shift+S`** açık tuvalleri **ve** otomasyon taslağını kaydeder ✓.
- **Tuvali Farklı Kaydet** yeni kimlik üretir ✓; eski kaydı kullanan otomasyonlar **eski kaydı** kullanmayı sürdürür ✓.
- **“Açık Sırayı Otomasyon Olarak Kaydet”** açık sekmelerin sırasını **tekrar eden tuvaller dahil** kaydeder ✓.
- **Çıkışta Kaydet / Kaydetme / İptal** ✓: **İptal veya yazma hatası kapanışı DURDURUR** ✓, **denenmiş taslak korunur** ✓.
- **Kurtarma taslakları** ✓: kesilen oturumdan kalan düzenlemeler sunulur ✓, **kendiliğinden kayıtlı tuvale dönüşmez** ✓.
- **Döngü işaretleri artık “değişmiş” saymıyor** ✓ (`electron/canvas-content.ts`: `loopIndex` / `templated` / `startIndex: 0`
  **içerik sayılmaz** ✓) → benim **bug taramasındaki** “çalışma işareti tuvali kirletiyor” sınıfının kökü kapanıyor ✓.
- **Çakışan sekme kaydı engelli** ✓: aynı kaydı düzenleyen iki sekme birbirinin kaydını **ezemez** ✓, çakışma **kaydetmeyi durdurur** ✓.
- **Tek store yazısı** ✓: tuval deposu + taslaklar + eski graph uyumluluk verisi birlikte yazılır ✓;
  **bozuk kayıt sessizce boş profil sayılmaz** ✓.
- Yeni dosyalar ✓: `electron/canvas-content.ts` ✓ · `electron/workspace-save.ts` ✓ · `electron/workspace-store.ts` ✓ ·
  `src/components/WorkspaceNameDialog.tsx` ✓ + **üç yeni test** ✓ (`workspace-lifecycle` ✓, `workspace-save` ✓, `workspace-ui` ✓).

## Bilinçli sapmalar (kullanıcı kuralı paketin talimatından üstün ✓)
Paketin `CURSOR_UYGULAMA.md` dosyası *“push veya merge yapma”* ✗ ve *“dal aç”* ✗ diyor; **kullanıcının otomatik yayın
kuralı** (§19) gereği **dal açılmadı** ✗ ve **`main`'e commit + etiket + push yapıldı** ✓. Patch `package.json`'a
dokunmadığı için sürümü **1.9.82 → 1.9.83** ben çıkardım ✓.

## Doğrulama (bu makinede, Windows ✓)
`typecheck` ✓ · `build:electron` ✓ · **Vitest 87 dosya / 629 test** ✓ (paketin sayısıyla **aynı** ✓) ·
**beş npm paketi** ✓ · **sekiz Node regresyon 118/0** ✓ · **PS 5.1'de 10 harness** ✓ (**paket bunları koşmadı** ✗) ·
`pack:win` ✓ · exe hash ✓.

## Doğrulanmayan (dürüst ✗ — paketin de yazdığı sınır ✓)
**Gerçek Windows/Electron pencere kapanış akışı** ✗ ve **canlı arayüz testi** ✗ yapılmadı ✓ (paket: *“otomatik testler
Linux ortamında çalıştırıldı, gerçek pencere kapanışı ve arayüz canlı test edilmedi”* ✓); **kesinti sonrası kurtarma
taslağı** da canlı denenmedi ✗. Elle deneme listesi paketin sonunda yazılı ✓ (Ctrl+S sonrası işaret kalkıyor mu ✓,
otomasyon sırası kapanıp açılınca korunuyor mu ✓, İptal pencereyi açık tutuyor mu ✓, “Tümünü Kaydet” ikisini de
kaydediyor mu ✓, açık sıra otomasyonu yeniden açılınca aynı mı ✓, döngü koşunca tuval kirlenmiyor mu ✓).