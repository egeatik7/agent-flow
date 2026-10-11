# Sürüm notu — 1.9.82 (Yerel Model Düzeltmeleri: **Ayarlar üç sekme**)

Kaynak ✓: kullanıcının `Nubbo-1.9.82-Yerel-Model-Duzeltmeleri` paketi ✓. `README.txt`: patch **yalnız 1.9.81 tabanı** için ✓,
önce **reverse check** ✓, uyuşmazlıkta **zorlamadan dur** ✓. **Ölçüm** ✓: `git apply --check` = **0** ✓ (**paket dosyaları dahil** ✓ —
taban tam benim `21b4149` ✓), `SHA256.json` **23/23 AYNI** ✓, `git diff --check` **0** ✓, `source/` ile içerik karşılaştırması ✓.

## Gelen
- **Ayarlar üç sekmeye ayrıldı** ✓: **Genel** ✓ / **Yerel Model** ✓ / **Kurtarma Ajanı** ✓.
  **Yerel bağlantı** (adres ✓, sunucu hazır listesi ✓, “Yerel listeyi getir” ✓) artık **kendi sekmesinde** ✓
  (yeni `src/components/LocalModelSettings.tsx` ✓); **model listeleri Genel sekmesinde** düzenlenir ✓.
- `ModelChain.tsx` ✓ · `SidePanel.tsx` ✓ · `RecoverySettingsPanel.tsx` ✓ · `App.tsx` ✓ · `xp.css` ✓ güncellendi ✓.
- **Motor tarafı** ✓: `electron/agent.ts` ✓ · `electron/openrouter.ts` ✓ · `electron/main.ts` ✓.
- **Üç yeni test** ✓: `tests/local-endpoint.test.ts` ✓ · `tests/local-settings-ui.test.ts` ✓ · `tests/model-settings-app.test.ts` ✓.
- **Eski tuval/otomasyon JSON dosyaları değişmedi** ✓ (README ✓).

## Paketin kendi ölçümleri (`checks/` klasörü ✓ — logsuz iddia yok ✓)
**598 Vitest** ✓ · **118 Node regresyonu** ✓ · typecheck + renderer/main + **beş npm paketi** ✓ ·
**gerçek `localhost` HTTP sunucusuyla bağlantı** ✓ ve **anahtarın yerel isteğe GİTMEDİĞİ** ✓ denendi
(benim yapamadığım kısım ✓). **Yapılmayan** ✗: Windows PowerShell harness'leri ✗, **gerçek yerel LLM çıkarımı** ✗,
**görsel kontrol** ✗.

## Benim ölçümüm (Windows, bu makine ✓)
`typecheck` ✓ · `build:electron` ✓ · **Vitest** ✓ (paketin 598'i + Windows'a bağlı **5 atlamanın tamamı** ✓) ·
**beş npm paketi** ✓ · **sekiz Node regresyon 118/0** ✓ · **PS 5.1'de 10 harness** ✓ (**paket bunları koşmadı** ✗) ·
`source/` karşılaştırması ✓ · `pack:win` ✓ · exe hash ✓.

## Doğrulanmayan (dürüst ✗)
**Gerçek yerel LLM çıkarımı** ✗, **ekran görüntüsüyle görsel kontrol** ✗ ve **canlı Windows masaüstü koşusu** ✗
yapılmadı — paketin kendi beyanı da bu ✓ (yalnız `localhost` **bağlantısı** sınandı ✓, **çıkarım** değil ✗).