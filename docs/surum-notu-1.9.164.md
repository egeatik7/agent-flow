# Sürüm notu — 1.9.164 (denetim düzeltmeleri: sonsuz tur, sessiz başarı, tuş yazımı, merge kimliği)

**Taban:** `e08b482` (1.9.163). Bu sürüm, 37 ajanlık denetimin (bkz. `docs/bug-taramasi-1.9.164.md`)
12 yüksek bulgusundan 9'unu kapatır; node türleri/şemaları değişmedi.

## Ne değişti

1. **Koşul'da ham executor hatası artık sonsuz turda dönmüyor** (`runner.ts`, `agent.ts`):
   eksik API anahtarı/yerel model hatası `PermanentStepError`; diğer ham hatalar en çok 3 taze
   gözlemden sonra yukarı verilir. Koşu açık hatayla biter, `DUGUM-TEKRAR` sonsuza yazmaz.
2. **Kutu içinde "karar verilemedi" sessizce "hayır" sayılmıyor** (`runner.ts`): 'yok' dalı yoksa
   tur öğe hatası olur; `succeeded++` yapılmaz, rapor "çalıştı" demez.
3. **Eksik klasör kutusu kilitlenmiyor** (`runner.ts`): `readFolder` en çok 3 tur dener.
4. **Hatadan devam, klasör kutusunda yanlış "Liste değişmiş" demiyor** (`tools.ts`): klasör beslemeli
   kutuda tuvaldeki bayat `items` karşılaştırılmaz; kimlikle devam motorda kalır.
5. **Etiket→alan, odakta başka yazı alanı olsa da çalışıyor** (`worker.ps1`): tıklama noktasının
   komşuluğundaki tek alan, odak türüne bakılmadan odaklanır (aday zaten odaktaysa dokunulmaz).
6. **Tarama hatası "BAKILMALI" sayılıyor** (`agent.ts`, `main.ts`, `tools.ts`): gözlenemeyen eylem
   temiz başarı olarak raporlanmaz.
7. **Model tuş koruması SendKeys yazımlarını da kapsıyor** (`key-guard.ts`): `^w`, `^q`, `^+{w}`,
   `%{F4}`, `^%{F4}`, `{ESC}{DELETE}` engelli; basış bazlı ayrıştırma (`keyChords`).
8. **Merge yanıtı istek kimliği taşıyor** (`main.ts`, `preload.ts`, `App.tsx`, `types.ts`): gecikmiş
   cevap başka merge isteğini onaylamıyor; ZIP kaydı başarısızsa yanıt `ambiguous:true` döner ve
   "hiçbir şey yazılmadı" denmez.
9. **Worker `finally` temizliği tamamlanmış eylemi ezmiyor** (`worker.ps1`): `After()` hatası
   `warning` olarak eklenir, sonuç `ok:false`'a dönmez; eylem "gönderilmedi" diye tekrarlanmaz.
10. **Yap bütçesi sığan isteği önden reddetmiyor** (`yap-context.ts`, `openrouter.ts`):
    3 bayt/token + 1024 pay; 4096/8192 pencerede sığan istek gönderilir.

## Doğrulama

- `npm run typecheck` ✓ (üç proje).
- `npx vitest run` → **194 dosya / 1481 test** yeşil. Yeni: `tests/runner-new-bounds.test.ts` (3),
  `model-key-guard` 23 (yeni yazımlar), `yap-budget-units` güncel.
- `test:keys` 3 · `test:input` 7 · `test:recovery` 27 · `test:targeting` 20 · `test:stability` 40 ·
  `test:lock` 1 — **0 kırmızı**.
- `scripts/test-worker.ps1` (klasik form, Ctrl+A'yı yok sayan kutu, native Edit odak) **geçti**;
  `worker.ps1` PowerShell 5.1 ayrıştırması temiz.
- `npm run build:electron` ✓.

## Sınırlar (dürüst)

- **Canlı Windows masaüstü koşusu yapılmadı.** Etiket→alan/`EM_SETSEL` ve worker `finally` yolu
  gerçek FolderBatcher penceresinde sınanmadı; harness + Node paketleri sözleşmeyi sınıyor.
- Denetimde kalan yüksek bulgular bu sürümde **kapatılmadı**: checkpoint'in 500 ms tam-dosya
  yazımı (O(n²)), checkpoint panelinin 100.000 satır render'ı, paket içi hedef seçici (H7),
  `screen.ps1` piksel döngüleri (~2,8 sn tarama / ~9,2 sn kare). Sonraki sürümde.
