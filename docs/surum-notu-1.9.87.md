# Sürüm notu — 1.9.87 (**Yap node**: İnisiyatif motoru yerine masaüstü görev ajanı)

**Kaynak** ✓: kullanıcının **`Nubbo_Yap_Node.patch`** paketi ✓ (86,2 KB ✓, SHA256 `fb94e109…` ✓). Taban **`afc5425`** ✓ =
birebir benim HEAD'im ✓. Düz `git apply --check` = **0** ✓, `git diff --check` = **0** ✓, **21 dosya** ✓.

## Gelen (paketin `docs/yap-node.md` belgesinden ✓)
- **Yap, eski inisiyatif yürütme motorunun YERİNE geçer** ✓; **kalıcı node türü `ai` olarak KALIR** ✓ → **mevcut node
  kimlikleri, paket/döngü üyeliği ve bağlantılar korunur** ✓ (eski akışlar yeniden kurulmaz ✓).
- **Normal görev ajanı, kurtarma ile AYNI masaüstü yürütücüsünü ve araç tanımlarını kullanır** ✓.
- **`window_action`** ✓ (maximize/minimize/restore/focus/move/resize/topmost/notopmost ✓; başlık **tek bir süreç ana
  penceresiyle tam eşleşmeli** ✓) ve **`powershell_run`** ✓ (taze noninteractive PowerShell ✓, UTF16 argümanlar ✓,
  isteğe bağlı çalışma klasörü ✓, sınırlı çıktı ✓, **çağrı başına 60 sn** ✓).
- **Kod çalıştırma** ✗: **Yap'ta varsayılan AÇIK** ✗ (gelişmiş ayarlardan kapatılır ✓); **kurtarmada varsayılan KAPALI** ✓.
- **Model** ✓: Yap kendi modeli/yedekleri + **genel anahtar** ✓; **UI-TARS kayıtları hariç** ✓ (function calling şart ✓).
- **Yeni dosyalar** ✓: `electron/yap.ts` ✓ · `electron/windows-tools.ts` ✓ · `docs/yap-node.md` ✓ · `tests/yap.test.ts` ✓ ·
  `tests/windows-execution.test.ts` ✓.

## ⚠️ Geçit kırmızı çıktı ve **yayın durduruldu** ✗ — kök neden ve karar
`npm run test:recovery` 9/10/11 ✗: **`f.ex.initiative is not a function`** ✗. **Kök neden** ✓: üretimde
`main.ts:662-668` executor'a `initiative`'ı **`runYap`'a bağlayarak ekliyor** ✓, ama **`agent.ts`'in executor'ı artık
`initiative` sunmuyor** ✗ (motor **Yap ile değiştirildi** ✗) → yani `scripts/test-input-recovery.cjs` ve
`scripts/test-stability-agent.cjs` içindeki, **silinen motorun iç işleyişini** (guiStep/nextAction ile sürülen move/click
döngüsü ✗) doğrulayan testler **geçersiz** kaldı ✗.
**Karar** ✓: bu testleri **silmedim** ✗; **gerekçesiyle `test.skip`'e çevirdim** ✓ — **kanıt ve kapsam kaydı korunuyor** ✓,
ama artık **var olmayan bir motoru** doğruladıkları için koşmuyorlar ✓. Dosyalardaki **diğer** testler (yazma ✓, tuş ✓,
durdurma ✓, graf davranışı ✓) **aynen koşuyor** ✓. **Yap'ın kendi kapsaması** paketin eklediği `tests/yap.test.ts` ✓ +
`tests/windows-execution.test.ts` ✓ içinde ve **`npm test` 95 dosya / 708 test ile YEŞİL** ✓✓.

## Bilinçli sapma ✗
Paket sürümden söz etmiyor ✗ ve `package.json`'a dokunmuyor ✗; otomatik yayın kuralı (§19) gereği **1.9.86 → 1.9.87** ✓.

## Doğrulama
`typecheck` ✓ · `build:electron` ✓ · **Vitest 95 dosya / 708 test** ✓ · **beş npm paketi** ✓ (**skip sayısı raporlandı** ✓) ·
**sekiz Node regresyon** ✓ · **PS 5.1'de 10 harness** ✓ · `pack:win` ✓ · **masaüstü kopyası hash ile doğrulandı** ✓ ·
**ASAR'ın içinden** yeni kodun izleri ölçüldü ✓.

## Doğrulanmayan (dürüst ✗)
**Gerçek Windows pencere manipülasyonu** ✗ ve **gerçek PowerShell yürütmesi** ✗ **canlı denenmedi** ✓ (paketin belgesi de
böyle yazıyor ✓; yalnız **taklit** testler var ✓). **Yap node'unun gerçek ekranda davranışı** ✗, **kod çalıştırma izin
akışı** ✗ ve **kurtarma ile paylaşılan yürütücünün canlı sonucu** ✗ ölçülmedi ✓.